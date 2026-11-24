// Website editor: the optional helper. Without it everything but the AI agents (and a few FFmpeg formats) runs in
// the browser; these explain what it adds and connect to it.
import React, { useEffect, useRef, useState } from 'react';
import { SITE_ORIGIN, connectHelper, engineMode, helperOutdated, helperReachable, helperVersion, helperWasUsed, isSite } from '../webBridge';
import { S, toast } from '../store';
import { Icon } from './Icons';
import { EXTENSION_STORE } from '../chatgptExtension';

/** Chrome, Edge, Brave, Opera…: browsers that can add the IngrainedCut extension. */
export const isChromium = !!(navigator as any).userAgentData?.brands?.some((b: any) => /Chromium/.test(b.brand));

/** "Add the extension": the Chrome Web Store page once listed, until then the setup page on the website. */
export function GetExtension({ label = 'Add the IngrainedCut extension' }: { label?: string }) {
  const url = EXTENSION_STORE || `${SITE_ORIGIN}/download#extension`;
  return (
    <a className="btn primary sm helper-download" href={url} target="_blank" rel="noopener noreferrer">
      <Icon name="sparkle" size={12} /> {label}
    </a>
  );
}

/** The one-line setup: npx runs the helper package straight from this website (no npm account needed). */
export const HELPER_COMMAND = `npx -y ${SITE_ORIGIN}/helper/ingrainedcut-${__ICUT_VERSION__}.tgz`;

/** Windows: the helper as an app with an installer (no command, no Node.js), from the latest GitHub release. */
export const HELPER_DOWNLOAD = 'https://github.com/BenScriptsRBX/IngrainedCut/releases/latest/download/IngrainedCut-Helper-Setup.exe';
export const isWindows = /Windows/i.test(navigator.userAgent);

/** "Download for Windows": the helper installer. */
export function DownloadHelper({ label = 'Download the helper for Windows' }: { label?: string }) {
  return (
    <a className="btn primary sm helper-download" href={HELPER_DOWNLOAD} download>
      <Icon name="export" size={12} /> {label}
    </a>
  );
}

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

/** "Node.js 22+" as a link to the download page (the helper command runs on Node). */
export function NodeLink() {
  const url = 'https://nodejs.org/en/download';
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.preventDefault();
        window.icut.openExternal(url);
      }}
    >
      Node.js 22+
    </a>
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

/** The browser blocks this site from reaching the helper: how to allow it (the editor always stays on the website). */
function AllowLocalNetwork() {
  return (
    <div className="hint">
      <span className="warn-text">Your browser is blocking this site from reaching the helper on your computer.</span> Click the icon at the left of the
      address bar, turn on <b>Local network access</b> (or open Site settings → Local network access → Allow), then click Connect again.
    </div>
  );
}

/** Windows: the installed helper app opens for this link (its installer registers ingrainedcut://). */
const HELPER_LINK = 'ingrainedcut://connect';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ConnectButton() {
  const [state, setState] = useState<'idle' | 'checking' | 'starting' | 'missing' | 'not-started' | 'blocked'>('idle');
  // already blocked (the browser won't even ask): say so up front
  useEffect(() => void localNetworkPermission().then((p) => p === 'denied' && setState('blocked')), []);
  const connect = async () => {
    setState('checking');
    if (await connectHelper()) return;
    if ((await localNetworkPermission()) === 'denied') return setState('blocked');
    if (!isWindows) return setState('missing');
    // not running: start the installed helper through its link (the browser asks once to open IngrainedCut Helper),
    // then connect as soon as it answers
    setState('starting');
    location.href = HELPER_LINK;
    for (let i = 0; i < 40; i++) {
      await sleep(1000);
      if (await helperReachable(1200)) {
        if (await connectHelper()) return;
      }
    }
    setState('not-started');
  };
  return (
    <>
      <button className="btn primary sm" disabled={state === 'checking' || state === 'starting'} onClick={connect}>
        {state === 'checking' ? 'Looking for the helper…' : state === 'starting' ? 'Starting the helper…' : state === 'idle' ? 'Connect' : 'Connect again'}
      </button>
      {state === 'starting' && <div className="hint">If your browser asks to open IngrainedCut Helper, choose Open.</div>}
      {state === 'blocked' && <AllowLocalNetwork />}
      {state === 'not-started' && (
        <div className="hint">
          <span className="warn-text">The helper didn't start.</span> Install it first (then click Connect again), or if it's installed, let your browser
          open IngrainedCut Helper when it asks:
          <div>
            <DownloadHelper />
          </div>
        </div>
      )}
      {state === 'missing' && (
        <div className="hint">
          <span className="warn-text">Couldn't reach the helper — is the command still running?</span> If your browser asked about your local network, choose
          Allow.
        </div>
      )}
    </>
  );
}

