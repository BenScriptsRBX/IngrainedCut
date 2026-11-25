// Export: mixes audio offline (WebAudio), decodes clips with WebCodecs, renders through the compositor and
// encodes with WebCodecs (hardware) — ffmpeg only muxes. ProRes/GIF/audio-only fall back to piping raw frames to ffmpeg.
import { mediaSrc, isBrowserEngine } from './webBridge';
import { Compositor, anySolo, clipGain } from './compositor';
import { clipEnd, mediaOf, sequenceDuration } from './ops';
import type { MediaItem, Project } from './types';
import { S, setS, toast } from './store';
import { ExportFrames } from './exportFrames';
import { measureBuffer, normalizeBuffer } from './loudness';
import { saveTarget, saveBlob, download } from './browserEngine';
import {
  AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, StreamTarget, WebMOutputFormat, canEncodeAudio, canEncodeVideo,
  type AudioCodec, type StreamTargetChunk,
} from 'mediabunny';

export type ExportFormat =
  | 'mp4-h264' | 'mp4-h265' | 'mp4-av1' | 'webm-vp9' | 'mov-prores' | 'mov-dnxhr' | 'gif'
  | 'mp3' | 'm4a-aac' | 'wav' | 'flac';

export interface ExportOptions {
  path: string;
  format: ExportFormat;
  /** CRF-like: 14 best … 27 smallest (ignored when `bitrate` is set) */
  quality?: number;
  range?: 'all' | 'in-out';
  /** output size relative to the sequence (the aspect ratio stays) */
  scale?: number;
  /** output frame rate (default: the sequence's) */
  fps?: number;
  /** target video bitrate in bits per second (instead of `quality`) */
  bitrate?: number;
  /** auto: GPU/WebCodecs when available; cpu: ffmpeg software encoders (x264, x265, libaom…) */
  encoder?: 'auto' | 'cpu';
  /** ProRes: 0 Proxy, 1 LT, 2 422, 3 422 HQ, 4 4444 */
  proresProfile?: number;
  /** DNxHR: dnxhr_lb | dnxhr_sq | dnxhr_hq | dnxhr_hqx | dnxhr_444 */
  dnxhrProfile?: string;
  /** audio bitrate for lossy audio, kbps */
  audioBitrate?: number;
  /** audio sample rate, Hz */
  sampleRate?: number;
  /** WAV bit depth */
  bitDepth?: 16 | 24;
  /** normalise the mix (default: the sequence's loudness setting); null = don't */
  loudness?: { lufs: number; truePeak: number } | null;
}

let cancelled = false;
export function cancelExport() {
  cancelled = true;
}

const decoded = new Map<string, AudioBuffer>();
async function decodeMedia(ctx: BaseAudioContext, m: MediaItem) {
  const key = m.id + '|' + (m.audioUrl || m.url);
  if (decoded.has(key)) return decoded.get(key)!;
  const buf = await (await fetch(mediaSrc(m.audioUrl || m.url))).arrayBuffer();
  const ab = await ctx.decodeAudioData(buf);
  decoded.set(key, ab);
  return ab;
}

export async function renderMix(p: Project, a: number, b: number, sr = 48000): Promise<AudioBuffer> {
  const len = Math.max(1, Math.ceil((b - a) * sr));
  const off = new OfflineAudioContext(2, len, sr);
  const solo = anySolo(p);
  for (const c of p.clips) {
    if (c.kind !== 'audio' || !c.enabled) continue;
    const s0 = Math.max(c.start, a);
    const s1 = Math.min(clipEnd(c), b);
    if (s1 - s0 <= 0.001) continue;
    const m = mediaOf(p, c);
    if (!m || !m.hasAudio) continue;
    let buf: AudioBuffer;
    try {
      buf = await decodeMedia(off, m);
    } catch (e) {
      console.warn('decode failed', m.name, e);
      continue;
    }
    const src = off.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = c.speed;
    const gain = off.createGain();
    const pan = off.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, (c.pan || 0) / 100));
    const steps = Math.max(2, Math.ceil((s1 - s0) * 100));
    const curve = new Float32Array(steps);
    for (let i = 0; i < steps; i++) curve[i] = clipGain(p, c, s0 + ((s1 - s0) * i) / (steps - 1) - c.start, solo);
    gain.gain.setValueCurveAtTime(curve, s0 - a, s1 - s0);
    src.connect(gain).connect(pan).connect(off.destination);
    src.start(s0 - a, c.in + (s0 - c.start) * c.speed, (s1 - s0) * c.speed);
  }
  return off.startRendering();
}

