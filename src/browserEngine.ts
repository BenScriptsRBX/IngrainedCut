// The editor's engine inside the browser, used by the website when the helper isn't running on this computer.
// Imported media is copied into the browser's private storage (OPFS) and read with mediabunny; thumbnails,
// filmstrips and waveforms are made here; exports and project copies are saved as files the user picks.
// The AI agents need the helper (they run on the user's computer), so those channels report that instead.
import { ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, Input } from 'mediabunny';

/** Paths of media kept in browser storage: browser:/media/<uid>/<name>, cache files under browser:/cache/. */
export const BROWSER_PREFIX = 'browser:/';
export const isBrowserPath = (p: unknown): p is string => typeof p === 'string' && p.startsWith(BROWSER_PREFIX);
const mediaUrl = (p: string) => 'icut://media/' + encodeURIComponent(p);

// ---------- storage ----------
async function handleFor(path: string, create = false): Promise<FileSystemFileHandle> {
  const parts = path.slice(BROWSER_PREFIX.length).split('/').filter(Boolean);
  let dir = await navigator.storage.getDirectory();
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create });
  return dir.getFileHandle(parts[parts.length - 1], { create });
}

async function writeFile(path: string, data: Blob | BufferSource) {
  const w = await (await handleFor(path, true)).createWritable();
  await w.write(data);
  await w.close();
}

export async function readFile(path: string): Promise<File> {
  return (await handleFor(path)).getFile();
}

async function fileExists(path: string) {
  try {
    await handleFor(path);
    return true;
  } catch {
    return false;
  }
}

/** Blob URLs for stored files: mediaSrc() resolves browser:/ paths through this map. */
const urls = new Map<string, string>();
export const browserUrl = (path: string) => urls.get(path) ?? '';

