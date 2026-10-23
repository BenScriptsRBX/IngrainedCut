import React, { useEffect, useState } from 'react';
import { useEditor, setS, S, commit, toast } from '../store';
import { Modal, ColorSwatch } from './Widgets';
import { Icon } from './Icons';
import { runExport, cancelExport, BROWSER_FORMATS, type ExportOptions } from '../exporter';
import { isBrowserEngine, isSite } from '../webBridge';
import { SyncDialog, SilenceDialog } from './EditDialogs';
import { AppPicker, MCP_APPS, connectCommand, useMcpApp } from './HelperConnect';
import { sequenceDuration, setClipSpeed } from '../ops';
import { fmtTC } from '../time';
import { MODELS, EFFORTS, setModel, useChat } from '../chatStore';

export function Dialogs() {
  const dialog = useEditor((s) => s.dialog);
  const close = () => setS({ dialog: null });
  return (
    <>
      {dialog === 'export' && <ExportDialog onClose={close} />}
      {dialog === 'settings' && <SettingsDialog onClose={close} />}
      {dialog === 'sequence' && <SequenceDialog onClose={close} />}
      {dialog === 'speed' && <SpeedDialog onClose={close} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={close} />}
      {dialog === 'mcp' && <McpDialog onClose={close} />}
      {dialog === 'about' && <AboutDialog onClose={close} />}
      {dialog === 'sync' && <SyncDialog onClose={close} />}
      {dialog === 'silence' && <SilenceDialog onClose={close} />}
      <ExportProgress />
      <CompositionRenders />
      <Toasts />
    </>
  );
}

const FORMATS: { id: ExportOptions['format']; label: string; ext: string }[] = [
  { id: 'mp4-h264', label: 'H.264 (.mp4)', ext: 'mp4' },
  { id: 'mp4-h265', label: 'HEVC / H.265 (.mp4)', ext: 'mp4' },
  { id: 'mov-prores', label: 'Apple ProRes 422 HQ (.mov)', ext: 'mov' },
  { id: 'webm-vp9', label: 'VP9 (.webm)', ext: 'webm' },
  { id: 'gif', label: 'Animated GIF (.gif)', ext: 'gif' },
  { id: 'mp3', label: 'MP3 audio only (.mp3)', ext: 'mp3' },
  { id: 'wav', label: 'WAV audio only (.wav)', ext: 'wav' },
];