export function encodeWav(ab: AudioBuffer): ArrayBuffer {
  const ch = ab.numberOfChannels;
  const n = ab.length;
  const buf = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * ch * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, ab.sampleRate, true);
  v.setUint32(28, ab.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => ab.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return buf;
}

const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);

/** Formats encoded in the browser with WebCodecs (hardware where available); the rest go through ffmpeg. */
const WEBCODECS: Partial<Record<ExportFormat, { codec: 'avc' | 'hevc' | 'vp9' | 'av1'; container: 'mp4' | 'webm'; factor: number }>> = {
  'mp4-h264': { codec: 'avc', container: 'mp4', factor: 1 },
  'mp4-h265': { codec: 'hevc', container: 'mp4', factor: 0.65 },
  'mp4-av1': { codec: 'av1', container: 'mp4', factor: 0.55 },
  'webm-vp9': { codec: 'vp9', container: 'webm', factor: 0.7 },
};

export const AUDIO_ONLY: ExportFormat[] = ['mp3', 'm4a-aac', 'wav', 'flac'];

/** Map the dialog's CRF-like quality (14 best … 27 smallest) to a bitrate for hardware encoders. High frame rates
 *  need fewer bits per frame (frames are closer together), so past 60 fps each extra frame counts half; capped at
 *  what hardware encoders accept. */
export function bitrateFor(quality: number, W: number, H: number, fps: number, factor: number) {
  const bpp = quality <= 14 ? 0.32 : quality <= 18 ? 0.2 : quality <= 22 ? 0.12 : 0.07;
  const fpsEff = fps <= 60 ? fps : 60 + (fps - 60) * 0.5;
  return Math.min(400e6, Math.round(W * H * fpsEff * bpp * factor));
}

/**
 * Some GPU drivers accept frames into Chromium's hardware encoder but never return any (seen on an
 * AMD RX 9070 XT). Probe once per session with a few frames; if nothing comes back, use the software encoder.
 */
