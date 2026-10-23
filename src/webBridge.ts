// In the browser (no Electron preload), provide the same `window.icut` API. Three browser setups:
//  - local mode: the IngrainedCut helper itself serves the editor (same origin, cookie auth, WebSocket);
//  - website + helper: the editor is served by the website at /editor and connects to the helper on 127.0.0.1,
//    which only accepts the website's origin and hands back a media token;
//  - website, no helper: the browser engine (browserEngine.ts) does the work in the page; media lives in the
//    browser's storage and the AI agents wait until the helper is connected.
// Must be imported before anything that uses window.icut.
import { createBrowserEngine, isBrowserPath, browserUrl, storeFiles } from './browserEngine';

export const isWeb = !(window as any).icut;
export const isSite = isWeb && location.pathname.startsWith('/editor');
/** The account editor served by the helper itself ("Open through the helper"): same origin, so no local-network permission. */
export const viaHelper = isSite && !!(window as any).__ICUT_VIA_HELPER__;

export const HELPER_PORT = Number(new URLSearchParams(location.search).get('helper') || 5310);
/** The website (where the helper downloads from), also when the editor is served by the helper. */
export const SITE_ORIGIN = isSite && !viaHelper ? location.origin : 'https://www.ingrainedcut.com';
export const HELPER_ORIGIN = isSite && !viaHelper ? `http://127.0.0.1:${HELPER_PORT}` : location.origin;

const MEDIA_PREFIX = 'icut://media/';
let mediaToken = '';

/** Which engine the website editor runs on: the helper on this computer, or the page itself. */
export type EngineMode = 'helper' | 'browser';
let mode: EngineMode = 'helper';
export const engineMode = () => mode;
export const isBrowserEngine = () => isSite && mode === 'browser';

/** Projects store icut://media/<path> URLs; the helper streams disk files, browser storage gives blob URLs. */
export function mediaSrc<T extends string | undefined | null>(u: T): T {
  if (isWeb && u && u.startsWith(MEDIA_PREFIX)) {
    const rest = u.slice(MEDIA_PREFIX.length);
    const path = decodeURIComponent(rest);
    if (isBrowserPath(path)) return browserUrl(path) as T;
    return (isSite ? `${HELPER_ORIGIN}/media/${rest}?k=${mediaToken}` : '/media/' + rest) as T;
  }
  return u;
}

/** Where dropped files are copied in (browsers never expose real paths). */
export function uploadUrl(name: string) {
  return `${HELPER_ORIGIN}/upload?name=${encodeURIComponent(name)}${isSite ? `&k=${mediaToken}` : ''}`;
}

/** Dropped files: into browser storage without the helper, copied to the computer through it otherwise. */
export async function storeDroppedFiles(files: File[], note: (msg: string) => void): Promise<string[]> {
  if (isBrowserEngine()) return storeFiles(files, note);
  const out: string[] = [];
  for (const f of files) {
    const r = await fetch(uploadUrl(f.name), { method: 'POST', body: f });
    if (r.ok) out.push((await r.json()).path);
    else note(`Could not copy ${f.name}`);
  }
  return out;
}

// ---- finding the helper ----
const HELPER_USED = 'icut-helper-used';

