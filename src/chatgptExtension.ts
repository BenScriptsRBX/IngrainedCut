// The IngrainedCut Chrome extension (extension/): on the website it holds the Sign in with ChatGPT tokens and sends the
// ChatGPT requests, so the editor's chat runs on the user's ChatGPT plan without the helper. Its content script marks
// <html data-icut-extension="<version>"> before the page's scripts run and relays window messages to the extension.

/** The extension's version when it is installed (and this is the website editor), else null. */
export function extensionVersion(): string | null {
  return document.documentElement.getAttribute('data-icut-extension');
}
export const hasExtension = () => !!extensionVersion();

/** Where people get it: the Chrome Web Store once it is listed, until then the zip on the latest GitHub release. */
export const EXTENSION_ZIP = 'https://github.com/BenScriptsRBX/IngrainedCut/releases/latest/download/IngrainedCut-Chrome-Extension.zip';
export const EXTENSION_STORE = ''; // the Chrome Web Store page, once published

let seq = 0;
type Handler = (m: any) => void;
const handlers = new Map<string, Handler>();

window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const m = e.data;
  if (!m || m.__icut !== 'from-ext') return;
  handlers.get(m.id)?.(m);
});

const post = (msg: any) => window.postMessage({ __icut: 'to-ext', ...msg }, location.origin);

/** Call one of the extension's methods (status, signIn, cancelSignIn, signOut, models, welcomeSeen). */
export function extCall<T = any>(method: string, params?: any, timeoutMs = 20_000): Promise<T> {
  if (!hasExtension()) return Promise.reject(new Error('The IngrainedCut extension is not installed'));
  const id = `c${++seq}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      handlers.delete(id);
      reject(new Error('The IngrainedCut extension did not answer. Reload the page and try again.'));
    }, timeoutMs);
    handlers.set(id, (m) => {
      if (m.kind !== 'result') return;
      clearTimeout(timer);
      handlers.delete(id);
      if (m.error) reject(new Error(m.error));
      else resolve(m.value);
    });
    post({ kind: 'call', id, method, params });
  });
}

/** A failed ChatGPT request, as the agent reports it. */
export class ExtRequestError extends Error {
  status?: number;
}

/**
 * POST a streamed ChatGPT request through the extension. Yields the response body's text as it arrives; throws on an
 * HTTP error (message "<code>: <message> (HTTP n)", as the helper does) or when `signal` aborts.
 */
export async function* extStream(path: string, body: any, signal: AbortSignal): AsyncGenerator<string> {
  const id = `s${++seq}`;
  const queue: any[] = [];
  let wake: (() => void) | null = null;
  handlers.set(id, (m) => {
    if (m.kind !== 'chunk') return;
    queue.push(m);
    wake?.();
  });
  const onAbort = () => {
    post({ kind: 'abort', id });
    wake?.();
  };
  signal.addEventListener('abort', onAbort);
  post({ kind: 'stream', id, path, body });
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const m = queue.shift();
      if (!m) {
        await new Promise<void>((r) => (wake = r));
        wake = null;
        continue;
      }
      if (m.t === 'data') yield m.text as string;
      else if (m.t === 'end') return;
      else if (m.t === 'error') throw requestError(m);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    handlers.delete(id);
  }
}

function requestError(m: any) {
  if (!m.status) return new ExtRequestError(m.message || 'ChatGPT request failed');
  let j: any = {};
  try {
    j = JSON.parse(m.text);
  } catch {}
  const code = j.error?.code || j.error?.type || (typeof j.detail === 'string' ? j.detail : null) || `http_${m.status}`;
  const msg = j.error?.message || (typeof j.detail === 'string' ? j.detail : String(m.text ?? '').slice(0, 300));
  const e = new ExtRequestError(`${code}: ${msg} (HTTP ${m.status})`);
  e.status = m.status;
  return e;
}
