// ffmpeg / ffprobe helpers: probing, thumbnails, waveforms, analysis.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { userDataDir } from './paths.mjs';
import { findPackage, npmInstall, runtimeDir, versionOf } from './runtimePackages.mjs';

const require = createRequire(import.meta.url);

/** An explicit override, else the FFmpeg on PATH, else an npm build (node_modules, or fetched by ensureFfmpeg); null if none. */
function findTool(envVar, name, npmBuild) {
  if (process.env[envVar]) return process.env[envVar];
  if (spawnSync(name, ['-version'], { windowsHide: true }).status === 0) return name;
  try {
    const p = npmBuild();
    if (p && fs.existsSync(p)) return p;
  } catch {}
  return null;
}

const findFfmpeg = () => findTool('ICUT_FFMPEG', 'ffmpeg', () => require(findPackage('ffmpeg-static', runtimeDir('ffmpeg'))));
const findFfprobe = () => findTool('ICUT_FFPROBE', 'ffprobe', () => require(findPackage('@ffprobe-installer/ffprobe', runtimeDir('ffmpeg'))).path);
let found = [findFfmpeg(), findFfprobe()];
export let FFMPEG = found[0] ?? 'ffmpeg';
export let FFPROBE = found[1] ?? 'ffprobe';
let fetching = null; // the download below; run() waits for it

/** No FFmpeg on this computer: download the npm builds (~80 MB) in the background. Null when there's nothing to fetch. */
export function ensureFfmpeg() {
  if (fetching || (found[0] && found[1])) return fetching;
  const specs = ['ffmpeg-static', '@ffprobe-installer/ffprobe'].map((n) => `${n}@${versionOf(n)}`);
  fetching = npmInstall(runtimeDir('ffmpeg'), specs).then(() => {
    found = [findFfmpeg(), findFfprobe()];
    FFMPEG = found[0] ?? 'ffmpeg';
    FFPROBE = found[1] ?? 'ffprobe';
    fetching = null;
    return !!(found[0] && found[1]);
  });
  return fetching;
}

export const ffmpegFetching = () => !!fetching;

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg', '.opus', '.wma', '.aiff', '.aif']);