function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  // in the browser (no helper) only the formats the page can encode itself; files go where the user picks
  const inBrowser = isBrowserEngine();
  const formats = inBrowser ? FORMATS.filter((f) => BROWSER_FORMATS.includes(f.id)) : FORMATS;
  const [format, setFormat] = useState<ExportOptions['format']>('mp4-h264');
  const [quality, setQuality] = useState(18);
  const [scale, setScale] = useState(1);
  const hasInOut = project.inPoint != null && project.outPoint != null && project.outPoint > project.inPoint;
  const [range, setRange] = useState<'all' | 'in-out'>(hasInOut ? 'in-out' : 'all');
  const [path, setPath] = useState('');
  const ext = FORMATS.find((f) => f.id === format)!.ext;
  useEffect(() => {
    if (inBrowser) return setPath(`${project.settings.name}.${ext}`);
    window.icut.appInfo().then((i) => {
      const dir = project.path ? project.path.replace(/[\\/][^\\/]+$/, '') : i.documents + '\\IngrainedCut';
      setPath(`${dir}\\${project.settings.name}.${ext}`);
    });
  }, []);
  useEffect(() => setPath((p) => p.replace(/\.[a-z0-9]+$/i, '.' + ext)), [ext]);
  const dur = range === 'in-out' && hasInOut ? project.outPoint! - project.inPoint! : sequenceDuration(project);
  const W = Math.round((project.settings.width * scale) / 2) * 2;
  const H = Math.round((project.settings.height * scale) / 2) * 2;
  const start = async () => {
    let out = path;
    if (inBrowser) {
      // the save picker must open inside this click
      const p = await window.icut.saveDialog({ title: 'Export', defaultPath: path, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
      if (!p) return;
      out = p;
    }
    onClose();
    try {
      await runExport({ path: out, format, quality, range, scale });
    } catch (e: any) {
      toast(e.message, 'error', 8000);
    }
  };
  return (
    <Modal
      title="Export Settings"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={start} disabled={!path || dur <= 0}>
            Export
          </button>
        </>
      }
    >
      <div className="form">
        <label>Format</label>
        <select value={format} onChange={(e) => setFormat(e.target.value as any)}>
          {formats.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        {!['mp3', 'wav', 'mov-prores', 'gif'].includes(format) && (
          <>
            <label>Quality</label>
            <select value={quality} onChange={(e) => setQuality(Number(e.target.value))}>
              <option value={14}>Maximum (large file)</option>
              <option value={18}>High</option>
              <option value={22}>Medium</option>
              <option value={27}>Low (small file)</option>
            </select>
          </>
        )}
        {!['mp3', 'wav'].includes(format) && (
          <>
            <label>Resolution</label>
            <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
              <option value={1}>Match sequence ({project.settings.width}×{project.settings.height})</option>
              <option value={0.75}>75%</option>
              <option value={0.5}>50%</option>
              <option value={0.25}>25%</option>
            </select>
          </>
        )}
        <label>Range</label>
        <select value={range} onChange={(e) => setRange(e.target.value as any)}>
          <option value="all">Entire Sequence</option>
          <option value="in-out" disabled={!hasInOut}>
            Sequence In/Out {hasInOut ? '' : '(not set)'}
          </option>
        </select>
        <label>{inBrowser ? 'File Name' : 'Output Name'}</label>
        <div className="row">
          <input className="grow" value={path} onChange={(e) => setPath(e.target.value)} />
          {!inBrowser && (
            <button
              className="btn"
              onClick={async () => {
                const p = await window.icut.saveDialog({ title: 'Export', defaultPath: path, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
                if (p) setPath(p);
              }}
            >
              Browse…
            </button>
          )}
        </div>
      </div>
      {inBrowser && <div className="hint">Encoded right here in your browser. ProRes, GIF and MP3 need the IngrainedCut helper.</div>}
      <div className="export-summary">
        <div>
          <b>Video:</b> {['mp3', 'wav'].includes(format) ? 'none' : `${W}×${H}, ${project.settings.fps} fps`}
        </div>
        <div>
          <b>Audio:</b> {format === 'gif' ? 'none' : '48 kHz stereo'}
        </div>
        <div>
          <b>Duration:</b> {fmtTC(dur, project.settings.fps)}
        </div>
      </div>
    </Modal>
  );
}

function ExportProgress() {
  const job = useEditor((s) => s.exportJob);
  if (!job) return null;
  return (
    <div className="export-progress">
      <div className="ep-title">
        <Icon name="export" size={14} /> Exporting {job.path.split(/[\\/]/).pop()}
      </div>
      <div className="ep-bar">
        <div style={{ width: `${Math.round(job.progress * 100)}%` }} />
      </div>
      <div className="ep-row">
        <span className="dim">{job.phase}</span>
        <span className="grow" />
        <span>{Math.round(job.progress * 100)}%</span>
        <button className="btn sm danger" onClick={cancelExport}>
          Cancel
        </button>
      </div>
    </div>
  );
}

type RenderJob = Parameters<Parameters<typeof window.icut.onCompositionProgress>[0]>[0];

/** Live progress of HyperFrames renders started by Claude. */
function CompositionRenders() {
  const [jobs, setJobs] = useState<Record<number, RenderJob>>({});
  useEffect(
    () =>
      window.icut.onCompositionProgress((j) => {
        setJobs((x) => ({ ...x, [j.id]: j }));
        if (j.done) setTimeout(() => setJobs(({ [j.id]: _gone, ...rest }) => rest), j.error ? 9000 : 3500);
      }),
    [],
  );
  const list = Object.values(jobs);
  if (!list.length) return null;
  return (
    <div className="hf-renders">
      {list.map((j) => (
        <div key={j.id} className={'export-progress hf' + (j.error ? ' failed' : '')}>
          <div className="ep-title">
            <span className="hf-badge">HF</span> Rendering composition “{j.name}” <span className="dim">({j.format})</span>
          </div>
          <div className="ep-bar">
            <div style={{ width: `${Math.round((j.done && !j.error ? 1 : j.progress) * 100)}%` }} />
          </div>
          <div className="ep-row">
            <span className="dim hf-line">{j.error ? `Failed: ${j.error}` : j.line}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.kind}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<any>(null);
  const [info, setInfo] = useState<any>(null);
  const [dl, setDl] = useState<{ name: string; got: number; total: number } | null>(null);
  useEffect(() => {
    window.icut.getSettings().then(setSt);
    window.icut.appInfo().then(setInfo);
    return window.icut.onWhisperProgress((p) => setDl((d) => (d ? { ...d, ...p } : d)));
  }, []);
  if (!st) return null;
  const save = async (patch: any) => setSt(await window.icut.setSettings(patch));
  const download = async (name: string) => {
    setDl({ name, got: 0, total: 0 });
    try {
      const p = await window.icut.downloadWhisper(name);
      setSt(await window.icut.getSettings());
      toast(`Whisper model ready: ${p.split(/[\\/]/).pop()}`, 'success');
    } catch (e: any) {
      toast(e.message, 'error');
    }
    setDl(null);
  };
  return (
    <Modal title="Settings" onClose={onClose} width={600} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <h4 className="form-h">Claude</h4>
      <div className="form">
        <label>Status</label>
        <AuthBox />
        <label>Anthropic API key</label>
        <div>
          <input type="password" placeholder="sk-ant-…" defaultValue={st.apiKey} onBlur={(e) => save({ apiKey: e.target.value.trim() })} style={{ width: '100%' }} />
          <div className="hint">
            Needed for the Claude chat here (billed by Anthropic at API prices; create one at console.anthropic.com). Stored only on this computer. To use a
            Claude subscription instead, <a onClick={() => setS({ dialog: 'mcp' })}>connect your own Claude Code</a>.
          </div>
        </div>
        <label>Default model</label>
        <div>
          <select
            value={MODELS.some((m) => m.id === st.model) ? st.model : '__custom'}
            onChange={async (e) => {
              const v = e.target.value === '__custom' ? window.prompt('Model ID', st.model)?.trim() : e.target.value;
              if (!v) return;
              if (useChat.getState().provider === 'claude') setModel(v, st.effort);
              else save({ model: v });
              setSt({ ...st, model: v });
            }}
            style={{ width: '100%' }}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.desc}
              </option>
            ))}
            <option value="__custom">{MODELS.some((m) => m.id === st.model) ? 'Custom model ID…' : `Custom: ${st.model}`}</option>
          </select>
          <div className="hint">Also switchable any time from the model button at the top of the Claude panel.</div>
        </div>
        <label>Effort</label>
        <select
          value={st.effort}
          onChange={(e) => {
            if (useChat.getState().provider === 'claude') setModel(st.model, e.target.value);
            else save({ effort: e.target.value });
            setSt({ ...st, effort: e.target.value });
          }}
        >
          {EFFORTS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.id} — {x.desc}
            </option>
          ))}
        </select>
        <label>Permissions</label>
        <label className="check">
          <input type="checkbox" checked={st.autoApproveAll} onChange={(e) => save({ autoApproveAll: e.target.checked })} />
          Let the agent run non-editor tools (shell, file edits) without asking
        </label>
      </div>
      <h4 className="form-h">Codex</h4>
      <div className="form">
        <label>Status</label>
        <ProviderAuth provider="codex" />
        <label>OpenAI API key</label>
        <div>
          <input type="password" placeholder="sk-…" defaultValue={st.openaiApiKey} onBlur={(e) => save({ openaiApiKey: e.target.value.trim() })} style={{ width: '100%' }} />
          <div className="hint">
            Needed for the Codex chat here (billed by OpenAI at API prices; create one at platform.openai.com). Stored only on this computer. To use a
            ChatGPT plan instead, <a onClick={() => setS({ dialog: 'mcp' })}>connect your own Codex</a>.
          </div>
        </div>
      </div>
      <h4 className="form-h">Cursor</h4>
      <div className="form">
        <label>Account</label>
        <ProviderAuth provider="cursor" />
        <label>Cursor API key</label>
        <div>
          <input type="password" placeholder="(optional)" defaultValue={st.cursorApiKey} onBlur={(e) => save({ cursorApiKey: e.target.value.trim() })} style={{ width: '100%' }} />
          <div className="hint">Optional. Leave empty to use your Cursor sign-in. Stored only on this computer.</div>
        </div>
      </div>
      <div className="hint" style={{ margin: '4px 0 8px' }}>
        Pick which agent you chat with from the model button at the top of the chat panel.
      </div>
      <h4 className="form-h">Transcription (Whisper)</h4>
      <div className="form">
        <label>Model file</label>
        <div>
          <div className="row">
            <input className="grow" readOnly value={st.whisperModel || 'Not set'} />
            <button
              className="btn"
              onClick={async () => {
                const p = await window.icut.chooseFile({ title: 'Choose whisper.cpp ggml model', filters: [{ name: 'GGML model', extensions: ['bin'] }] });
                if (p) save({ whisperModel: p });
              }}
            >
              Choose…
            </button>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            {['tiny.en', 'base.en', 'small.en', 'base'].map((n) => (
              <button key={n} className="btn sm" disabled={!!dl} onClick={() => download(n)}>
                Download {n}
              </button>
            ))}
          </div>
          {dl && (
            <div className="hint">
              Downloading ggml-{dl.name}.bin… {dl.total ? `${Math.round((dl.got / dl.total) * 100)}%` : `${(dl.got / 1e6).toFixed(0)} MB`}
            </div>
          )}
          <div className="hint">Used by Claude's transcribe tool (cut by dialogue, captions). base.en (~150 MB) is a good default; files come from huggingface.co/ggerganov/whisper.cpp.</div>
        </div>
      </div>
      <h4 className="form-h">System</h4>
      <div className="form">
        <label>FFmpeg</label>
        <div>{info ? (info.ffmpegOk ? '✓ Found on PATH' : '✗ Not found — install FFmpeg and add it to PATH') : '…'}</div>
        <label>Data folder</label>
        <div className="mono tiny">{info?.userData}</div>
      </div>
    </Modal>
  );
}

