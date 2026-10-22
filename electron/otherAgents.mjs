// Codex and Cursor as the chat's agent. Each turn runs the user's own CLI (their login, their plan) with the
// IngrainedCut tools attached through mcp/server.mjs, and maps its stream onto the same chat events agent.mjs emits.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { EDITOR_GUIDE } from './agent.mjs';
import { userDataDir } from './paths.mjs';
import { findPackage, importPackage, npmInstall } from './runtimePackages.mjs';
import { TOOL_DEFS } from './tools.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MCP_SERVER = path.join(ROOT, 'mcp', 'server.mjs');
const SERVER = 'ingrainedcut';
const TOOL_NAMES = new Set(TOOL_DEFS.map((d) => d.name));
const isWin = process.platform === 'win32';

const GUIDE = `${EDITOR_GUIDE.replace(/the mcp__ingrainedcut__ tools/g, 'the ingrainedcut MCP tools').replace(
  'load the `hyperframes` skill with the Skill tool and follow its workflow and the skills it routes to (hyperframes-core, -animation, -creative, -cli, -registry, media-use...)',
  'use the `hyperframes` skill if you have it; otherwise follow the HyperFrames CLI (`npx hyperframes --help`, and the AGENTS.md / docs it scaffolds into each project)',
)}
Tool results and the <editor_state> block are the source of truth for the timeline. The ingrainedcut tools are your editing hands; do not try to edit the project file on disk.`;

/** How Codex / Cursor start the IngrainedCut MCP server (with this same Node or Electron binary), pinned to this engine. */
function mcpLaunch(provider, bridge) {
  return {
    command: process.execPath,
    args: [MCP_SERVER],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      ICUT_CLIENT_ID: `inapp-${provider}`,
      ICUT_CLIENT_NAME: provider === 'codex' ? 'Codex' : 'Cursor',
      ...(bridge ? { ICUT_BRIDGE: JSON.stringify(bridge) } : {}),
    },
  };
}

function run(bin, args, { timeout = 15000, env } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, windowsHide: true, env: env ?? process.env, shell: isWin && /\.(cmd|bat)$/i.test(bin), maxBuffer: 32 << 20 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out: `${stdout ?? ''}${stderr ?? ''}`, stdout: String(stdout ?? '') }),
    );
  });
}