function Steps() {
  if (isWindows)
    return (
      <ol className="helper-steps">
        <li>
          Install the IngrainedCut helper (free, about 120 MB). Once installed, Connect starts it whenever you edit:
          <div>
            <DownloadHelper />
          </div>
        </li>
        <li>Click Connect: it starts the helper and connects. Your browser may ask to open IngrainedCut Helper and to allow access to your local network — choose Open and Allow.</li>
      </ol>
    );
  return (
    <ol className="helper-steps">
      <li>
        Open a terminal and run (needs <NodeLink />, free):
        <CopyLine text={HELPER_COMMAND} />
      </li>
      <li>Keep it running and click Connect — after the first time, this page connects by itself. Your browser may ask to allow access to your local network — choose Allow.</li>
    </ol>
  );
}

/** The helper on this computer is older than the website: one line to update it. */
export function HelperUpdateNotice() {
  const [app] = useMcpApp();
  if (!helperOutdated()) return null;
  if (isSite && isWindows)
    return (
      <div className="auth-callout">
        <b>Update the helper</b>
        <div className="hint">It's on version {helperVersion()}. Install the new one over it:</div>
        <DownloadHelper label="Download the new helper" />
      </div>
    );
  return (
    <div className="auth-callout">
      <b>Update the helper</b>
      <div className="hint">
        It's on version {helperVersion()}. Stop it (Ctrl+C in its window) and run:
      </div>
      <CopyLine text={connectCommand(app)} />
    </div>
  );
}

/** Replaces the chat while the editor runs without the helper. The website: install the helper, connect, then
 *  Continue with ChatGPT (no command on Windows). */
export function HelperNeeded() {
  const [app, setApp] = useMcpApp();
  if (isSite)
    return (
      <div className="helper-needed">
        <div className="welcome-mark">
          <Icon name="sparkle" size={28} />
        </div>
        <h3>Edit with ChatGPT</h3>
        {isChromium && (
          <>
            <ol className="helper-steps">
              <li>
                Add the free IngrainedCut extension to this browser, then reload this page:
                <div>
                  <GetExtension />
                </div>
              </li>
              <li>
                Pick ChatGPT and click <b>Continue with ChatGPT</b>. The chat then runs on your ChatGPT plan, right here in the browser.
              </li>
            </ol>
            <p className="hint">
              For downloading videos from links, transcription, captions from speech, and silence and scene detection, set up the helper on your computer:
            </p>
          </>
        )}
        <ol className="helper-steps">
          {isWindows ? (
            <li>
              Install the IngrainedCut helper (free). Once installed, Connect starts it whenever you edit:
              <div>
                <DownloadHelper />
              </div>
            </li>
          ) : (
            <li>
              Run this in a terminal (needs <NodeLink />, free), and leave it open:
              <CopyLine text={HELPER_COMMAND} />
            </li>
          )}
          <li>
            <ConnectButton />
          </li>
          <li>
            Pick ChatGPT and click <b>Continue with ChatGPT</b>. The chat then runs on your ChatGPT plan.
          </li>
        </ol>
      </div>
    );
  return (
    <div className="helper-needed">
      <div className="welcome-mark">
        <Icon name="sparkle" size={28} />
      </div>
      <h3>Edit with AI</h3>
      <ol className="helper-steps">
        <li>
          Run this in a terminal (needs <NodeLink />, free), and leave it open:
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
        Using <AppPicker app={app} onChange={setApp} />
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
                helper to edit with ChatGPT and use the extra tools.
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