const CLAUDE_SOURCE: Record<string, string> = {
  'desktop-app': 'from the Claude app',
  path: 'installed on this computer',
  local: 'installed on this computer',
  override: 'from ICUT_CLAUDE_PATH',
};

/**
 * The built-in Claude chat runs the user's own Claude Code on their Anthropic API key (Anthropic doesn't allow apps built
 * on the Agent SDK to use a Claude subscription). This shows whether both are there, and points subscribers to MCP.
 */
export function AuthBox({ compact }: { compact?: boolean }) {
  const [st, setSt] = useState<Awaited<ReturnType<typeof window.icut.authStatus>> | null>(null);
  const [checking, setChecking] = useState(false);
  const refresh = async () => {
    setChecking(true);
    setSt(await window.icut.authStatus());
    setChecking(false);
  };
  useEffect(() => void refresh(), []);
  if (!st) return <div className="dim">Looking for Claude Code…</div>;
  const again = (
    <a onClick={refresh} style={{ marginLeft: 6 }}>
      {checking ? 'Checking…' : 'Check again'}
    </a>
  );
  const mcp = <a onClick={() => setS({ dialog: 'mcp' })}>connect your own Claude Code</a>;
  return (
    <div className="auth-box">
      {st.installed === false ? (
        <>
          <div className="warn-text">Claude Code isn't installed on this computer.</div>
          <div className="hint">
            The chat runs Claude Code, so install it from a terminal with <code className="mono">{st.install}</code> (or install the Claude desktop app), then{' '}
            {again}.
          </div>
        </>
      ) : (
        <div>✓ Claude Code found {CLAUDE_SOURCE[st.source ?? ''] ?? ''}</div>
      )}
      {st.apiKey ? (
        <div>✓ The chat uses your Anthropic API key</div>
      ) : (
        <div className="hint">
          <span className="warn-text">Add an Anthropic API key{compact ? ' in Settings' : ' below'} to chat here.</span> Have a Claude subscription? {mcp} instead —
          it then edits this timeline on your plan.
        </div>
      )}
      {!compact && st.path && <div className="hint mono" style={{ wordBreak: 'break-all' }}>{st.path}</div>}
    </div>
  );
}

