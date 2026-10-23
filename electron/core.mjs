// The IngrainedCut engine: media/FFmpeg, export, Claude agent, HyperFrames, MCP bridge and every handler the
// editor UI calls. It is host-agnostic — the Electron app and the local web server each provide a `host`.
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probe, makeThumbnails, makeAudioAssets, detectSilence, detectScenes, transcribe, loudness, run, FFMPEG, ffmpegFetching } from './media.mjs';
import { startExport, writeFrame, finishExport, cancelExport, writeTempWav, wcStart, wcChunk, wcFinish, wcCancel } from './exporter.mjs';
import { getSettings, saveSettings, addRecentProject } from './settings.mjs';
import { AgentManager } from './agent.mjs';
import { findClaudeCode, CLAUDE_CODE_INSTALL } from './claudeCode.mjs';
import { CodexAgent, CursorAgent, providerStatus, providerLogin, cancelProviderLogin, providerModels, installCodex } from './otherAgents.mjs';
import { TOOL_DEFS } from './tools.mjs';
import { startBridge, BRIDGE_FILE } from './bridge.mjs';
import { claudeSdk } from './runtimePackages.mjs';
import { mediaUrl } from './mediaServe.mjs';
import { userDataDir, documentsDir } from './paths.mjs';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {object} Host
 * @property {(channel:string, fn:(...args:any[])=>any)=>void} handle   request/response from the UI
 * @property {(channel:string, fn:(payload:any)=>void)=>void} on        fire-and-forget from the UI
 * @property {(channel:string, payload:any)=>void} emit                 event to the UI
 * @property {()=>boolean} hasEditor
 * @property {string} version
 * @property {string|null} startupProject
 * @property {{openMedia():Promise<string[]>, save(opts:any):Promise<string|null>, openProject():Promise<string|null>, chooseFile(opts:any):Promise<string|null>}} dialogs
 * @property {{reveal(p:string):void, openExternal(url:string):void}} shell
 * @property {(()=>Promise<string|null>)=} screenshot  base64 JPEG of the editor, or undefined to ask the UI
 * @property {{devtools():void, reload():void}=} window
 * @property {string=} mcpServerPath  where outside agents start the MCP server (default: mcp/server.mjs next to this engine)
 */