async function register(path: string, file?: Blob) {
  if (urls.has(path)) return urls.get(path)!;
  const u = URL.createObjectURL(file ?? (await readFile(path)));
  urls.set(path, u);
  return u;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const safeName = (n: string) => n.replace(/[\\/:*?"<>|]/g, '_') || 'file';

/** Copy picked or dropped files into browser storage; returns their browser:/ paths. */
export async function storeFiles(files: File[], onProgress?: (msg: string) => void): Promise<string[]> {
  // ask once to keep the storage from being evicted under disk pressure
  navigator.storage.persist?.().catch(() => {});
  const out: string[] = [];
  for (const f of files) {
    const path = `${BROWSER_PREFIX}media/${uid()}/${safeName(f.name)}`;
    onProgress?.(`Adding ${f.name} to this browser's storage…`);
    const w = await (await handleFor(path, true)).createWritable();
    await f.stream().pipeTo(w);
    await register(path, f);
    out.push(path);
  }
  return out;
}

/** Copy a file the helper serves (any URL) into browser storage; returns its browser:/ path. */
export async function cacheUrl(url: string, name: string): Promise<string> {
  const path = `${BROWSER_PREFIX}media/${uid()}/${safeName(name)}`;
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  const w = await (await handleFor(path, true)).createWritable();
  try {
    await r.body.pipeTo(w);
  } catch (e) {
    await w.abort().catch(() => {});
    throw e;
  }
  return path;
}

export const browserFileExists = (p: string) => fileExists(p);

// ---------- probing ----------
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i;

async function probe(path: string) {
  const file = await readFile(path);
  await register(path, file);
  const name = path.split('/').pop()!;
  const base = { path, url: mediaUrl(path), name, size: file.size, videoCodec: '', audioCodec: '', sampleRate: 0, channels: 0 };
  if (IMAGE_EXT.test(name) || file.type.startsWith('image/')) {
    const bmp = await createImageBitmap(file);
    const info = { ...base, type: 'image', duration: 0, width: bmp.width, height: bmp.height, fps: 0, hasVideo: true, hasAudio: false, bitrate: 0 };
    bmp.close();
    return info;
  }
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    const at = await input.getPrimaryAudioTrack();
    if (!vt && !at) throw new Error('No video or audio found in this file');
    if (vt && !(await vt.canDecode())) {
      throw new Error(`This browser can't decode ${vt.codec ?? 'this'} video. Start the IngrainedCut helper to import it, or convert it to H.264/MP4.`);
    }
    const audioOk = !!at && (await at.canDecode());
    const duration = await input.computeDuration();
    const fps = vt ? (await vt.computePacketStats(120)).averagePacketRate || 30 : 0;
    return {
      ...base,
      type: vt ? 'video' : 'audio',
      duration,
      width: vt?.displayWidth ?? 0,
      height: vt?.displayHeight ?? 0,
      fps: Math.round(fps * 1000) / 1000,
      hasVideo: !!vt,
      hasAudio: audioOk,
      videoCodec: vt?.codec ?? '',
      audioCodec: at?.codec ?? '',
      sampleRate: at?.sampleRate ?? 0,
      channels: at?.numberOfChannels ?? 0,
      bitrate: duration ? Math.round((file.size * 8) / duration) : 0,
    };
  } finally {
    input.dispose();
  }
}

// ---------- thumbnails, filmstrip, waveform ----------
const cachePath = (path: string, suffix: string) => `${BROWSER_PREFIX}cache/${path.slice(BROWSER_PREFIX.length).replace(/[\\/]/g, '_')}-${suffix}`;

async function toJpeg(canvas: HTMLCanvasElement | OffscreenCanvas, q = 0.8): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/jpeg', quality: q });
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', q));
}

async function makeThumbnails(path: string, info: any) {
  if (info.type === 'image') return { thumb: info.url, sprite: null };
  const poster = cachePath(path, 'poster.jpg');
  const sprite = cachePath(path, 'sprite.jpg');
  const tiles = Math.max(1, Math.min(40, Math.ceil(info.duration / 2)));
  const tileH = 72;
  const tileW = Math.max(16, Math.round((tileH * (info.width || 16)) / (info.height || 9)));
  if (!(await fileExists(poster)) || !(await fileExists(sprite))) {
    const input = new Input({ source: new BlobSource(await readFile(path)), formats: ALL_FORMATS });
    try {
      const vt = (await input.getPrimaryVideoTrack())!;
      const at = Math.min(1, info.duration / 3);
      const pc = await new CanvasSink(vt, { width: 320, height: Math.round((320 * (info.height || 9)) / (info.width || 16) / 2) * 2, fit: 'contain' }).getCanvas(at);
      if (pc) await writeFile(poster, await toJpeg(pc.canvas));
      const strip = new OffscreenCanvas(tiles * tileW, tileH);
      const g = strip.getContext('2d')!;
      const interval = info.duration / tiles;
      const times = Array.from({ length: tiles }, (_, i) => Math.min(info.duration - 0.05, (i + 0.5) * interval));
      let i = 0;
      for await (const c of new CanvasSink(vt, { width: tileW, height: tileH, fit: 'cover' }).canvasesAtTimestamps(times)) {
        if (c) g.drawImage(c.canvas, i * tileW, 0, tileW, tileH);
        i++;
      }
      await writeFile(sprite, await toJpeg(strip, 0.7));
    } finally {
      input.dispose();
    }
  }
  await register(poster).catch(() => {});
  await register(sprite);
  return {
    thumb: urls.has(poster) ? mediaUrl(poster) : undefined,
    sprite: { url: mediaUrl(sprite), tiles, tileW, tileH, interval: info.duration / tiles },
  };
}

function wavHeader(dataBytes: number, channels: number, rate: number) {
  const v = new DataView(new ArrayBuffer(44));
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, dataBytes, true);
  return v.buffer;
}