// keyOnly: the built-in chat runs on an API key; plan users connect the provider's own app over MCP instead
const PROVIDER_COPY = {
  codex: { name: 'Codex', signIn: 'Sign in with ChatGPT', key: 'an OpenAI API key', keyOnly: true, plan: 'ChatGPT plan' },
  cursor: { name: 'Cursor', signIn: 'Sign in to Cursor', key: 'a Cursor API key', keyOnly: false, plan: 'Cursor plan' },
} as const;

/** Sign-in state for Codex / Cursor: runs the CLI's own login (browser) on this computer. */
export function ProviderAuth({ provider, compact }: { provider: 'codex' | 'cursor'; compact?: boolean }) {
  const [st, setSt] = useState<ProviderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const copy = PROVIDER_COPY[provider];
  const refresh = () => window.icut.providerStatus(provider).then(setSt, () => setSt(null));
  useEffect(() => {
    setSt(null);
    refresh();
    return window.icut.onAuthOutput((l) => setLines((x) => [...x.slice(-4), l]));
  }, [provider]);
  const login = async () => {
    setBusy(true);
    setLines([]);
    const r = await window.icut.providerLogin(provider);
    setBusy(false);
    await refresh();
    toast(r.ok ? `Signed in to ${copy.name}` : 'Sign-in did not complete', r.ok ? 'success' : 'error');
  };
  if (!st) return <div className="dim">Checking…</div>;
  if (!st.installed && st.install === 'auto')
    return (
      <div className="auth-box">
        <div>{copy.name} isn't installed yet. It downloads once (about 450 MB) and then works offline from this computer.</div>
        <div className="row" style={{ marginTop: 6 }}>
          <button
            className="btn primary sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setLines([]);
              const r = await window.icut.providerInstall('codex');
              setBusy(false);
              await refresh();
              toast(r.ok ? `${copy.name} installed` : `Could not install ${copy.name}: ${r.out.slice(-200)}`, r.ok ? 'success' : 'error', 8000);
            }}
          >
            {busy ? 'Installing…' : `Install ${copy.name}`}
          </button>
        </div>
        {busy && lines.length > 0 && <div className="hint mono">{lines.join('\n')}</div>}
      </div>
    );
  if (!st.installed)
    return (
      <div className="auth-box">
        <div className="warn-text">The {copy.name} CLI isn't installed on this computer.</div>
        {st.install && (
          <div className="hint">
            Install it from a terminal: <code className="mono">{st.install}</code>, then{' '}
            <a onClick={refresh}>check again</a>.
          </div>
        )}
      </div>
    );
  if (copy.keyOnly)
    return (
      <div className="auth-box">
        <div>✓ {copy.name} is installed</div>
        {st.apiKey ? (
          <div>✓ The chat uses your API key</div>
        ) : (
          <div className="hint">
            <span className="warn-text">Add {copy.key}{compact ? ' in Settings' : ' below'} to chat here.</span> Have a {copy.plan}?{' '}
            <a onClick={() => setS({ dialog: 'mcp' })}>Connect your own {copy.name}</a> instead — it then edits this timeline on your plan.
          </div>
        )}
      </div>
    );
  return (
    <div className="auth-box">
      {st.loggedIn ? (
        <div>
          ✓ Signed in{st.email ? ` as ${st.email}` : ''} {st.method ? <span className="dim">({st.method})</span> : null}
        </div>
      ) : st.apiKey ? (
        <div>✓ Using your API key</div>
      ) : (
        <div className="warn-text">Not signed in — {copy.name} needs your account or {copy.key}.</div>
      )}
      {!st.loggedIn && (
        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
          <button className="btn primary sm" disabled={busy} onClick={login}>
            {busy ? 'Waiting for browser…' : copy.signIn}
          </button>
          {busy && (
            <button className="btn sm" onClick={() => window.icut.providerCancelLogin()}>
              Cancel
            </button>
          )}
        </div>
      )}
      {busy && lines.length > 0 && <div className="hint mono">{lines.join('\n')}</div>}
      {!compact && st.loggedIn && <div className="hint">Uses your own {copy.name} plan. IngrainedCut never sees your credentials.</div>}
    </div>
  );
}