/** @param {Host} host */
export function createCore(host) {
  const { handle, on, emit } = host;
  let mirror = null; // latest project snapshot pushed by the UI
  let dirty = false;

  // ---------- UI tool calls ----------
  let toolSeq = 0;
  const pendingTools = new Map();
  function callRenderer(name, args) {
    if (!host.hasEditor()) throw new Error('The IngrainedCut editor is not open');
    const id = ++toolSeq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingTools.delete(id);
        reject(new Error('Editor did not respond in time'));
      }, 30 * 60 * 1000);
      pendingTools.set(id, { resolve, reject, timer });
      emit('tool:invoke', { id, name, args });
    });
  }
  on('tool:result', ({ id, result }) => {
    const p = pendingTools.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pendingTools.delete(id);
    p.resolve(result);
  });

  // ---------- engine-side tools ----------
  const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1) }] });

  function resolveTarget(args) {
    if (!mirror) throw new Error('No project loaded');
    let clip = null;
    let media = null;
    if (args.clip_id) {
      clip = mirror.clips.find((c) => c.id === args.clip_id);
      if (!clip) throw new Error(`Clip ${args.clip_id} not found`);
      media = mirror.media.find((m) => m.id === clip.mediaId);
      if (!media) throw new Error(`Clip ${args.clip_id} has no source media (it is a ${clip.kind} clip)`);
    } else if (args.media_id) {
      media = mirror.media.find((m) => m.id === args.media_id);
      if (!media) throw new Error(`Media ${args.media_id} not found`);
    } else throw new Error('Pass media_id or clip_id');
    return { clip, media };
  }

  const r3 = (x) => Math.round(x * 1000) / 1000;
  const toTimeline = (clip, s) => clip.start + (s - clip.in) / (clip.speed || 1);
  const clipSourceWindow = (clip) => [clip.in, clip.in + clip.duration * (clip.speed || 1)];

  async function runMainTool(name, args) {
    switch (name) {
      case 'screenshot_editor': {
        const data = host.screenshot ? await host.screenshot() : null;
        if (data) return { content: [{ type: 'image', data, mimeType: 'image/jpeg' }] };
        return callRenderer('screenshot_editor', args);
      }
      case 'detect_silence': {
        const { clip, media } = resolveTarget(args);
        const w = clip ? clipSourceWindow(clip) : [undefined, undefined];
        const ranges = await detectSilence(media.path, { thresholdDb: args.threshold_db ?? -35, minDuration: args.min_duration ?? 0.5, start: w[0], end: w[1] });
        const out = ranges.map((r) => {
          const end = r.end ?? (clip ? w[1] : media.duration);
          const o = { source_start: r3(r.start), source_end: r3(end) };
          if (clip) {
            o.timeline_start = r3(toTimeline(clip, Math.max(r.start, clip.in)));
            o.timeline_end = r3(toTimeline(clip, Math.min(end, w[1])));
          }
          return o;
        });
        return text({ media: media.id, clip: clip?.id, silences: out, count: out.length });
      }
      case 'detect_scenes': {
        const { clip, media } = resolveTarget(args);
        const cuts = await detectScenes(media.path, { threshold: args.threshold ?? 0.3 });
        const out = cuts
          .map((t) => {
            const o = { source_time: t };
            if (clip) {
              const [a, b] = clipSourceWindow(clip);
              if (t < a || t > b) return null;
              o.timeline_time = r3(toTimeline(clip, t));
            }
            return o;
          })
          .filter(Boolean);
        return text({ media: media.id, clip: clip?.id, cuts: out });
      }
      case 'transcribe': {
        const { clip, media } = resolveTarget(args);
        emit('app:toast', { message: `Transcribing ${media.name}… (first run can take a while)` });
        const segs = await transcribe(media.path, getSettings().whisperModel, { language: args.language || 'auto' });
        let out = segs.map((s) => ({ source_start: r3(s.start), source_end: r3(s.end), text: s.text }));
        if (clip) {
          const [a, b] = clipSourceWindow(clip);
          out = out
            .filter((s) => s.source_end > a && s.source_start < b)
            .map((s) => ({ ...s, timeline_start: r3(toTimeline(clip, Math.max(a, s.source_start))), timeline_end: r3(toTimeline(clip, Math.min(b, s.source_end))) }));
        }
        return text({ media: media.id, clip: clip?.id, segments: out });
      }
      case 'analyze_loudness': {
        const { media } = resolveTarget(args);
        return text({ media: media.id, ...(await loudness(media.path)) });
      }
      case 'render_composition':
        return renderComposition(args);
    }
    throw new Error('Unknown engine tool ' + name);
  }

  async function dispatch(name, args) {
    const def = TOOL_DEFS.find((d) => d.name === name);
    if (!def) throw new Error(`Unknown tool ${name}`);
    const res = def.where === 'main' ? await runMainTool(name, args) : await callRenderer(name, args);
    emit('agent:tool-activity', { name, args });
    return res;
  }

  // ---------- external Claude Code sessions (via mcp/server.mjs) ----------
  const externals = new Map();
  function noteExternal(client, toolName) {
    // the chat's own Codex / Cursor agent is shown as the main agent, not as an outside session
    if (!client || String(client.id).startsWith('inapp-')) return;
    const now = Date.now();
    const e = externals.get(client.id) ?? { id: client.id, name: client.name || 'Claude Code', since: now, calls: 0 };
    e.last = now;
    if (toolName) {
      e.lastTool = toolName;
      e.calls++;
    }
    externals.set(client.id, e);
    emitExternals();
  }
  function emitExternals() {
    const now = Date.now();
    for (const [k, e] of externals) if (now - e.last > 90_000) externals.delete(k);
    emit('agents:external', [...externals.values()]);
  }
  const externalsTimer = setInterval(emitExternals, 15_000);
  externalsTimer.unref?.();

  // ---------- permissions ----------
  let permSeq = 0;
  const pendingPerms = new Map();
  function askPermission({ toolName, input, reason, signal }) {
    const id = ++permSeq;
    return new Promise((resolve) => {
      pendingPerms.set(id, resolve);
      signal?.addEventListener('abort', () => {
        pendingPerms.delete(id);
        resolve({ allow: false });
      });
      emit('agent:event', { type: 'permission', id, toolName, input, reason });
    });
  }
  on('agent:permission-reply', ({ id, allow, always }) => {
    const r = pendingPerms.get(id);
    pendingPerms.delete(id);
    r?.({ allow, always });
  });

  /** Bypass permissions: applies to the running conversation and approves anything already waiting. */
  async function setBypass(on_) {
    saveSettings({ autoApproveAll: on_ });
    for (const a of Object.values(agents)) await a.setBypass(on_);
    if (on_) {
      for (const [id, resolve] of pendingPerms) {
        pendingPerms.delete(id);
        resolve({ allow: true });
        emit('agent:event', { type: 'permission_resolved', id, allow: true });
      }
    }
    emit('agent:event', { type: 'bypass', on: on_ });
  }
  handle('agent:set-bypass', (on_) => setBypass(!!on_));

  // ---------- existing Claude Code conversations ----------
  handle('sessions:list', async () => {
    const list = await (await claudeSdk()).listSessions({ limit: 100 });
    return list
      .sort((a, b) => b.lastModified - a.lastModified)
      .map((x) => ({ sessionId: x.sessionId, title: x.customTitle || x.summary || x.firstPrompt || 'Untitled', lastModified: x.lastModified, cwd: x.cwd, gitBranch: x.gitBranch }));
  });

  function blockText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
      .map((b) => (b.type === 'text' ? b.text : b.type === 'tool_use' ? `[used ${b.name}${b.input?.file_path ? ' on ' + b.input.file_path : b.input?.command ? ': ' + String(b.input.command).slice(0, 120) : ''}]` : ''))
      .filter(Boolean)
      .join('\n');
  }

  handle('sessions:transcript', async (sessionId) => {
    const msgs = await (await claudeSdk()).getSessionMessages(sessionId);
    const parts = [];
    for (const m of msgs) {
      if (m.parent_tool_use_id || (m.type !== 'user' && m.type !== 'assistant')) continue;
      const t = blockText(m.message?.content).replace(/<editor_state>[\s\S]*?<\/editor_state>/g, '[timeline snapshot]').trim();
      if (!t) continue;
      parts.push(`${m.type === 'user' ? 'User' : 'Claude'}: ${t.length > 4000 ? t.slice(0, 4000) + ' …' : t}`);
    }
    let txt = parts.join('\n\n');
    const MAX = 60_000;
    if (txt.length > MAX) txt = '[earlier messages omitted]\n…' + txt.slice(-MAX);
    return { text: txt, messages: parts.length };
  });

  handle('sessions:continue', async (sessionId) => {
    const { getSessionInfo, forkSession } = await claudeSdk();
    const info = await getSessionInfo(sessionId);
    const fork = await forkSession(sessionId, { title: `${info?.customTitle || info?.summary || 'Chat'} (IngrainedCut)` });
    if (provider() !== 'claude') {
      active().reset();
      saveSettings({ provider: 'claude' });
    }
    agents.claude.resumeFrom(fork.sessionId, info?.cwd && fs.existsSync(info.cwd) ? info.cwd : agentCwd());
    return { sessionId: fork.sessionId };
  });

  /** The project folder plus every folder that holds imported media: agents may read these freely. */
  function projectDirs() {
    const dirs = new Set();
    if (mirror?.path) dirs.add(path.dirname(mirror.path));
    for (const m of mirror?.media ?? []) if (m.path) dirs.add(path.dirname(m.path));
    return [...dirs];
  }

  function agentCwd() {
    if (mirror?.path) return path.dirname(mirror.path);
    const d = path.join(documentsDir(), 'IngrainedCut');
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  const compositionsDir = () => path.join(agentCwd(), 'compositions');

  // ---------- HyperFrames compositions ----------
  let renderSeq = 0;
  function runHyperframes(args, cwd, onLine) {
    return new Promise((resolve, reject) => {
      const quoted = args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
      const p = spawn('npx', ['-y', 'hyperframes', ...quoted], { cwd, shell: true, windowsHide: true, env: { ...process.env, HYPERFRAMES_RENDER_DETACHED: '' } });
      let tail = '';
      const take = (d) => {
        const s = d.toString();
        tail = (tail + s).slice(-6000);
        for (const line of s.split(/\r?\n|\r/)) if (line.trim()) onLine(line.trim());
      };
      p.stdout.on('data', take);
      p.stderr.on('data', take);
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve(tail) : reject(new Error(`hyperframes render failed (exit ${code}):\n${tail.slice(-2500)}`))));
    });
  }

  async function renderComposition(a) {
    const dir = path.resolve(agentCwd(), a.project_dir);
    if (!fs.existsSync(path.join(dir, 'index.html'))) throw new Error(`No HyperFrames composition at ${dir} (index.html not found). Create it with \`npx hyperframes init ${a.project_dir}\`.`);
    const format = a.format || 'mp4';
    const quality = a.quality || 'looks';
    const slug = path.basename(dir).replace(/[^\w.-]+/g, '-');
    const out = path.join(dir, 'renders', `${slug}-${Date.now()}.${format}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const job = { id: ++renderSeq, name: a.name || slug, format, progress: 0, line: 'Starting render…' };
    emit('composition:progress', job);
    const started = Date.now();
    try {
      await runHyperframes(['render', '--format', format, '--quality', quality, '--output', out], dir, (line) => {
        const pct = line.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
        if (pct) job.progress = Math.min(1, parseFloat(pct[1]) / 100);
        job.line = line.slice(0, 160);
        emit('composition:progress', job);
      });
    } catch (e) {
      emit('composition:progress', { ...job, done: true, error: e.message.slice(0, 300) });
      throw e;
    }
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
      emit('composition:progress', { ...job, done: true, error: 'no output' });
      throw new Error(`Render finished but ${out} is missing or empty`);
    }
    emit('composition:progress', { ...job, progress: 1, done: true, line: 'Rendered — adding to the edit' });
    const result = { rendered: out, format, quality, render_seconds: Math.round((Date.now() - started) / 100) / 10 };
    const textOf = (r) => r?.content?.find((c) => c.type === 'text')?.text ?? '';
    if (a.replace_media_id) {
      const r = await callRenderer('relink_media', { media_id: a.replace_media_id, path: out, composition: dir });
      if (r.isError) throw new Error(textOf(r));
      return text({ ...result, replaced_media: a.replace_media_id, note: 'Every clip using this media now shows the new render.' });
    }
    const imp = await callRenderer('import_media', { paths: [out], composition: dir, name: a.name });
    if (imp.isError) throw new Error(textOf(imp));
    const media = JSON.parse(textOf(imp)).imported?.[0];
    result.media_id = media?.id;
    result.duration = media?.duration;
    if (a.place !== false && media) {
      const placed = await callRenderer('add_clip', { media_id: media.id, start: a.start, at_playhead: a.start == null, track: a.track || 'auto', include_audio: a.include_audio });
      result.placed = JSON.parse(textOf(placed));
    }
    return text(result);
  }

  const agentOpts = { emit, dispatch, getSettings, getCwd: agentCwd, askPermission, getDirs: projectDirs, getCompositionsDir: compositionsDir, getBridge: () => bridge?.info() };
  // the chat runs one agent at a time, chosen in the panel: Claude Code, Codex or Cursor (each with the user's own login)
  const agents = { claude: new AgentManager(agentOpts), codex: new CodexAgent(agentOpts), cursor: new CursorAgent(agentOpts) };
  const provider = () => (agents[getSettings().provider] ? getSettings().provider : 'claude');
  const active = () => agents[provider()];
  /** settings keys holding each provider's model and effort */
  const MODEL_KEYS = { claude: ['model', 'effort'], codex: ['codexModel', 'codexEffort'], cursor: ['cursorModel', null] };

  // ---------- handlers ----------
  // the editor's own buttons (Scene Edit Detection, …) use the same analysis tools the AI does
  const ENGINE_TOOLS = new Set(['detect_scenes', 'detect_silence', 'transcribe', 'analyze_loudness']);
  handle('engine:tool', async ({ name, args }) => {
    if (!ENGINE_TOOLS.has(name)) throw new Error('Not an engine tool: ' + name);
    try {
      return await runMainTool(name, args ?? {});
    } catch (e) {
      return { content: [{ type: 'text', text: 'Error: ' + (e?.message || String(e)) }], isError: true };
    }
  });

  handle('agent:send', (payload) => active().send(payload));
  handle('agent:interrupt', () => active().interrupt());
  handle('agent:reset', () => active().reset());
  handle('agent:set-model', async ({ model, effort }) => {
    const p = provider();
    const [mk, ek] = MODEL_KEYS[p];
    const prev = getSettings();
    saveSettings({ [mk]: model, ...(ek ? { [ek]: effort } : {}) });
    if (model !== prev[mk]) await active().setModel(model);
    if (ek && effort !== prev[ek]) await active().setEffort(effort);
  });
  handle('agent:set-provider', (p) => {
    if (!agents[p]) throw new Error('Unknown agent ' + p);
    if (p !== provider()) {
      active().reset();
      saveSettings({ provider: p });
    }
    return getSettings();
  });
  handle('providers:status', (p) => (p === 'claude' ? claudeStatus() : providerStatus(p, getSettings())));
  handle('providers:models', (p) => (p === 'claude' ? [] : providerModels(p)));
  handle('providers:login', async (p) => {
    if (p === 'claude') return { ok: false, out: SIGN_IN_THERE };
    const r = await providerLogin(p, (line) => {
      emit('auth:output', line);
      const url = line.match(/https:\/\/\S+/);
      if (url) host.shell.openExternal(url[0]);
    });
    agents[p].reset();
    return r;
  });
  handle('providers:install', async (p) => {
    if (p !== 'codex') throw new Error('Only Codex installs from here');
    return installCodex((line) => emit('auth:output', line));
  });
  handle('providers:cancel-login', () => {
    authProc?.kill();
    cancelProviderLogin();
  });

  handle('settings:get', () => getSettings());
  handle('settings:set', async (patch) => {
    const before = getSettings().apiKey;
    if (patch.autoApproveAll !== undefined) await setBypass(!!patch.autoApproveAll);
    const s = saveSettings(patch);
    if (patch.apiKey !== undefined && patch.apiKey !== before) agents.claude.reset();
    return s;
  });

  // outside agents (the user's own Claude Code, Codex, Cursor) reach the editor through this MCP server
  const mcpServerPath = host.mcpServerPath ?? path.join(ROOT, 'mcp', 'server.mjs');

  handle('app:info', async () => {
    let ffmpegOk = true;
    try {
      if (!ffmpegFetching()) await run(FFMPEG, ['-version']); // a background download counts as there
    } catch {
      ffmpegOk = false;
    }
    return {
      version: host.version,
      mcpServerPath,
      bridgeFile: BRIDGE_FILE,
      ffmpegOk,
      userData: userDataDir(),
      documents: documentsDir(),
      startupProject: host.startupProject,
    };
  });

  handle('dialog:open-media', () => host.dialogs.openMedia());
  handle('dialog:save', (opts) => host.dialogs.save(opts));
  handle('dialog:open-project', () => host.dialogs.openProject());
  handle('dialog:choose-file', (opts) => host.dialogs.chooseFile(opts));

  handle('media:import', async (items) => {
    const results = [];
    for (const { id, path: p } of items) {
      try {
        const info = await probe(p);
        results.push({ id, ok: true, info: { ...info, path: p, url: mediaUrl(p), name: path.basename(p) } });
        processMediaAssets(id, p, info);
      } catch (e) {
        results.push({ id, ok: false, error: e.message });
      }
    }
    return results;
  });

  async function processMediaAssets(id, p, info) {
    try {
      if (info.type !== 'audio') {
        const t = await makeThumbnails(p, info);
        emit('media:update', {
          id,
          patch: {
            thumb: mediaUrl(t.poster),
            sprite: t.sprite ? { url: mediaUrl(t.sprite.path), tiles: t.sprite.tiles, tileW: t.sprite.tileW, tileH: t.sprite.tileH, interval: t.sprite.interval } : null,
          },
        });
      }
    } catch (e) {
      console.error('thumbs', e.message);
    }
    try {
      if (info.hasAudio) {
        const a = await makeAudioAssets(p, info);
        emit('media:update', { id, patch: { peaks: a.peaks, audioUrl: mediaUrl(a.wav), status: 'ready' } });
      } else emit('media:update', { id, patch: { status: 'ready' } });
    } catch (e) {
      console.error('audio', e.message);
      emit('media:update', { id, patch: { status: 'ready' } });
    }
  }

  handle('media:refresh-assets', ({ id, path: p, info }) => processMediaAssets(id, p, info));

  handle('project:save', async ({ path: p, data }) => {
    fs.writeFileSync(p, JSON.stringify(data, null, 1));
    addRecentProject(p);
    return true;
  });
  handle('project:load', async (p) => {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    addRecentProject(p);
    const missing = (data.media || []).filter((m) => !fs.existsSync(m.path)).map((m) => m.path);
    return { data, missing };
  });
  on('project:sync', (p) => (mirror = p));
  on('project:dirty', (d) => (dirty = d));

  handle('export:start', (opts) => {
    const audioWav = opts.audio ? writeTempWav(opts.audio) : null;
    return startExport({ ...opts, audio: undefined, audioWav });
  });
  handle('export:frame', (buf) => writeFrame(buf));
  handle('export:finish', () => finishExport());
  handle('export:cancel', () => cancelExport());
  handle('export:wc-start', (o) => wcStart(o));
  handle('export:wc-chunk', (o) => wcChunk(o));
  handle('export:wc-finish', (o) => wcFinish(o));
  handle('export:wc-cancel', () => wcCancel());

  handle('shell:reveal', (p) => host.shell.reveal(p));
  handle('shell:open-external', (url) => {
    if (/^https:\/\//.test(url)) host.shell.openExternal(url);
  });
  handle('fs:exists', (p) => fs.existsSync(p));
  handle('fs:write-png', ({ path: p, data }) => fs.writeFileSync(p, Buffer.from(data)));
  on('win:devtools', () => host.window?.devtools());
  on('win:reload', () => host.window?.reload());

  const WHISPER_MODELS = {
    'tiny.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    'base.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    'small.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
    base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  };
  handle('whisper:download', async (name) => {
    const url = WHISPER_MODELS[name];
    if (!url) throw new Error('Unknown model');
    const dir = path.join(userDataDir(), 'models');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `ggml-${name}.bin`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length') || 0);
    const tmp = dest + '.part';
    const out = fs.createWriteStream(tmp);
    let got = 0;
    for await (const chunk of res.body) {
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      emit('whisper:progress', { got, total });
    }
    await new Promise((r) => out.end(r));
    fs.renameSync(tmp, dest);
    saveSettings({ whisperModel: dest });
    return dest;
  });

  // ---------- Claude Code sign-in (uses the CLI bundled with the Agent SDK) ----------
  // ---------- the user's own Claude Code (IngrainedCut never signs anyone in to Claude itself) ----------
  function runClaude(cc, args) {
    return new Promise((resolve) => {
      // a cli.js from an npm install runs with this same Node/Electron binary
      const [cmd, argv, env] = cc.path.endsWith('.js')
        ? [process.execPath, [cc.path, ...args], { ...process.env, ELECTRON_RUN_AS_NODE: '1' }]
        : [cc.path, args, { ...process.env }];
      const p = spawn(cmd, argv, { windowsHide: true, env });
      let out = '';
      const take = (d) => (out += d.toString());
      p.stdout.on('data', take);
      p.stderr.on('data', take);
      p.on('error', (e) => resolve({ code: -1, out: e.message }));
      p.on('close', (code) => resolve({ code, out }));
      setTimeout(() => p.kill(), 15000).unref?.();
    });
  }

  async function claudeStatus() {
    const s = getSettings();
    const cc = findClaudeCode();
    if (!cc) return { installed: false, loggedIn: false, apiKey: !!s.apiKey, ready: false, install: CLAUDE_CODE_INSTALL };
    const r = await runClaude(cc, ['auth', 'status']);
    let st = { loggedIn: false };
    try {
      st = JSON.parse(r.out.slice(r.out.indexOf('{')));
    } catch {}
    return { ...st, installed: true, source: cc.source, path: cc.path, method: st.authMethod, apiKey: !!s.apiKey, ready: !!s.apiKey };
  }
  const SIGN_IN_THERE = 'The chat here runs on an Anthropic API key (Settings). To use your Claude subscription, connect your own Claude Code: Help → Use your own Claude Code, Codex or Cursor (MCP).';
  handle('auth:status', claudeStatus);
  handle('auth:login', () => ({ ok: false, out: SIGN_IN_THERE }));
  handle('auth:cancel', () => {});

  const bridge = startBridge(dispatch, noteExternal);

  return {
    isDirty: () => dirty,
    shutdown() {
      for (const a of Object.values(agents)) a.reset();
      cancelProviderLogin();
      bridge.close();
      clearInterval(externalsTimer);
    },
  };
}