/** 100 peaks/sec (0-255, same scale as the desktop engine) and a 16-bit WAV used for playback and export mixing. */
async function makeAudioAssets(path: string) {
  const wav = cachePath(path, 'audio.wav');
  const peaksFile = cachePath(path, 'peaks.json');
  if ((await fileExists(wav)) && (await fileExists(peaksFile))) {
    await register(wav);
    return { audioUrl: mediaUrl(wav), peaks: JSON.parse(await (await readFile(peaksFile)).text()) as number[] };
  }
  const input = new Input({ source: new BlobSource(await readFile(path)), formats: ALL_FORMATS });
  const w = await (await handleFor(wav, true)).createWritable();
  try {
    const at = (await input.getPrimaryAudioTrack())!;
    const rate = at.sampleRate;
    const ch = Math.min(2, at.numberOfChannels);
    const per = Math.max(1, Math.round(rate / 100));
    const peaks: number[] = [];
    let winMax = 0;
    let winCount = 0;
    let bytes = 0;
    await w.write(wavHeader(0, ch, rate));
    for await (const { buffer } of new AudioBufferSink(at).buffers()) {
      const n = buffer.length;
      const chans = Array.from({ length: ch }, (_, i) => buffer.getChannelData(Math.min(i, buffer.numberOfChannels - 1)));
      const pcm = new Int16Array(n * ch);
      for (let i = 0; i < n; i++) {
        let m = 0;
        for (let c = 0; c < ch; c++) {
          const s = Math.max(-1, Math.min(1, chans[c][i]));
          pcm[i * ch + c] = s < 0 ? s * 0x8000 : s * 0x7fff;
          const a = s < 0 ? -s : s;
          if (a > m) m = a;
        }
        if (m > winMax) winMax = m;
        if (++winCount === per) {
          peaks.push(Math.min(255, Math.round(Math.sqrt(winMax) * 255)));
          winMax = 0;
          winCount = 0;
        }
      }
      await w.write(pcm);
      bytes += pcm.byteLength;
    }
    if (winCount) peaks.push(Math.min(255, Math.round(Math.sqrt(winMax) * 255)));
    await w.write({ type: 'write', position: 0, data: wavHeader(bytes, ch, rate) });
    await w.close();
    await writeFile(peaksFile, new Blob([JSON.stringify(peaks)]));
    await register(wav);
    return { audioUrl: mediaUrl(wav), peaks };
  } catch (e) {
    await w.abort().catch(() => {});
    throw e;
  } finally {
    input.dispose();
  }
}

// ---------- saving files the user picks ----------
/** File handles chosen in the save dialog, by the name the editor passes around as its "path". */
const saveHandles = new Map<string, FileSystemFileHandle>();

export async function saveTarget(name: string): Promise<{ handle: FileSystemFileHandle; writable: FileSystemWritableFileStream } | null> {
  const handle = saveHandles.get(name);
  return handle ? { handle, writable: await handle.createWritable() } : null;
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

export async function saveBlob(name: string, blob: Blob) {
  const t = await saveTarget(name);
  if (!t) return download(blob, name);
  await t.writable.write(blob);
  await t.writable.close();
}

/** Must run inside the click that asked for it (browsers require a user gesture for pickers). */
function pickMediaFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'video/*,audio/*,image/*,.mkv,.mov,.m4a,.flac';
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

// ---------- settings (kept in this browser) ----------
const SETTINGS_KEY = 'icut-browser-settings';
const DEFAULTS = { model: 'claude-opus-5-5', effort: 'medium', autoApproveAll: false, multiAgent: true, recentProjects: [] as string[], provider: 'claude' };
function getSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}
function setSettings(patch: any) {
  const s = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {}
  return s;
}

export const NEEDS_HELPER = 'AI agents and this feature run on your computer through the IngrainedCut helper. Start it, then click Connect in the editor.';

// ---------- the channel handlers ----------
type Emit = (ch: string, payload: any) => void;