const PRESETS = [
  { label: 'HD 1080p (16:9)', w: 1920, h: 1080 },
  { label: '4K UHD (16:9)', w: 3840, h: 2160 },
  { label: 'HD 720p (16:9)', w: 1280, h: 720 },
  { label: 'Vertical 9:16 (Shorts / Reels / TikTok)', w: 1080, h: 1920 },
  { label: 'Square 1:1', w: 1080, h: 1080 },
  { label: 'Portrait 4:5', w: 1080, h: 1350 },
  { label: 'Cinema 2.39:1', w: 1920, h: 804 },
];

function SequenceDialog({ onClose }: { onClose: () => void }) {
  const st0 = useEditor((s) => s.project.settings);
  const [st, setSt] = useState({ ...st0 });
  const apply = () => {
    commit('Sequence Settings', (d) => void (d.settings = { ...st, width: Math.round(st.width / 2) * 2, height: Math.round(st.height / 2) * 2 }));
    onClose();
  };
  return (
    <Modal title="Sequence Settings" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={apply}>OK</button></>}>
      <div className="form">
        <label>Name</label>
        <input value={st.name} onChange={(e) => setSt({ ...st, name: e.target.value })} />
        <label>Preset</label>
        <select value="" onChange={(e) => { const p = PRESETS[Number(e.target.value)]; if (p) setSt({ ...st, width: p.w, height: p.h }); }}>
          <option value="">Choose a preset…</option>
          {PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label} — {p.w}×{p.h}
            </option>
          ))}
        </select>
        <label>Frame Size</label>
        <div className="row">
          <input type="number" value={st.width} onChange={(e) => setSt({ ...st, width: Number(e.target.value) })} style={{ width: 90 }} />
          <span>×</span>
          <input type="number" value={st.height} onChange={(e) => setSt({ ...st, height: Number(e.target.value) })} style={{ width: 90 }} />
        </div>
        <label>Timebase</label>
        <select value={st.fps} onChange={(e) => setSt({ ...st, fps: Number(e.target.value) })}>
          {[23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map((f) => (
            <option key={f} value={f}>
              {f} frames/second
            </option>
          ))}
        </select>
        <label>Background</label>
        <ColorSwatch value={st.background} onChange={(v) => setSt({ ...st, background: v })} />
      </div>
    </Modal>
  );
}