export async function helperReachable(timeoutMs = 1500) {
  try {
    const r = await fetch(`${HELPER_ORIGIN}/hello`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Reaching 127.0.0.1 from the website makes the browser ask for local network access, so the editor only looks for
 * the helper when this browser has used it before (or already granted the permission), or when the user clicks Connect.
 */
async function mayLookForHelper() {
  if (viaHelper) return true;
  try {
    if (localStorage.getItem(HELPER_USED)) return true;
  } catch {}
  try {
    const st = await navigator.permissions.query({ name: 'local-network-access' as PermissionName });
    return st.state === 'granted';
  } catch {
    return false;
  }
}

export const helperWasUsed = mayLookForHelper;

let connectWs: (() => Promise<void>) | null = null;

/** Website: decide once at load which engine to use (the helper if it's running and allowed, else the browser). */
export async function chooseEngine(): Promise<EngineMode> {
  if (!isSite) return mode;
  if ((await mayLookForHelper()) && (await helperReachable())) {
    try {
      await Promise.race([connectWs!(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
      mode = 'helper';
      try {
        localStorage.setItem(HELPER_USED, '1');
      } catch {}
      return mode;
    } catch {}
  }
  mode = 'browser';
  return mode;
}

/** The user clicked Connect: wait for the helper (the browser may ask for permission first), then reload onto it. */
export async function connectHelper(): Promise<boolean> {
  if (!(await helperReachable(10000))) return false;
  try {
    localStorage.setItem(HELPER_USED, '1');
  } catch {}
  location.reload();
  return true;
}

type Listener = (payload: any) => void;

if (isWeb) installWebBridge();

function installWebBridge() {
  let ws: WebSocket | null = null;
  let open = false;
  let seq = 0;
  let everConnected = false;
  let helloWaiters: (() => void)[] = [];
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const subs = new Map<string, Set<Listener>>();
  const queue: (() => void)[] = [];
  const emitLocal = (ch: string, payload: any) => subs.get(ch)?.forEach((cb) => cb(payload));
  const browser = createBrowserEngine(emitLocal);

  const banner = document.createElement('div');
  banner.className = 'web-offline';
  banner.textContent = isSite
    ? 'Lost connection to the IngrainedCut helper on this computer — reconnecting… (is it still running?)'
    : 'Lost connection to the IngrainedCut server — reconnecting… (is `npm run web` still running?)';

  function connect() {
    ws = isSite && !viaHelper ? new WebSocket(`ws://127.0.0.1:${HELPER_PORT}/ws`) : new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      open = true;
      banner.remove();
      while (queue.length) queue.shift()!();
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string);
      if (msg.t === 'hello') {
        mediaToken = msg.mediaToken || '';
        everConnected = true;
        helloWaiters.forEach((f) => f());
        helloWaiters = [];
      } else if (msg.t === 'res') {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.ok) p?.resolve(msg.value);
        else p?.reject(new Error(msg.error));
      } else if (msg.t === 'ev') emitLocal(msg.ch, msg.payload);
    };
    ws.onclose = () => {
      const wasOpen = open;
      open = false;
      for (const p of pending.values()) p.reject(new Error('Lost connection to the IngrainedCut helper'));
      pending.clear();
      if (everConnected && (wasOpen || !document.body.contains(banner))) document.body.appendChild(banner);
      setTimeout(connect, 1500);
    };
  }
  connectWs = () =>
    new Promise<void>((resolve) => {
      helloWaiters.push(resolve);
      if (!ws) connect();
    });
  // local mode: the page was served by the helper, so it is there
  if (!isSite) connect();

  /** Pull binary payloads (export frames, audio mixes, PNGs) out of the arguments; they travel as binary frames. */
  function extract(v: any, bins: ArrayBuffer[]): any {
    if (v instanceof ArrayBuffer) return bins.push(v), { __bin: bins.length - 1 };
    if (ArrayBuffer.isView(v)) return bins.push(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer), { __bin: bins.length - 1 };
    if (Array.isArray(v)) return v.map((x) => extract(x, bins));
    if (v && typeof v === 'object' && !(v instanceof File)) {
      const o: any = {};
      for (const k of Object.keys(v)) o[k] = extract(v[k], bins);
      return o;
    }
    return v;
  }

  function transmit(msg: any) {
    const bins: ArrayBuffer[] = [];
    const args = extract(msg.args, bins);
    const go = () => {
      ws!.send(JSON.stringify({ ...msg, args, bins: bins.length }));
      for (const b of bins) ws!.send(b);
    };
    if (open) go();
    else queue.push(go);
  }

  const invoke = (ch: string, ...args: any[]): Promise<any> => {
    if (isBrowserEngine()) return browser.invoke(ch, ...args);
    return new Promise<any>((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      transmit({ t: 'invoke', id, ch, args });
    });
  };
  const send = (ch: string, payload?: any) => (isBrowserEngine() ? browser.send(ch, payload) : transmit({ t: 'send', ch, args: [payload] }));
  const on = (ch: string) => (cb: Listener) => {
    if (!subs.has(ch)) subs.set(ch, new Set());
    subs.get(ch)!.add(cb);
    return () => subs.get(ch)?.delete(cb);
  };

  (window as any).icut = {
    openMediaDialog: () => invoke('dialog:open-media'),
    saveDialog: (opts: any) => invoke('dialog:save', opts),
    openProjectDialog: () => invoke('dialog:open-project'),
    chooseFile: (opts: any) => invoke('dialog:choose-file', opts),
    pathForFile: () => '', // browsers never expose real paths; dropped files are copied in (see filesToPaths)
    exists: (p: string) => invoke('fs:exists', p),
    writePng: (p: string, data: ArrayBuffer) => invoke('fs:write-png', { path: p, data }),
    reveal: (p: string) => invoke('shell:reveal', p),
    openExternal: async (url: string) => void window.open(url, '_blank', 'noopener'),
    importMedia: (items: any) => invoke('media:import', items),
    refreshAssets: (o: any) => invoke('media:refresh-assets', o),
    onMediaUpdate: on('media:update'),
    saveProject: (path: string, data: any) => invoke('project:save', { path, data }),
    loadProject: (path: string) => invoke('project:load', path),
    syncProject: (p: any) => send('project:sync', p),
    setDirty: (d: boolean) => send('project:dirty', d),
    exportStart: (opts: any) => invoke('export:start', opts),
    exportFrame: (buf: ArrayBuffer) => invoke('export:frame', buf),
    exportFinish: () => invoke('export:finish'),
    exportCancel: () => invoke('export:cancel'),
    exportWcStart: (o: any) => invoke('export:wc-start', o),
    exportWcChunk: (o: any) => invoke('export:wc-chunk', o),
    exportWcFinish: (o: any) => invoke('export:wc-finish', o),
    exportWcCancel: () => invoke('export:wc-cancel'),
    agentSend: (payload: any) => invoke('agent:send', payload),
    agentInterrupt: () => invoke('agent:interrupt'),
    agentReset: () => invoke('agent:reset'),
    agentSetModel: (o: any) => invoke('agent:set-model', o),
    listSessions: () => invoke('sessions:list'),
    sessionTranscript: (id: string) => invoke('sessions:transcript', id),
    sessionContinue: (id: string) => invoke('sessions:continue', id),
    agentSetBypass: (o: boolean) => invoke('agent:set-bypass', o),
    agentSetProvider: (p: string) => invoke('agent:set-provider', p),
    providerStatus: (p: string) => invoke('providers:status', p),
    providerLogin: (p: string) => invoke('providers:login', p),
    providerCancelLogin: () => invoke('providers:cancel-login'),
    providerInstall: (p: string) => invoke('providers:install', p),
    engineTool: (name: string, args: any) => invoke('engine:tool', { name, args }),
    providerModels: (p: string) => invoke('providers:models', p),
    onExternalAgents: on('agents:external'),
    permissionReply: (r: any) => send('agent:permission-reply', r),
    onAgentEvent: on('agent:event'),
    onToolActivity: on('agent:tool-activity'),
    onToolInvoke: on('tool:invoke'),
    toolResult: (id: number, result: any) => send('tool:result', { id, result }),
    getSettings: () => invoke('settings:get'),
    setSettings: (patch: any) => invoke('settings:set', patch),
    appInfo: () => invoke('app:info'),
    downloadWhisper: (name: string) => invoke('whisper:download', name),
    onWhisperProgress: on('whisper:progress'),
    onToast: on('app:toast'),
    onCompositionProgress: on('composition:progress'),
    authStatus: () => invoke('auth:status'),
    authLogin: (o: any) => invoke('auth:login', o || {}),
    authCancel: () => invoke('auth:cancel'),
    onAuthOutput: on('auth:output'),
    devtools: () => alert('Press F12 to open your browser’s developer tools.'),
    reload: () => location.reload(),
  };
}