export function createBrowserEngine(emit: Emit) {
  const toast = (message: string) => emit('app:toast', { message });

  async function processAssets(id: string, path: string, info: any) {
    try {
      if (info.type !== 'audio') emit('media:update', { id, patch: await makeThumbnails(path, info) });
    } catch (e) {
      console.warn('thumbnails', e);
    }
    try {
      if (info.hasAudio) emit('media:update', { id, patch: { ...(await makeAudioAssets(path)), status: 'ready' } });
      else emit('media:update', { id, patch: { status: 'ready' } });
    } catch (e) {
      console.warn('audio', e);
      emit('media:update', { id, patch: { status: 'ready' } });
    }
  }

  const handlers: Record<string, (...a: any[]) => any> = {
    'dialog:open-media': () => pickMediaFiles().then((files) => (files.length ? storeFiles(files, toast) : [])),
    'dialog:save': async (opts: any) => {
      const name = String(opts?.defaultPath ?? 'export').split(/[\\/]/).pop()!;
      const picker = (window as any).showSaveFilePicker;
      if (!picker) return name;
      try {
        const ext = opts?.filters?.[0]?.extensions?.[0];
        const h: FileSystemFileHandle = await picker({ suggestedName: name, ...(ext ? { types: [{ description: ext.toUpperCase(), accept: { 'application/octet-stream': ['.' + ext] } }] } : {}) });
        saveHandles.set(h.name, h);
        return h.name;
      } catch (e: any) {
        if (e?.name === 'AbortError') return null;
        return name; // picker unavailable here (e.g. no user gesture): fall back to a download
      }
    },
    'dialog:open-project': () => null,
    'dialog:choose-file': () => null,
    'fs:exists': async (p: string) => {
      if (!isBrowserPath(p) || !(await fileExists(p))) return false;
      await register(p);
      return true;
    },
    'fs:write-png': ({ path, data }: any) => saveBlob(String(path).split(/[\\/]/).pop()!, new Blob([data], { type: 'image/png' })),
    'media:import': async (items: { id: string; path: string }[]) => {
      const out: { id: string; ok: boolean; info?: any; error?: string }[] = [];
      for (const { id, path } of items) {
        try {
          if (!isBrowserPath(path)) throw new Error('Files on disk need the helper. Use Import… to add them to this browser.');
          const info = await probe(path);
          out.push({ id, ok: true, info });
          processAssets(id, path, info);
        } catch (e: any) {
          out.push({ id, ok: false, error: e?.message || String(e) });
        }
      }
      return out;
    },
    'media:refresh-assets': ({ id, path, info }: any) => isBrowserPath(path) && processAssets(id, path, info),
    'project:save': async ({ path, data }: any) => {
      await saveBlob(String(path).split(/[\\/]/).pop()!, new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
      return true;
    },
    'project:load': () => {
      throw new Error('Open projects from your projects page.');
    },
    'settings:get': () => getSettings(),
    'settings:set': (patch: any) => setSettings(patch),
    'app:info': () => ({ version: 'web', mcpServerPath: '', bridgeFile: '', ffmpegOk: false, userData: "This browser's storage", documents: '', startupProject: null }),
    'shell:reveal': () => toast('Saved to your downloads'),
    'shell:open-external': (url: string) => void window.open(url, '_blank', 'noopener'),
    // AI and engine-only features run on the user's computer
    'agent:send': () => {
      emit('agent:event', { type: 'error', message: NEEDS_HELPER });
      emit('agent:event', { type: 'idle' });
    },
    'agent:interrupt': () => {},
    'agent:reset': () => emit('agent:event', { type: 'idle' }),
    'agent:set-model': ({ model, effort }: any) => void setSettings({ model, effort }),
    'agent:set-bypass': (on: boolean) => void setSettings({ autoApproveAll: !!on }),
    'agent:set-provider': (p: string) => setSettings({ provider: p }),
    'providers:status': () => ({ installed: false, loggedIn: false, apiKey: false, ready: false, error: NEEDS_HELPER }),
    'providers:models': () => [],
    'providers:login': () => ({ ok: false, out: NEEDS_HELPER }),
    'providers:cancel-login': () => {},
    'providers:install': () => ({ ok: false, out: NEEDS_HELPER }),
    'engine:tool': () => ({ content: [{ type: 'text', text: 'Error: ' + NEEDS_HELPER }], isError: true }),
    'sessions:list': () => [],
    'auth:status': () => ({ loggedIn: false, apiKey: false, ready: false }),
    'auth:login': () => ({ ok: false, out: NEEDS_HELPER }),
    'auth:cancel': () => {},
    'whisper:download': () => {
      throw new Error(NEEDS_HELPER);
    },
  };

  return {
    /** Called synchronously from the click that triggered it, so file pickers keep their user gesture. */
    invoke(ch: string, ...args: any[]): Promise<any> {
      const h = handlers[ch];
      if (!h) return Promise.reject(new Error(ch.startsWith('export:') || ch.startsWith('sessions:') ? NEEDS_HELPER : `${ch} isn't available in the browser`));
      try {
        return Promise.resolve(h(...args));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    send(_ch: string, _payload?: any) {},
  };
}