function SpeedDialog({ onClose }: { onClose: () => void }) {
  const clip = S().project.clips.find((c) => S().selection.includes(c.id));
  const [pct, setPct] = useState(clip ? Math.round(clip.speed * 1000) / 10 : 100);
  const [ripple, setRipple] = useState(true);
  if (!clip) return null;
  const newDur = (clip.duration * clip.speed) / (pct / 100);
  const apply = () => {
    const ids = [...new Set(S().selection)];
    commit('Speed/Duration', (d) => {
      const done = new Set<string>();
      for (const id of ids) {
        const c = d.clips.find((x) => x.id === id);
        if (!c || done.has(c.linkId || c.id)) continue;
        done.add(c.linkId || c.id);
        setClipSpeed(d, id, pct / 100, ripple);
      }
    });
    onClose();
  };
  return (
    <Modal title="Clip Speed / Duration" onClose={onClose} width={380} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={apply}>OK</button></>}>
      <div className="form">
        <label>Speed</label>
        <div className="row">
          <input type="number" value={pct} min={5} max={2000} onChange={(e) => setPct(Number(e.target.value) || 100)} style={{ width: 90 }} autoFocus /> %
        </div>
        <label>Duration</label>
        <div>{fmtTC(newDur, S().project.settings.fps)}</div>
        <label />
        <label className="check">
          <input type="checkbox" checked={ripple} onChange={(e) => setRipple(e.target.checked)} /> Ripple Edit, Shifting Trailing Clips
        </label>
      </div>
      <div className="hint">
        {ripple
          ? 'Later clips move to make room (or close up). Linked audio changes speed too.'
          : 'Later clips stay put: a slower clip only fills the empty space before the next clip, a faster one leaves a gap. Linked audio changes speed too.'}
      </div>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / Stop'], ['J / K / L', 'Shuttle reverse / stop / forward (press again to speed up)'], ['← / →', 'Step 1 frame (Shift: 5)'],
  ['↑ / ↓', 'Previous / next edit point'], ['Home / End', 'Go to start / end'], ['I / O', 'Mark In / Out (Alt: clear)'], ['M', 'Add marker'],
  ['V', 'Selection tool'], ['A', 'Track select forward'], ['B', 'Ripple edit'], ['N', 'Rolling edit'], ['R', 'Rate stretch'], ['C', 'Razor'],
  ['Y', 'Slip'], ['U', 'Slide'], ['H', 'Hand'], ['T', 'Type'], ['Ctrl+K', 'Add edit at playhead (Shift: all tracks)'], ['Q / W', 'Ripple trim previous / next edit to playhead'],
  ['Delete', 'Clear'], ['Shift+Delete', 'Ripple delete'], ['; / \'', 'Lift / Extract In–Out'], [', / .', 'Insert / Overwrite from Source Monitor'],
  ['Alt+← / →', 'Nudge selected clips'], ['Ctrl+D', 'Default transition'], ['Ctrl+R', 'Speed / Duration'], ['Shift+E', 'Enable / disable clip'], ['Ctrl+L', 'Link / unlink'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / Redo'], ['Ctrl+X / C / V', 'Cut / Copy / Paste (Shift: paste insert)'], ['= / - / \\', 'Zoom in / out / fit timeline'], ['S', 'Toggle snapping'],
  ['Ctrl+I', 'Import'], ['Ctrl+M', 'Export media'], ['Ctrl+S', 'Save'], ['Ctrl+T', 'New text layer'], ['Ctrl+J', 'Toggle Claude panel'], ['/', 'Focus Claude chat'],
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard Shortcuts" onClose={onClose} width={620}>
      <div className="shortcuts">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="sc-row">
            <kbd>{k}</kbd>
            <span>{v}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function CopyBox({ text, pre }: { text: string; pre?: boolean }) {
  return (
    <div className="codebox">
      {pre ? <pre>{text}</pre> : <code>{text}</code>}
      <button className="icon-btn" onClick={() => navigator.clipboard.writeText(text).then(() => toast('Copied', 'success'))}>
        <Icon name="copy" size={13} />
      </button>
    </div>
  );
}

/**
 * The way to use a Claude, ChatGPT or Cursor subscription with IngrainedCut: the user runs that company's own app and
 * connects it to IngrainedCut's MCP server, so the plan is only ever used by its own app. (The chat panel's built-in
 * Claude and Codex run on API keys; see electron/agent.mjs.) One command does it: the helper's `--connect <app>`
 * (server/web.mjs) adds IngrainedCut to that app, then keeps running as the helper.
 */
function McpDialog({ onClose }: { onClose: () => void }) {
  const [app, setApp] = useMcpApp();
  const cmd = connectCommand(app);
  return (
    <Modal title="Use your own Claude Code, Codex or Cursor" onClose={onClose} width={640}>
      <p>Have a Claude, ChatGPT or Cursor plan? Connect that app to IngrainedCut and it edits the timeline open here, on your own plan.</p>
      <div className="form-h">1. Pick your app</div>
      <AppPicker app={app} onChange={setApp} />
      <div className="form-h">2. Run this in a terminal</div>
      <CopyBox text={cmd} />
      <p className="hint">
        Command Prompt, PowerShell or Terminal all work (it needs Node.js 22+).
        {isSite ? ' It also starts the IngrainedCut helper, so leave that window open while you edit.' : ''}
      </p>
      <div className="form-h">3. Use {MCP_APPS[app]}</div>
      <p>
        Open a <b>new</b> {MCP_APPS[app]} session and ask it to edit your IngrainedCut timeline, for example “cut the silences in my IngrainedCut timeline”.
      </p>
      <p className="hint">{MCP_APPS[app]} keeps your own sign-in and plan; IngrainedCut never sees them.</p>
    </Modal>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="About IngrainedCut" onClose={onClose} width={420}>
      <div className="about">
        <div className="about-logo">IC</div>
        <h3>IngrainedCut</h3>
        <p>A non-linear video editor with AI built in.</p>
        <p className="dim">Electron · React · FFmpeg · Claude Agent SDK · MCP</p>
        <p>
          <a onClick={() => window.icut.openExternal('https://ko-fi.com/ingrainedcut')}>Support IngrainedCut on Ko-fi ☕</a>
        </p>
        <p>
          {isSite ? (
            <a href="/licenses" target="_blank" rel="noopener">
              Open-source licenses
            </a>
          ) : (
            <a
              onClick={async () => {
                const i = await window.icut.appInfo();
                // THIRD_PARTY_NOTICES.md sits in the app folder, two levels above mcp/server.mjs
                const sep = i.mcpServerPath.match(/[\\/]/)?.[0] ?? '/';
                const parts = i.mcpServerPath.split(/[\\/]/);
                window.icut.reveal([...parts.slice(0, -2), 'THIRD_PARTY_NOTICES.md'].join(sep));
              }}
            >
              Open-source licenses (THIRD_PARTY_NOTICES.md)
            </a>
          )}
        </p>
      </div>
    </Modal>
  );
}
