// Website editor: the optional helper. Without it everything but the AI agents (and a few FFmpeg formats) runs in
// the browser; these explain what it adds and connect to it.
import React, { useEffect, useRef, useState } from 'react';
import { connectHelper, engineMode, helperReachable, helperWasUsed, isSite } from '../webBridge';
import { S, toast } from '../store';
import { Icon } from './Icons';

/** The one-line setup: npx runs the helper package straight from this website (no npm account needed). */
export const HELPER_COMMAND = `npx -y ${location.origin}/helper/ingrainedcut-${__ICUT_VERSION__}.tgz`;

function CopyCommand() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="helper-cmd">
      <code>{HELPER_COMMAND}</code>
      <button
        className="btn sm"
        onClick={async () => {
          await navigator.clipboard.writeText(HELPER_COMMAND).catch(() => {});
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

function ConnectButton() {
  const [state, setState] = useState<'idle' | 'checking' | 'missing' | 'blocked'>('idle');
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
      {state === 'blocked' && (
        <div className="hint warn-text">
          Your browser is blocking this site from reaching the helper on your computer. Click the icon at the left of the address bar → Site settings → Local
          network access → Allow, then click Connect again.
        </div>
      )}
      {state === 'missing' && (
        <div className="hint warn-text">
          Couldn't reach the helper. Make sure the command above is still running, and if your browser asks to access devices on your local network,
          choose Allow.
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
        <CopyCommand />
      </li>
      <li>Keep it running and click Connect — after the first time, this page connects by itself. Your browser may ask to allow access to your local network — choose Allow.</li>
    </ol>
  );
}

/** Replaces the chat while the editor runs without the helper. */
export function HelperNeeded() {
  return (
    <div className="helper-needed">
      <div className="welcome-mark">
        <Icon name="sparkle" size={28} />
      </div>
      <h3>Edit with AI</h3>
      <p>
        Claude, Codex and Cursor run on your own computer, with your own account, through the free IngrainedCut helper. Everything else — editing,
        import and export — already works right here in your browser.
      </p>
      <Steps />
      <ConnectButton />
      <p className="hint">
        The helper also adds transcription, silence and scene detection, and ProRes / GIF / MP3 export. It only accepts this website, and your media never
        leaves your computer.
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