const hwWorks = new Map<string, Promise<boolean>>();
function hardwareEncoderWorks(codecString: string): Promise<boolean> {
  if (!hwWorks.has(codecString)) {
    hwWorks.set(
      codecString,
      (async () => {
        const cfg: VideoEncoderConfig = { codec: codecString, width: 640, height: 360, bitrate: 2e6, framerate: 30, hardwareAcceleration: 'prefer-hardware' };
        try {
          if (!(await VideoEncoder.isConfigSupported(cfg)).supported) return false;
          let outputs = 0;
          const enc = new VideoEncoder({ output: () => outputs++, error: () => {} });
          enc.configure(cfg);
          const cv = new OffscreenCanvas(640, 360);
          const g = cv.getContext('2d')!;
          for (let i = 0; i < 8; i++) {
            g.fillStyle = `hsl(${i * 40},70%,50%)`;
            g.fillRect(0, 0, 640, 360);
            const f = new VideoFrame(cv, { timestamp: i * 33333 });
            enc.encode(f, { keyFrame: i === 0 });
            f.close();
          }
          await Promise.race([enc.flush().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
          try {
            enc.close();
          } catch {}
          return outputs > 0;
        } catch {
          return false;
        }
      })(),
    );
  }
  return hwWorks.get(codecString)!;
}

const PROBE_CODEC: Record<string, string> = { avc: 'avc1.640028', hevc: 'hvc1.1.6.L120.B0', vp9: 'vp09.00.40.08', av1: 'av01.0.08M.08' };

/** Formats the website can export with no helper: everything is encoded and written in the page. */
export const BROWSER_FORMATS: ExportFormat[] = ['mp4-h264', 'webm-vp9', 'mp4-h265', 'mp4-av1', 'wav'];

/**
 * Website without the helper: mediabunny encodes video (WebCodecs) and the audio mix together, written straight
 * into the file the user picked (or offered as a download when the browser has no save picker).
 */
async function exportInBrowser(x: {
  p: Project; o: ExportOptions; a: number; b: number; W: number; H: number; fps: number; format: ExportFormat;
  quality: number; frames: number; frameTimes: number[]; progress: (i: number) => void;
}): Promise<{ path: string; size: number }> {
  const { p, o, W, H, fps, format, frames, frameTimes } = x;
  const name = o.path.split(/[\\/]/).pop() || 'export';
  if (!BROWSER_FORMATS.includes(format)) throw new Error('This format needs the IngrainedCut helper on your computer. In the browser you can export H.264, HEVC, AV1, VP9 or WAV.');
  const mix = await masterMix(p, o, await renderMix(p, x.a, x.b, o.sampleRate ?? 48000));
  if (format === 'wav') {
    const blob = new Blob([encodeWav(mix)], { type: 'audio/wav' });
    await saveBlob(name, blob);
    return { path: name, size: blob.size };
  }
  const wc = WEBCODECS[format]!;
  const q = new Quality({ bitrate: o.bitrate || bitrateFor(x.quality, W, H, fps, wc.factor), bitrateMode: 'variable' });
  const hw = await hardwareEncoderWorks(PROBE_CODEC[wc.codec]);
  if (!((hw || wc.codec !== 'hevc') && (await canEncodeVideo(wc.codec, { width: W, height: H, quality: q })))) {
    throw new Error(`This browser can't encode ${wc.codec === 'hevc' ? 'HEVC' : wc.codec.toUpperCase()} video at ${W}×${H}, ${Math.round(fps * 100) / 100} fps here. Try H.264 or a smaller size, or start the IngrainedCut helper.`);
  }
  let usableAudio: AudioCodec | null = null;
  for (const c of (wc.container === 'mp4' ? ['aac', 'opus'] : ['opus']) as AudioCodec[]) {
    if (await canEncodeAudio(c)) {
      usableAudio = c;
      break;
    }
  }
  if (!usableAudio) toast("This browser can't encode audio for this format — the export will be silent", 'error', 7000);

  const file = await saveTarget(name);
  const target = file ? new StreamTarget(file.writable as WritableStream<StreamTargetChunk>, { chunked: true, chunkSize: 8 * 2 ** 20 }) : new BufferTarget();
  const output = new Output({
    format: wc.container === 'mp4' ? new Mp4OutputFormat({ fastStart: file ? false : 'in-memory' }) : new WebMOutputFormat(),
    target,
  });
  const comp = new Compositor();
  comp.setSize(W, H);
  comp.frames = new ExportFrames(p, frameTimes);
  const video = new CanvasSource(comp.canvas, {
    codec: wc.codec,
    quality: q,
    keyFrameInterval: 2,
    latencyMode: 'quality',
    hardwareAcceleration: hw ? 'prefer-hardware' : 'prefer-software',
  });
  output.addVideoTrack(video, { frameRate: fps });
  const audio = usableAudio ? new AudioBufferSource({ codec: usableAudio, bitrate: (o.audioBitrate ?? 192) * 1000 }) : null;
  if (audio) output.addAudioTrack(audio);
  try {
    await output.start();
    if (audio) {
      await audio.add(mix);
      audio.close();
    }
    for (let i = 0; i < frames; i++) {
      if (cancelled) throw new Error('Export cancelled');
      await comp.frames.beforeFrame(i);
      await comp.render(p, frameTimes[i], 'export');
      await video.add(i / fps, 1 / fps);
      if (i % 5 === 0) x.progress(i);
    }
    setS({ exportJob: { progress: 1, phase: 'Finalizing…', path: name } });
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    comp.frames.close();
    comp.dispose();
  }
  if (file) return { path: name, size: (await file.handle.getFile()).size };
  const buf = (target as BufferTarget).buffer!;
  download(new Blob([buf], { type: wc.container === 'mp4' ? 'video/mp4' : 'video/webm' }), name);
  return { path: name, size: buf.byteLength };
}

export interface ExportResult {
  path: string;
  size: number;
  seconds: number;
  engine: 'webcodecs' | 'ffmpeg';
  /** the exported mix, measured (and what normalising did) */
  loudness?: any;
}

let lastLoudness: any = null;
/** Normalise the finished mix to the loudness target (two-pass: measure, gain, true-peak limit) and measure it. */
async function masterMix(p: Project, o: ExportOptions, mix: AudioBuffer) {
  lastLoudness = null;
  const target = o.loudness === undefined ? p.settings.loudness : o.loudness;
  try {
    if (target) {
      setS({ exportJob: { progress: 0, phase: `Normalising the mix to ${target.lufs} LUFS…`, path: o.path } });
      const r = await normalizeBuffer(mix, target.lufs, target.truePeak);
      lastLoudness = { target: `${target.lufs} LUFS / ${target.truePeak} dBTP`, gain_db: r.applied_gain_db, limited: r.limited, before: r.before, ...r.after };
    } else lastLoudness = (await measureBuffer(mix)).summary();
  } catch (e) {
    console.warn('loudness', e);
  }
  return mix;
}

export async function runExport(o: ExportOptions): Promise<ExportResult> {
  if (S().exportJob) throw new Error('An export is already running');
  const p: Project = structuredClone(S().project);
  const useInOut = o.range === 'in-out' && p.inPoint != null && p.outPoint != null && p.outPoint > p.inPoint;
  const a = useInOut ? p.inPoint! : 0;
  const b = useInOut ? p.outPoint! : sequenceDuration(p);
  if (b - a <= 0) throw new Error('The sequence is empty — nothing to export');
  const fps = o.fps && o.fps > 0 ? Math.min(240, o.fps) : p.settings.fps;
  const scale = o.scale ?? 1;
  const W = even(p.settings.width * scale);
  const H = even(p.settings.height * scale);
  if (W > 8192 || H > 8192) throw new Error(`${W}×${H} is too big to export — the largest size is 8K (7680×4320 for 16:9).`);
  const format = o.format ?? 'mp4-h264';
  const quality = o.quality ?? 18;
  const audioOnly = AUDIO_ONLY.includes(format);
  const sampleRate = o.sampleRate ?? 48000;
  const frames = Math.max(1, Math.round((b - a) * fps));
  const frameTimes = Array.from({ length: frames }, (_, i) => a + i / fps);
  const progress = (i: number) => setS({ exportJob: { progress: i / frames, phase: `Rendering frame ${i + 1} / ${frames}`, path: o.path } });
  cancelled = false;
  setS({ exportJob: { progress: 0, phase: 'Mixing audio…', path: o.path } });
  const started = performance.now();
  const done = (r: { path: string; size: number }, engine: ExportResult['engine']): ExportResult => {
    toast(`Exported ${r.path.split(/[\/]/).pop()} (${(r.size / 1e6).toFixed(1)} MB)`, 'success', 6000);
    return { ...r, seconds: (performance.now() - started) / 1000, engine, ...(lastLoudness ? { loudness: lastLoudness } : {}) };
  };
  try {
    if (isBrowserEngine()) {
      const r = await exportInBrowser({ p, o, a, b, W, H, fps, format, quality, frames, frameTimes, progress });
      return done(r, 'webcodecs');
    }
    const wav = format !== 'gif' ? encodeWav(await masterMix(p, o, await renderMix(p, a, b, sampleRate))) : null;
    const enc = { audioBitrate: o.audioBitrate, bitDepth: o.bitDepth, proresProfile: o.proresProfile, dnxhrProfile: o.dnxhrProfile, bitrate: o.bitrate };

    // ---- fast path: WebCodecs decode + hardware encode, ffmpeg only muxes ----
    const wc = !audioOnly && o.encoder !== 'cpu' ? WEBCODECS[format] : undefined;
    if (wc && typeof VideoEncoder !== 'undefined') {
      const q = new Quality({ bitrate: o.bitrate || bitrateFor(quality, W, H, fps, wc.factor), bitrateMode: 'variable' });
      const hw = await hardwareEncoderWorks(PROBE_CODEC[wc.codec]);
      // HEVC has no software WebCodecs encoder; without working hardware it goes through ffmpeg (x265)
      const usable = (hw || wc.codec !== 'hevc') && (await canEncodeVideo(wc.codec, { width: W, height: H, quality: q }));
      if (usable) {
        await window.icut.exportWcStart({ ext: wc.container });
        const comp = new Compositor();
        comp.setSize(W, H);
        comp.frames = new ExportFrames(p, frameTimes);
        const writable = new WritableStream<StreamTargetChunk>({
          write: (c) => window.icut.exportWcChunk({ position: c.position, data: c.data.slice() }),
        });
        const output = new Output({
          format: wc.container === 'mp4' ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(),
          target: new StreamTarget(writable, { chunked: true, chunkSize: 8 * 2 ** 20 }),
        });
        const source = new CanvasSource(comp.canvas, {
          codec: wc.codec,
          quality: q,
          keyFrameInterval: 2,
          latencyMode: 'quality',
          hardwareAcceleration: hw ? 'prefer-hardware' : 'prefer-software',
        });
        output.addVideoTrack(source, { frameRate: fps });
        try {
          await output.start();
          for (let i = 0; i < frames; i++) {
            if (cancelled) throw new Error('Export cancelled');
            await comp.frames.beforeFrame(i);
            await comp.render(p, frameTimes[i], 'export');
            await source.add(i / fps, 1 / fps);
            if (i % 5 === 0) progress(i);
          }
          setS({ exportJob: { progress: 1, phase: 'Finalizing…', path: o.path } });
          await output.finalize();
          return done(await window.icut.exportWcFinish({ outPath: o.path, audio: wav, format, ...enc }), 'webcodecs');
        } catch (e) {
          await output.cancel().catch(() => {});
          await window.icut.exportWcCancel();
          throw e;
        } finally {
          comp.frames.close();
          comp.dispose();
        }
      }
    }

    // ---- ffmpeg path (ProRes, GIF, audio-only, or no WebCodecs encoder): raw frames piped to ffmpeg ----
    await window.icut.exportStart({ outPath: o.path, width: W, height: H, fps, format, quality, audio: wav, ...enc });
    try {
      if (!audioOnly) {
        const comp = new Compositor();
        comp.setSize(W, H);
        comp.frames = new ExportFrames(p, frameTimes); // decoding still uses WebCodecs
        // keep a few frames in flight so rendering overlaps sending/encoding (frames still arrive in order)
        // (fewer for huge frames: an 8K frame is 130 MB of pixels)
        const maxInFlight = W * H > 3840 * 2160 ? 1 : W * H > 1920 * 1080 ? 2 : 4;
        const inFlight: Promise<void>[] = [];
        try {
          for (let i = 0; i < frames; i++) {
            if (cancelled) throw new Error('Export cancelled');
            await comp.frames.beforeFrame(i);
            await comp.render(p, frameTimes[i], 'export');
            const img = comp.ctx.getImageData(0, 0, W, H);
            inFlight.push(window.icut.exportFrame(img.data.buffer));
            if (inFlight.length >= maxInFlight) await inFlight.shift();
            if (i % 3 === 0) progress(i);
          }
          await Promise.all(inFlight);
        } finally {
          comp.frames.close();
          comp.dispose();
        }
      }
      setS({ exportJob: { progress: 1, phase: 'Finalizing…', path: o.path } });
      return done(await window.icut.exportFinish(), 'ffmpeg');
    } catch (e) {
      await window.icut.exportCancel();
      throw e;
    }
  } finally {
    setS({ exportJob: null });
  }
}