export function cacheDir() {
  const d = path.join(userDataDir(), 'media-cache');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function cacheKey(filePath) {
  let stamp = '';
  try {
    const st = fs.statSync(filePath);
    stamp = `${st.size}-${st.mtimeMs}`;
  } catch {}
  return crypto.createHash('sha1').update(filePath + stamp).digest('hex').slice(0, 16);
}

export async function run(cmd, args, { onStderr, stdoutBuffer = false, signal } = {}) {
  if (fetching && (cmd === 'ffmpeg' || cmd === 'ffprobe')) {
    await fetching;
    cmd = cmd === 'ffmpeg' ? FFMPEG : FFPROBE;
  }
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => {
      const s = d.toString();
      err += s;
      if (err.length > 2_000_000) err = err.slice(-1_000_000);
      onStderr?.(s);
    });
    p.on('error', reject);
    signal?.addEventListener('abort', () => p.kill('SIGKILL'));
    p.on('close', (code) => {
      const buf = Buffer.concat(out);
      if (code === 0) resolve({ stdout: stdoutBuffer ? buf : buf.toString(), stderr: err });
      else reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.slice(-1500)}`));
    });
  });
}

function parseRate(r) {
  if (!r || r === '0/0') return 0;
  const [a, b] = r.split('/').map(Number);
  return b ? a / b : a;
}

export async function probe(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath]);
  const j = JSON.parse(stdout);
  const v = j.streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const isImage = IMAGE_EXT.has(ext) || (v && !a && (!j.format.duration || ['png', 'mjpeg', 'bmp', 'webp', 'tiff', 'gif'].includes(v.codec_name) && IMAGE_EXT.has(ext)));
  const type = isImage ? 'image' : v ? 'video' : a || AUDIO_EXT.has(ext) ? 'audio' : 'video';
  let duration = parseFloat(j.format.duration || v?.duration || a?.duration || '0') || 0;
  if (type === 'image') duration = 0;
  let width = v?.width || 0;
  let height = v?.height || 0;
  const rot = Number(v?.tags?.rotate || v?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation || 0);
  if (Math.abs(rot) === 90 || Math.abs(rot) === 270) [width, height] = [height, width];
  return {
    type,
    duration,
    width,
    height,
    fps: v ? parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate) || 30 : 0,
    hasVideo: !!v && type !== 'audio',
    hasAudio: !!a,
    videoCodec: v?.codec_name || '',
    audioCodec: a?.codec_name || '',
    sampleRate: a ? Number(a.sample_rate) : 0,
    channels: a?.channels || 0,
    size: Number(j.format.size || 0),
    bitrate: Number(j.format.bit_rate || 0),
  };
}

/** Poster frame + horizontal filmstrip sprite. */
export async function makeThumbnails(filePath, info) {
  const key = cacheKey(filePath);
  const dir = cacheDir();
  const poster = path.join(dir, `${key}-poster.jpg`);
  const sprite = path.join(dir, `${key}-sprite.jpg`);
  const tiles = info.type === 'image' ? 1 : Math.max(1, Math.min(40, Math.ceil(info.duration / 2)));
  const tileH = 72;
  const tileW = Math.max(16, Math.round((tileH * (info.width || 16)) / (info.height || 9)));
  if (!fs.existsSync(poster)) {
    const at = info.type === 'video' ? Math.min(1, info.duration / 3) : 0;
    const args = ['-y', '-v', 'error'];
    if (at > 0) args.push('-ss', String(at));
    args.push('-i', filePath, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', poster);
    await run(FFMPEG, args);
  }
  if (info.type === 'video' && !fs.existsSync(sprite)) {
    const rate = tiles / Math.max(info.duration, 0.1);
    await run(FFMPEG, [
      '-y', '-v', 'error', '-i', filePath,
      '-vf', `fps=${rate.toFixed(6)},scale=${tileW}:${tileH},tile=${tiles}x1`,
      '-frames:v', '1', '-q:v', '5', sprite,
    ]);
  }
  return {
    poster,
    sprite: info.type === 'video' ? { path: sprite, tiles, tileW, tileH, interval: info.duration / tiles } : null,
  };
}

/** 100 peaks/sec mono waveform (0-255) and a 48k stereo WAV used for export mixing. */
export async function makeAudioAssets(filePath, info) {
  const key = cacheKey(filePath);
  const dir = cacheDir();
  const wav = path.join(dir, `${key}-audio.wav`);
  const peaksFile = path.join(dir, `${key}-peaks.json`);
  if (!fs.existsSync(wav)) {
    await run(FFMPEG, ['-y', '-v', 'error', '-i', filePath, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', wav]);
  }
  let peaks;
  if (fs.existsSync(peaksFile)) {
    peaks = JSON.parse(fs.readFileSync(peaksFile, 'utf8'));
  } else {
    const { stdout } = await run(FFMPEG, ['-v', 'error', '-i', wav, '-ac', '1', '-ar', '4000', '-f', 's16le', '-'], { stdoutBuffer: true });
    const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2));
    const per = 40; // 4000 / 40 = 100 peaks per second
    peaks = new Array(Math.ceil(samples.length / per));
    for (let i = 0; i < peaks.length; i++) {
      let m = 0;
      const end = Math.min(samples.length, (i + 1) * per);
      for (let j = i * per; j < end; j++) {
        const v = Math.abs(samples[j]);
        if (v > m) m = v;
      }
      peaks[i] = Math.min(255, Math.round(Math.sqrt(m / 32768) * 255));
    }
    fs.writeFileSync(peaksFile, JSON.stringify(peaks));
  }
  return { wav, peaks };
}

export async function detectSilence(filePath, { thresholdDb = -35, minDuration = 0.4, start, end } = {}) {
  const args = ['-v', 'info', '-nostats'];
  if (start != null) args.push('-ss', String(start));
  if (end != null) args.push('-to', String(end));
  args.push('-i', filePath, '-vn', '-af', `silencedetect=noise=${thresholdDb}dB:d=${minDuration}`, '-f', 'null', '-');
  const { stderr } = await run(FFMPEG, args);
  const out = [];
  let cur = null;
  const off = start || 0;
  for (const line of stderr.split(/\r?\n/)) {
    let m = line.match(/silence_start: (-?[\d.]+)/);
    if (m) cur = { start: Math.max(0, parseFloat(m[1])) + off };
    m = line.match(/silence_end: ([\d.]+)/);
    if (m && cur) {
      cur.end = parseFloat(m[1]) + off;
      out.push(cur);
      cur = null;
    }
  }
  if (cur) cur.end = end ?? null;
  if (cur) out.push(cur);
  return out;
}

export async function detectScenes(filePath, { threshold = 0.3 } = {}) {
  const { stderr } = await run(FFMPEG, [
    '-v', 'info', '-nostats', '-i', filePath, '-an',
    '-vf', `scale=320:-2,select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-',
  ]);
  const cuts = [];
  for (const line of stderr.split(/\r?\n/)) {
    const m = line.match(/Parsed_showinfo.*pts_time:([\d.]+)/);
    if (m) cuts.push(Math.round(parseFloat(m[1]) * 1000) / 1000);
  }
  return cuts;
}

function escapeFilterPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function parseSrtTime(s) {
  const m = s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
}

/** Speech-to-text via ffmpeg's whisper filter (needs a whisper.cpp ggml model file). */
export async function transcribe(filePath, modelPath, { language = 'auto' } = {}) {
  if (!modelPath || !fs.existsSync(modelPath)) {
    throw new Error('No Whisper model configured. Open Settings → Transcription and download or choose a ggml model file.');
  }
  const key = cacheKey(filePath);
  const dir = cacheDir();
  const srtName = `${key}-${path.basename(modelPath).replace(/\W+/g, '_')}.srt`;
  const srt = path.join(dir, srtName);
  if (!fs.existsSync(srt)) {
    await new Promise((resolve, reject) => {
      const args = [
        '-y', '-v', 'error', '-i', filePath, '-vn',
        '-af', `aresample=16000,whisper=model='${escapeFilterPath(modelPath)}':language=${language}:queue=10:destination=${srtName}:format=srt`,
        '-f', 'null', '-',
      ];
      const p = spawn(FFMPEG, args, { cwd: dir, windowsHide: true });
      let err = '';
      p.stderr.on('data', (d) => (err += d));
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Transcription failed: ' + err.slice(-800)))));
    });
  }
  const text = fs.readFileSync(srt, 'utf8');
  const segs = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const lines = block.trim().split(/\r?\n/);
    const tl = lines.find((l) => l.includes('-->'));
    if (!tl) continue;
    const [a, b] = tl.split('-->');
    const body = lines.slice(lines.indexOf(tl) + 1).join(' ').trim();
    if (body) segs.push({ start: parseSrtTime(a), end: parseSrtTime(b), text: body });
  }
  return segs;
}

export async function loudness(filePath) {
  const { stderr } = await run(FFMPEG, ['-v', 'info', '-nostats', '-i', filePath, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const i = stderr.match(/I:\s+(-?[\d.]+) LUFS/g);
  const peak = stderr.match(/Peak:\s+(-?[\d.]+) dBFS/g);
  return {
    integrated_lufs: i ? parseFloat(i[i.length - 1].match(/-?[\d.]+/)[0]) : null,
    true_peak_dbfs: peak ? parseFloat(peak[peak.length - 1].match(/-?[\d.]+/)[0]) : null,
  };
}
