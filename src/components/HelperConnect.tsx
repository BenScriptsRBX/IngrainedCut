// Website editor: the optional helper. Without it everything but the AI agents (and a few FFmpeg formats) runs in
// the browser; these explain what it adds and connect to it.
import React, { useEffect, useRef, useState } from 'react';
import { HELPER_PORT, SITE_ORIGIN, connectHelper, engineMode, helperReachable, helperWasUsed, isSite } from '../webBridge';
import { S, toast } from '../store';
import { Icon } from './Icons';

/** The one-line setup: npx runs the helper package straight from this website (no npm account needed). */
export const HELPER_COMMAND = `npx -y ${SITE_ORIGIN}/helper/ingrainedcut-${__ICUT_VERSION__}.tgz`;

/** Apps people bring with their own plan; the helper's `--connect <app>` adds IngrainedCut to them (server/web.mjs). */
export const MCP_APPS = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' } as const;
export type McpApp = keyof typeof MCP_APPS;

/** The one command that connects the app: on the website it also starts the helper (the desktop app is the editor). */
export const connectCommand = (app: McpApp) =>
  `npx -y ${SITE_ORIGIN}/helper/ingrainedcut-${__ICUT_VERSION__}.tgz --connect ${app}${isSite ? '' : ' --no-helper'}`;

/** The app picked last (shared by the AI panel and the Help dialog). */
export function useMcpApp(initial: McpApp = 'claude') {
  const [app, setApp] = useState<McpApp>(() => {
    try {
      const v = localStorage.getItem('icut-mcp-app');
      return v && v in MCP_APPS ? (v as McpApp) : initial;
    } catch {
      return initial;
    }
  });
  const pick = (a: McpApp) => {
    setApp(a);
    try {
      localStorage.setItem('icut-mcp-app', a);
    } catch {}
  };
  return [app, pick] as const;
}

/** A small inline choice: Claude Code (the default), Codex or Cursor. */
export function AppPicker({ app, onChange }: { app: McpApp; onChange: (a: McpApp) => void }) {
  return (
    <select className="app-select" value={app} onChange={(e) => onChange(e.target.value as McpApp)}>
      {(Object.keys(MCP_APPS) as McpApp[]).map((a) => (
        <option key={a} value={a}>
          {MCP_APPS[a]}
        </option>
      ))}
    </select>
  );
}

export function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="helper-cmd">
      <code>{text}</code>
      <button
        className="btn sm"
        onClick={async () => {
          await navigator.clipboard.writeText(text).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/** Chrome's permission for public sites to reach this computer (127.0.0.1); null where the browser doesn't have it. */
async function localNetworkPermission() {
  try {
    return (await navigator.permissions.query({ name: 'local-network-access' as PermissionName })).state;
  } catch {
    return null;
  }
}

/** The way around a blocked permission: the website hands the project to the helper, which serves the editor itself. */
function OpenThroughHelper() {
  const project = new URLSearchParams(location.search).get('project') ?? '';
  return (
    <a className="btn primary sm" href={`/editor/local?project=${encodeURIComponent(project)}${HELPER_PORT !== 5310 ? `&port=${HELPER_PORT}` : ''}`} style={{ display: 'inline-block', margin: '6px 0' }}>
      Connect
    </a>
  );
}

function ConnectButton() {
  const [state, setState] = useState<'idle' | 'checking' | 'missing' | 'blocked'>('idle');
  // already blocked (the browser won't even ask): say so up front
  useEffect(() => void localNetworkPermission().then((p) => p === 'denied' && setState('blocked')), []);
  // the browser won't let this page reach the helper: open the editor from the helper instead (one click, no settings)
  if (state === 'blocked') return <OpenThroughHelper />;
  return (
    <>
      <button
        className="btn primary sm"
        disabled={state === 'checking'}
        onClick={async () => {
          setState('checking');
          if (!(await connectHelper())) setState((await localNetworkPermission()) === 'denied' ? 'blocked' : 'missing');
        }}
      >
        {state === 'checking' ? 'Looking for the helper…' : 'Connect'}
      </button>
      {state === 'missing' && (
        <div className="hint">
          <span className="warn-text">Couldn't reach the helper — is the command still running?</span> If your browser asked about your local network and you
          didn't allow it, use this instead:
          <div>
            <OpenThroughHelper />
          </div>
        </div>
      )}
    </>
  );
}

function Steps() {
  return (
    <ol className="helper-steps">
      <li>
        Open a terminal and run (needs Node.js 22+):
        <CopyLine text={HELPER_COMMAND} />
      </li>
      <li>Keep it running and click Connect — after the first time, this page connects by itself. Your browser may ask to allow access to your local network — choose Allow.</li>
    </ol>
  );
}

/** Replaces the chat while the editor runs without the helper: one command connects the user's own app and starts it. */
export function HelperNeeded() {
  const [app, setApp] = useMcpApp();
  return (
    <div className="helper-needed">
      <div className="welcome-mark">
        <Icon name="sparkle" size={28} />
      </div>
      <h3>Edit with AI</h3>
      <ol className="helper-steps">
        <li>
          Run this in a terminal, and leave it open:
          <CopyLine text={connectCommand(app)} />
        </li>
        <li>
          <ConnectButton />
        </li>
        <li>
          In {MCP_APPS[app]}, say <b>connect to IngrainedCut</b>. Then type here.
        </li>
      </ol>
      <p className="hint">
        Using <AppPicker app={app} onChange={setApp} /> · needs Node.js 22+
      </p>
    </div>
  );
}

/** Title-bar chip: which engine the editor is on, with a way to connect the helper. */
export function HelperChip() {
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // started the helper while this tab was open: switch to it (when everything is saved), or offer to
  useEffect(() => {
    if (!isSite || engineMode() !== 'browser') return;
    let stop = false;
    const tick = async () => {
      if (stop || !(await helperWasUsed()) || !(await helperReachable(1200))) return;
      const s = S();
      if (s.cloud?.status === 'saved' && !s.gestureBase && !s.exportJob) {
        stop = true;
        toast('The helper is running — connecting…', 'info');
        connectHelper();
      } else setFound(true);
    };
    const t = setInterval(tick, 1500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  if (!isSite) return null;
  const helper = engineMode() === 'helper';
  return (
    <div className="helper-chip-wrap" ref={ref}>
      <button className={'helper-chip' + (helper ? ' on' : found ? ' found' : '')} onClick={() => (found ? connectHelper() : setOpen(!open))} title={helper ? 'Connected to the IngrainedCut helper on this computer' : 'Running in your browser'}>
        <span className="hc-dot" /> {helper ? 'Helper connected' : found ? 'Helper running · Connect' : 'In browser · Connect helper'}
      </button>
      {open && (
        <div className="model-pop helper-pop">
          {helper ? (
            <p>
              The editor is using the IngrainedCut helper on this computer: AI agents, FFmpeg formats and transcription are available. Media you import
              stays in place on your disk.
            </p>
          ) : (
            <>
              <p>
                You're editing entirely in your browser. Imported media is kept in this browser's storage on this computer — nothing is uploaded. Connect the
                helper to use AI agents (Claude, Codex, Cursor) and the extra tools.
              </p>
              <Steps />
              <ConnectButton />
            </>
          )}
        </div>
      )}
    </div>
  );
}
