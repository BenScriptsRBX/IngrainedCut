// Downloading videos from links in the website editor without the helper: the IngrainedCut extension runs yt-dlp
// (extension/ytdlp/) in a hidden frame of this page, and the files come back here in chunks. The extension's content
// script marks <html data-icut-extension-ytdlp="<frame url>"> when its build has the downloader.

export const extensionYtdlpUrl = () => document.documentElement.getAttribute('data-icut-extension-ytdlp');
export const hasExtensionYtdlp = () => !!extensionYtdlpUrl();

export type YtdlpProgress = { line?: string; progress?: number; title?: string; bytes?: number; total?: number; speed?: number };
export type YtdlpFile = { kind: 'video' | 'audio' | 'av'; ext: string; size: number; vcodec?: string; acodec?: string };
/** Where a downloaded file goes: write each chunk in order, then close (or abort on failure). */
export type FileSink = { write(data: ArrayBuffer): Promise<void>; close(): Promise<void>; abort(): Promise<void> };
export type YtdlpResult = { title: string; id?: string; duration?: number; extractor?: string; warnings?: string[]; files: YtdlpFile[] };

let frame: HTMLIFrameElement | null = null;
let ready: Promise<void> | null = null;
let origin = '';
let seq = 0;
const listeners = new Map<string, (m: any) => void>();

window.addEventListener('message', (e) => {
  if (!frame || e.source !== frame.contentWindow || e.origin !== origin) return;
  const m = e.data;
  if (!m || m.__icut !== 'ytdlp') return;
  if (m.id) listeners.get(m.id)?.(m);
  else listeners.get('*')?.(m);
});

function openFrame(): Promise<void> {
  const url = extensionYtdlpUrl();
  if (!url) return Promise.reject(new Error('The IngrainedCut extension with the downloader is not installed'));
  if (ready && frame?.isConnected) return ready;
  frame?.remove();
  origin = new URL(url).origin;
  frame = document.createElement('iframe');
  frame.src = url;
  frame.title = 'IngrainedCut downloader';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;left:-10px;top:-10px';
  ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      listeners.delete('*');
      ready = null;
      reject(new Error("The IngrainedCut extension's downloader didn't start. Reload the page and try again."));
    }, 20_000);
    listeners.set('*', (m) => {
      if (m.t !== 'ready') return;
      clearTimeout(timer);
      listeners.delete('*');
      resolve();
    });
  });
  document.body.appendChild(frame);
  return ready;
}

/**
 * Download a link with yt-dlp in the extension. `sink(file)` is asked for a place to write each file as it arrives;
 * resolves with what yt-dlp found (title, files in the order they were written).
 */
export async function ytdlpDownload(
  url: string,
  options: { max_height?: number; audio_only?: boolean },
  sink: (file: YtdlpFile, index: number) => Promise<FileSink>,
  onProgress: (p: YtdlpProgress) => void,
  signal?: AbortSignal,
): Promise<YtdlpResult> {
  await openFrame();
  const id = `d${Date.now().toString(36)}${++seq}`;
  const post = (msg: any) => frame!.contentWindow!.postMessage({ __icut: 'ytdlp', ...msg }, origin);
  return new Promise<YtdlpResult>((resolve, reject) => {
    const sinks = new Map<number, Promise<FileSink>>();
    let chain = Promise.resolve(); // file writes, in the order the chunks came
    let failed = false;
    const fail = (err: Error) => {
      if (failed) return;
      failed = true;
      listeners.delete(id);
      signal?.removeEventListener('abort', onAbort);
      for (const s of sinks.values()) s.then((x) => x.abort()).catch(() => {});
      reject(err);
    };
    const onAbort = () => {
      post({ cmd: 'cancel', id });
      fail(new Error('Download cancelled'));
    };
    signal?.addEventListener('abort', onAbort);
    const step = (fn: () => Promise<void>) => {
      chain = chain.then(() => (failed ? undefined : fn())).catch((e) => {
        post({ cmd: 'cancel', id });
        fail(e instanceof Error ? e : new Error(String(e)));
      });
    };
    listeners.set(id, (m) => {
      if (m.t === 'progress') onProgress(m);
      else if (m.t === 'file') {
        const f: YtdlpFile = { kind: m.kind, ext: m.ext, size: m.size, vcodec: m.vcodec, acodec: m.acodec };
        const p = sink(f, m.fid);
        p.catch(() => {});
        sinks.set(m.fid, p);
        onProgress({ line: `Receiving the ${f.kind === 'audio' ? 'audio' : 'video'} from the extension…` });
      } else if (m.t === 'chunk') step(async () => (await sinks.get(m.fid)!).write(m.data));
      else if (m.t === 'file-end') step(async () => (await sinks.get(m.fid)!).close());
      else if (m.t === 'done')
        step(async () => {
          listeners.delete(id);
          signal?.removeEventListener('abort', onAbort);
          resolve(m.result);
        });
      else if (m.t === 'error') fail(new Error(m.message === 'cancelled' ? 'Download cancelled' : m.message));
    });
    post({ cmd: 'download', id, url, options });
  });
}