function killTree(p) {
  if (!p || p.exitCode != null) return;
  if (isWin) execFile('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else p.kill('SIGTERM');
}

/** Quote for cmd.exe when a .cmd shim has to go through the shell (our own args only: paths, ids, a fixed prompt). */
const winQuote = (a) => (/[\s"&|<>^%]/.test(a) ? `"${a.replace(/"/g, '')}"` : a);

function tmpImage(img) {
  const f = path.join(os.tmpdir(), `icut-frame-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${img.mediaType === 'image/png' ? 'png' : 'jpg'}`);
  fs.writeFileSync(f, Buffer.from(img.data, 'base64'));
  return f;
}

const editorToolName = (server, tool) => (TOOL_NAMES.has(tool) ? `mcp__${SERVER}__${tool}` : `mcp__${server || 'mcp'}__${tool}`);

// ---------- shared turn loop ----------
class CliAgent {
  constructor(o) {
    this.o = o;
    this.queue = [];
    this.busy = false;
    this.gen = 0;
    this.aborted = false;
    this.seenTools = new Set();
  }
  emit(ev) {
    this.o.emit('agent:event', ev);
  }

  send(msg) {
    this.queue.push(msg);
    this.emit({ type: 'busy' });
    if (!this.busy) this.drain();
  }

  async drain() {
    this.busy = true;
    const gen = this.gen;
    while (this.queue.length && gen === this.gen) {
      const msg = this.queue.shift();
      const started = Date.now();
      this.aborted = false;
      try {
        const r = await this.turn(msg);
        if (gen !== this.gen) return;
        this.emit({ type: 'result', ok: true, durationMs: Date.now() - started, usage: r?.usage });
      } catch (e) {
        if (gen !== this.gen) return;
        if (this.aborted) {
          this.queue.length = 0;
          this.emit({ type: 'result', ok: false, error: 'stopped', durationMs: Date.now() - started });
        } else {
          this.emit({ type: 'error', message: this.friendlyError(e) });
          this.emit({ type: 'result', ok: false, error: 'error', durationMs: Date.now() - started });
        }
      }
    }
    if (gen !== this.gen) return;
    this.busy = false;
    this.emit({ type: 'idle' });
  }

  /** Emit tool_use once per call id, then tool_result when it finishes. */
  tool(done, id, name, input, result) {
    if (!this.seenTools.has(id)) {
      this.seenTools.add(id);
      this.emit({ type: 'tool_use', id, name, input });
    }
    if (done) {
      const r = result();
      this.emit({ type: 'tool_result', id, isError: !!r.isError, text: String(r.text ?? '').slice(0, 4000), images: r.images || 0 });
    }
  }

  interrupt() {
    if (!this.busy) return;
    this.aborted = true;
    this.abort();
  }

  reset() {
    this.gen++;
    this.queue = [];
    this.aborted = true;
    this.abort();
    this.session = null;
    this.busy = false;
    this.seenTools.clear();
    this.emit({ type: 'idle' });
  }

  // model, effort and permissions are read from settings at the start of every turn
  setModel() {}
  setEffort() {}
  setBypass() {}
}

// ---------- Codex ----------
// Codex is large (~450 MB with its native CLI), so the helper installs it the first time someone picks it, into the
// app's data folder. A checkout of this repo (desktop app, development) has it in node_modules already.
const CODEX_SDK = '@openai/codex-sdk@0.163.0';
const codexDir = () => path.join(userDataDir(), 'agents');

const findCodexSdk = () => findPackage('@openai/codex-sdk', codexDir());

async function loadCodexSdk() {
  const dir = findCodexSdk();
  if (!dir) throw new Error('CODEX_MISSING');
  return importPackage(dir);
}

/** Install Codex into the app data folder (first use), streaming npm's output. */
export async function installCodex(onLine) {
  const r = await npmInstall(codexDir(), [CODEX_SDK], { onLine });
  return { ok: r.ok && !!codexBinary(), out: r.out };
}

export function codexBinary() {
  try {
    const sdk = findCodexSdk();
    if (!sdk) return null;
    const codexPkg = createRequire(path.join(sdk, 'package.json')).resolve('@openai/codex/package.json');
    const plat = createRequire(codexPkg).resolve(`@openai/codex-${process.platform}-${process.arch}/package.json`);
    const vendor = path.join(path.dirname(plat), 'vendor');
    for (const triple of fs.readdirSync(vendor)) {
      const bin = path.join(vendor, triple, 'bin', isWin ? 'codex.exe' : 'codex');
      if (fs.existsSync(bin)) return bin;
      const alt = path.join(vendor, triple, 'codex', isWin ? 'codex.exe' : 'codex');
      if (fs.existsSync(alt)) return alt;
    }
  } catch {}
  return null;
}

export class CodexAgent extends CliAgent {
  constructor(o) {
    super(o);
    this.textLen = new Map();
  }

  abort() {
    this.ctrl?.abort();
  }

  async turn({ text, context, images = [] }) {
    const s = this.o.getSettings();
    const { Codex } = await loadCodexSdk();
    const codex = new Codex({
      apiKey: s.openaiApiKey || undefined,
      config: {
        developer_instructions: GUIDE,
        mcp_servers: { [SERVER]: { ...mcpLaunch('codex', this.o.getBridge?.()), startup_timeout_sec: 30, tool_timeout_sec: 1800, default_tools_approval_mode: 'approve' } },
      },
    });
    const opts = {
      workingDirectory: this.o.getCwd(),
      skipGitRepoCheck: true,
      approvalPolicy: 'never',
      sandboxMode: s.autoApproveAll ? 'danger-full-access' : 'workspace-write',
      networkAccessEnabled: true,
      model: s.codexModel || undefined,
      modelReasoningEffort: s.codexEffort || undefined,
    };
    const thread = this.session ? codex.resumeThread(this.session, opts) : codex.startThread(opts);
    const input = [{ type: 'text', text: (context ? context + '\n\n' : '') + text }];
    const files = images.map(tmpImage);
    for (const f of files) input.push({ type: 'local_image', path: f });
    this.ctrl = new AbortController();
    let usage = null;
    let failed = null;
    let lastError = null;
    try {
      const { events } = await thread.runStreamed(input, { signal: this.ctrl.signal });
      for await (const e of events) {
        switch (e.type) {
          case 'thread.started':
            if (!this.session) this.emit({ type: 'init', model: opts.model || 'Codex default', sessionId: e.thread_id, mcpStatus: 'connected', version: 'Codex' });
            this.session = e.thread_id;
            break;
          case 'item.started':
          case 'item.updated':
          case 'item.completed':
            this.item(e.type === 'item.completed', e.item);
            break;
          case 'turn.completed':
            usage = e.usage;
            break;
          case 'turn.failed':
            failed = e.error?.message || 'Codex turn failed';
            break;
          case 'error':
            // retries and transport fallbacks are reported here too; only a failed turn ends it
            lastError = e.message;
            this.emit({ type: 'status', status: e.message });
            break;
        }
      }
    } catch (e) {
      // the CLI exiting non-zero: its stderr is mostly log noise, the stream's own error says more
      throw new Error(failed || lastError || e.message);
    } finally {
      for (const f of files) fs.rm(f, { force: true }, () => {});
    }
    if (failed || (!usage && lastError)) throw new Error(failed || lastError);
    return { usage };
  }

  item(done, it) {
    switch (it.type) {
      case 'agent_message': {
        const prev = this.textLen.get(it.id) ?? 0;
        if ((it.text?.length ?? 0) > prev) {
          this.emit({ type: 'text_delta', text: it.text.slice(prev), msgId: it.id });
          this.textLen.set(it.id, it.text.length);
        }
        if (done) this.emit({ type: 'block_stop' });
        break;
      }
      case 'reasoning':
        if (!done) this.emit({ type: 'thinking' });
        break;
      case 'mcp_tool_call':
        this.tool(done, it.id, editorToolName(it.server, it.tool), it.arguments, () => {
          const content = it.result?.content ?? [];
          return {
            isError: it.status === 'failed' || !!it.error,
            text: it.error?.message ?? content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'),
            images: content.filter((c) => c.type === 'image').length,
          };
        });
        break;
      case 'command_execution':
        this.tool(done, it.id, 'Bash', { command: it.command }, () => ({ isError: it.status === 'failed' || (it.exit_code ?? 0) !== 0, text: it.aggregated_output }));
        break;
      case 'file_change':
        this.tool(done, it.id, 'Edit', { file_path: (it.changes ?? []).map((c) => `${c.kind} ${c.path}`).join(', ') }, () => ({ isError: it.status === 'failed', text: '' }));
        break;
      case 'web_search':
        this.tool(done, it.id, 'WebSearch', { query: it.query }, () => ({ text: '' }));
        break;
      case 'error':
        // non-fatal warnings (e.g. "Falling back from WebSockets…"); a real failure arrives as turn.failed
        if (it.message) this.emit({ type: 'status', status: it.message });
        break;
    }
  }

  reset() {
    super.reset();
    this.textLen.clear();
  }

  friendlyError(e) {
    const msg = e?.message || String(e);
    if (/error sending request|connection (failed|refused|reset)|routing discovery|stream disconnected|dns|ENOTFOUND|timed out/i.test(msg)) {
      return `Codex couldn't reach OpenAI — check your internet connection (or a firewall / proxy blocking chatgpt.com and api.openai.com). (${msg.slice(0, 200)})`;
    }
    if (/401|unauthori[sz]ed|not logged in|please (log|sign) in|invalid api key|incorrect api key/i.test(msg)) {
      return `Codex couldn't authenticate. Sign in with ChatGPT from the agent menu (or Settings), or add an OpenAI API key in Settings. (${msg.slice(0, 300)})`;
    }
    if (msg === 'CODEX_MISSING' || /ENOENT|Unable to locate Codex/i.test(msg)) return 'Codex isn’t installed yet. Pick Codex in the agent menu and click Install Codex.';
    return msg.slice(0, 1200);
  }
}

// ---------- Cursor ----------
let cursorBin;
export async function cursorBinary() {
  if (cursorBin !== undefined) return cursorBin;
  const names = ['cursor-agent', 'agent'];
  for (const n of names) {
    const r = await run(isWin ? 'where' : 'which', [n], { timeout: 5000 });
    const hit = r.code === 0 ? r.stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : [];
    // prefer the native shim (.cmd / .exe) on Windows
    const pick = hit.find((h) => /\.(exe|cmd)$/i.test(h)) ?? hit[0];
    if (pick && (n !== 'agent' || (await run(pick, ['--version'], { timeout: 8000 })).out.match(/\d+\.\d+/))) return (cursorBin = pick);
  }
  const local = isWin ? path.join(process.env.LOCALAPPDATA ?? '', 'cursor-agent', 'cursor-agent.cmd') : path.join(os.homedir(), '.local', 'bin', 'cursor-agent');
  return (cursorBin = fs.existsSync(local) ? local : null);
}

export const CURSOR_INSTALL = isWin ? `irm 'https://cursor.com/install?win32=true' | iex` : 'curl https://cursor.com/install -fsS | bash';

/** Cursor reads MCP servers from <workspace>/.cursor/mcp.json: add ours, keep anything already there. */
function writeCursorMcp(cwd, bridge) {
  const f = path.join(cwd, '.cursor', 'mcp.json');
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {}
  cfg.mcpServers = { ...(cfg.mcpServers ?? {}), [SERVER]: mcpLaunch('cursor', bridge) };
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
}

const CURSOR_TOOL_NAMES = { readToolCall: 'Read', writeToolCall: 'Write', editToolCall: 'Edit', deleteToolCall: 'Delete', shellToolCall: 'Bash', grepToolCall: 'Grep', globToolCall: 'Glob', lsToolCall: 'LS', webSearchToolCall: 'WebSearch' };

function cursorTool(tc) {
  const key = Object.keys(tc ?? {})[0];
  const v = tc?.[key] ?? {};
  const a = v.args ?? {};
  if (key === 'function') {
    let input = v.arguments;
    try {
      input = JSON.parse(v.arguments);
    } catch {}
    return { name: TOOL_NAMES.has(v.name) ? editorToolName(SERVER, v.name) : v.name, input, v };
  }
  if (/mcp/i.test(key)) {
    const tool = a.toolName ?? a.name ?? a.tool;
    return { name: editorToolName(a.providerIdentifier ?? a.serverName ?? a.server, tool), input: a.args ?? a.arguments ?? a.input ?? {}, v };
  }
  const name = CURSOR_TOOL_NAMES[key] ?? key?.replace(/ToolCall$/, '') ?? 'tool';
  const input = { ...a };
  if (a.path && !a.file_path) input.file_path = a.path;
  delete input.fileText;
  return { name, input, v };
}

function cursorResult(v) {
  const r = v.result ?? {};
  const ok = r.success ?? null;
  const err = r.error ?? r.failure ?? r.rejected ?? null;
  let text = '';
  const src = ok ?? err;
  if (src) {
    const content = src.content ?? src.output ?? src.stdout ?? src.result;
    if (Array.isArray(content)) text = content.map((c) => c?.text?.text ?? c?.text ?? (typeof c === 'string' ? c : '')).join('\n');
    else if (typeof content === 'string') text = content;
    else text = JSON.stringify(src);
  }
  return { isError: !ok && !!err, text, images: 0 };
}

export class CursorAgent extends CliAgent {
  abort() {
    killTree(this.proc);
  }

  async turn({ text, context, images = [] }) {
    const s = this.o.getSettings();
    const bin = await cursorBinary();
    if (!bin) throw new Error('CURSOR_MISSING');
    const cwd = this.o.getCwd();
    writeCursorMcp(cwd, this.o.getBridge?.());
    // the editor state is large and the Windows command line is not, so the turn goes through a file
    const dir = path.join(cwd, '.ingrainedcut');
    fs.mkdirSync(dir, { recursive: true });
    const frames = images.map((img, i) => {
      const f = path.join(dir, `frame-${i + 1}.${img.mediaType === 'image/png' ? 'png' : 'jpg'}`);
      fs.writeFileSync(f, Buffer.from(img.data, 'base64'));
      return f;
    });
    const turnFile = path.join(dir, 'chat-turn.md');
    fs.writeFileSync(
      turnFile,
      [
        this.session ? '(Your IngrainedCut instructions are unchanged from earlier in this conversation.)' : GUIDE,
        context || '',
        frames.length ? `The user attached the current program monitor frame: ${frames.join(', ')}` : '',
        `## The user's message\n${text}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
    const prompt = 'IngrainedCut chat turn: read .ingrainedcut/chat-turn.md (your instructions, the live editor state and the user message), then do what the user asks.';
    const args = ['-p', '--output-format', 'stream-json', '--stream-partial-output', '--approve-mcps', '--workspace', cwd];
    if (s.autoApproveAll) args.push('--force');
    if (s.cursorModel) args.push('--model', s.cursorModel);
    if (this.session) args.push('--resume', this.session);
    args.push(prompt);
    const env = { ...process.env };
    if (s.cursorApiKey) env.CURSOR_API_KEY = s.cursorApiKey;
    const shell = isWin && /\.(cmd|bat)$/i.test(bin);
    const p = spawn(shell ? `"${bin}"` : bin, shell ? args.map(winQuote) : args, { cwd, env, windowsHide: true, shell });
    this.proc = p;
    let buf = '';
    let errTail = '';
    let final = null;
    const onLine = (line) => {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      switch (m.type) {
        case 'system':
          if (m.subtype === 'init') {
            if (!this.session) this.emit({ type: 'init', model: m.model, sessionId: m.session_id, mcpStatus: 'connected', apiKeySource: m.apiKeySource, version: 'Cursor' });
            this.session = m.session_id;
          }
          break;
        case 'assistant':
          // with --stream-partial-output only events with timestamp_ms and no model_call_id are new text
          if (m.timestamp_ms != null && m.model_call_id == null) {
            const t = (m.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
            if (t) this.emit({ type: 'text_delta', text: t });
          } else if (m.timestamp_ms == null && m.model_call_id == null) this.emit({ type: 'block_stop' });
          break;
        case 'tool_call': {
          const { name, input, v } = cursorTool(m.tool_call);
          this.tool(m.subtype === 'completed', m.call_id, name, input, () => cursorResult(v));
          break;
        }
        case 'result':
          final = m;
          if (m.session_id) this.session = m.session_id;
          break;
      }
    };
    p.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) onLine(line);
      }
    });
    p.stderr.on('data', (d) => (errTail = (errTail + d.toString()).slice(-4000)));
    const code = await new Promise((resolve) => {
      p.on('error', (e) => {
        errTail += e.message;
        resolve(-1);
      });
      p.on('close', resolve);
    });
    if (buf.trim()) onLine(buf.trim());
    this.proc = null;
    if (this.aborted) throw new Error('stopped');
    if (final?.is_error) throw new Error(final.result || 'Cursor reported an error');
    if (!final && code !== 0) throw new Error(errTail.trim() || `cursor-agent exited with code ${code}`);
    return { usage: null };
  }

  friendlyError(e) {
    const msg = e?.message || String(e);
    if (msg === 'CURSOR_MISSING') return `The Cursor CLI isn't installed. Install it with \`${CURSOR_INSTALL}\`, then sign in from the agent menu.`;
    if (/ENOTFOUND|getaddrinfo|ECONNREFUSED|network error|fetch failed/i.test(msg)) return `Cursor couldn't reach its servers — check your internet connection. (${msg.slice(0, 200)})`;
    if (/not (logged|signed) in|authenticat|unauthori[sz]ed|please (log|sign) in|cursor-agent login/i.test(msg)) {
      return `Cursor couldn't authenticate. Sign in from the agent menu (or Settings), or add a Cursor API key in Settings. (${msg.slice(0, 300)})`;
    }
    return msg.slice(0, 1200);
  }
}

// ---------- sign-in status, login and model lists ----------
export async function providerStatus(p, settings) {
  if (p === 'codex') {
    const bin = codexBinary();
    if (!bin) return { installed: false, loggedIn: false, apiKey: !!settings.openaiApiKey, ready: false, install: 'auto' };
    const r = await run(bin, ['login', 'status']);
    const loggedIn = r.code === 0 && /logged in/i.test(r.out) && !/not logged in/i.test(r.out);
    const method = r.out.match(/logged in using (?:an? )?([^\r\n]+)/i)?.[1]?.trim();
    return { installed: true, loggedIn, method, apiKey: !!settings.openaiApiKey, ready: loggedIn || !!settings.openaiApiKey };
  }
  if (p === 'cursor') {
    const bin = await cursorBinary();
    if (!bin) return { installed: false, loggedIn: false, apiKey: !!settings.cursorApiKey, ready: false, install: CURSOR_INSTALL };
    const r = await run(bin, ['status']);
    const out = r.out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    const loggedIn = /logged in|authenticated/i.test(out) && !/not (logged in|authenticated)/i.test(out);
    const email = out.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
    return { installed: true, loggedIn, email, apiKey: !!settings.cursorApiKey, ready: loggedIn || !!settings.cursorApiKey };
  }
  throw new Error('Unknown provider ' + p);
}

let loginProc = null;
export async function providerLogin(p, onLine) {
  const bin = p === 'codex' ? codexBinary() : await cursorBinary();
  if (!bin) return { ok: false, out: p === 'codex' ? 'Install Codex first.' : `Install the Cursor CLI first: ${CURSOR_INSTALL}` };
  const shell = isWin && /\.(cmd|bat)$/i.test(bin);
  return new Promise((resolve) => {
    const proc = spawn(shell ? `"${bin}"` : bin, ['login'], { windowsHide: true, shell, env: { ...process.env } });
    loginProc = proc;
    let out = '';
    const take = (d) => {
      const s = d.toString().replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
      out += s;
      for (const line of s.split(/\r?\n/)) if (line.trim()) onLine(line.trim());
    };
    proc.stdout.on('data', take);
    proc.stderr.on('data', take);
    proc.on('error', (e) => resolve({ ok: false, out: e.message }));
    proc.on('close', (code) => {
      loginProc = null;
      resolve({ ok: code === 0, out: out.slice(-2000) });
    });
  });
}
export function cancelProviderLogin() {
  killTree(loginProc);
}

const modelCache = {};
export async function providerModels(p) {
  if (modelCache[p]) return modelCache[p];
  let list = [];
  if (p === 'codex') {
    const bin = codexBinary();
    const r = bin ? await run(bin, ['debug', 'models'], { timeout: 20000 }) : { stdout: '' };
    try {
      const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
      list = (j.models ?? [])
        .filter((m) => m.visibility === 'list')
        .map((m) => ({
          id: m.slug,
          label: m.display_name || m.slug,
          desc: m.description,
          efforts: (m.supported_reasoning_levels ?? []).map((x) => x.effort ?? x),
          defaultEffort: m.default_reasoning_level,
        }));
    } catch {}
  } else if (p === 'cursor') {
    const bin = await cursorBinary();
    if (bin) {
      for (const args of [['models'], ['--list-models']]) {
        const r = await run(bin, args, { timeout: 20000 });
        const out = r.out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
        for (const line of out.split(/\r?\n/)) {
          const m = line.match(/^\s*([\w.:/-]+)\s+-\s+(.+?)\s*(\((?:current|default)\))?\s*$/i);
          if (m) list.push({ id: m[1], label: m[2] });
        }
        if (list.length) break;
      }
    }
  }
  if (list.length) modelCache[p] = list;
  return list;
}
