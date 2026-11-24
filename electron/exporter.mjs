// Receives raw RGBA frames from the renderer's compositor and pipes them into ffmpeg.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FFMPEG } from './media.mjs';

// The compositor produces sRGB pixels; convert with the BT.709 matrix (the HD standard players assume) and tag it,
// so exported colours match what the program monitor shows.
const BT709 = ['-vf', 'scale=out_color_matrix=bt709:out_range=tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

// Rate control: a CRF-like quality by default, or a target bitrate (o.bitrate, bits/s) with a capped peak.
const rate = (crf, o) => (o.bitrate ? ['-b:v', String(Math.round(o.bitrate)), '-maxrate', String(Math.round(o.bitrate * 1.5)), '-bufsize', String(Math.round(o.bitrate * 2))] : ['-crf', String(crf)]);
const aac = (o) => ['-c:a', 'aac', '-b:a', `${o.audioBitrate ?? 192}k`];
const pcm = (o) => ['-c:a', o.bitDepth === 24 ? 'pcm_s24le' : 'pcm_s16le'];

/** The ffmpeg build's encoders (checked once): AV1 uses the best software encoder this build has. */
let encoderList = null;
function hasEncoder(name) {
  if (!encoderList) encoderList = spawnSync(FFMPEG, ['-hide_banner', '-encoders'], { windowsHide: true, encoding: 'utf8' }).stdout ?? '';
  return new RegExp(`\\s${name}\\s`).test(encoderList);
}
function av1(q, o) {
  if (hasEncoder('libsvtav1')) return ['-c:v', 'libsvtav1', '-preset', '8', ...rate(q + 12, o), '-pix_fmt', 'yuv420p'];
  // libaom: tuned for speed (cpu-used 6, row-mt); still the slowest encoder here
  return ['-c:v', 'libaom-av1', '-cpu-used', '6', '-row-mt', '1', '-tiles', '2x2', ...(o.bitrate ? rate(0, o) : ['-crf', String(q + 12), '-b:v', '0']), '-pix_fmt', 'yuv420p'];
}
const PRORES_PIX = (profile) => (profile >= 4 ? 'yuva444p10le' : 'yuv422p10le');
const DNXHR_PIX = { dnxhr_lb: 'yuv422p', dnxhr_sq: 'yuv422p', dnxhr_hq: 'yuv422p', dnxhr_hqx: 'yuv422p10le', dnxhr_444: 'yuv444p10le' };

/** Each format: its extension, ffmpeg video arguments (q = CRF-like quality, o = the export options) and audio arguments. */
export const FORMATS = {
  'mp4-h264': { ext: 'mp4', video: (q, o) => [...BT709, '-c:v', 'libx264', '-preset', 'medium', ...rate(q, o), '-pix_fmt', 'yuv420p', '-movflags', '+faststart'], audio: aac },
  'mp4-h265': { ext: 'mp4', video: (q, o) => [...BT709, '-c:v', 'libx265', '-preset', 'medium', ...rate(q + 4, o), '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-movflags', '+faststart'], audio: aac },
  'mp4-av1': { ext: 'mp4', video: (q, o) => [...BT709, ...av1(q, o), '-movflags', '+faststart'], audio: aac },
  'webm-vp9': { ext: 'webm', video: (q, o) => [...BT709, '-c:v', 'libvpx-vp9', ...(o.bitrate ? rate(0, o) : ['-b:v', '0', '-crf', String(q + 13)]), '-row-mt', '1', '-pix_fmt', 'yuv420p'], audio: (o) => ['-c:a', 'libopus', '-b:a', `${o.audioBitrate ?? 160}k`] },
  'mov-prores': { ext: 'mov', video: (q, o) => [...BT709, '-c:v', 'prores_ks', '-profile:v', String(o.proresProfile ?? 3), '-pix_fmt', PRORES_PIX(o.proresProfile ?? 3)], audio: pcm },
  'mov-dnxhr': { ext: 'mov', video: (q, o) => [...BT709, '-c:v', 'dnxhd', '-profile:v', o.dnxhrProfile ?? 'dnxhr_hq', '-pix_fmt', DNXHR_PIX[o.dnxhrProfile ?? 'dnxhr_hq'] ?? 'yuv422p'], audio: pcm },
  gif: { ext: 'gif', video: () => ['-vf', 'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4'], audio: null },
  mp3: { ext: 'mp3', audioOnly: true, audio: (o) => ['-c:a', 'libmp3lame', '-b:a', `${o.audioBitrate ?? 256}k`] },
  'm4a-aac': { ext: 'm4a', audioOnly: true, audio: (o) => [...aac({ audioBitrate: o.audioBitrate ?? 256 }), '-movflags', '+faststart'] },
  wav: { ext: 'wav', audioOnly: true, audio: pcm },
  flac: { ext: 'flac', audioOnly: true, audio: (o) => ['-c:a', 'flac', ...(o.bitDepth === 24 ? ['-sample_fmt', 's32'] : [])] },
};

/** ffmpeg wants NTSC rates as fractions (29.97 → 30000/1001). */
function fpsArg(fps) {
  const ntsc = Math.round(fps * 1.001);
  return Math.abs(fps - ntsc / 1.001) < 0.005 && Math.abs(fps - ntsc) > 0.005 ? `${ntsc * 1000}/1001` : String(fps);
}

let job = null;

export function startExport({ outPath, width, height, fps, format, quality = 18, audioWav, ...o }) {
  if (job) throw new Error('An export is already running');
  const f = FORMATS[format];
  if (!f) throw new Error('Unknown format ' + format);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const args = ['-y', '-v', 'error'];
  if (!f.audioOnly) {
    args.push('-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', fpsArg(fps), '-i', 'pipe:0');
  }
  const useAudio = audioWav && f.audio;
  if (useAudio) args.push('-i', audioWav);
  if (!f.audioOnly) {
    args.push('-map', '0:v');
    if (useAudio) args.push('-map', '1:a');
    args.push(...f.video(quality, o));
    if (useAudio) args.push(...f.audio(o), '-shortest');
    else args.push('-an');
  } else {
    args.push(...f.audio(o));
  }
  args.push(outPath);
  const proc = spawn(FFMPEG, args, { windowsHide: true });
  let stderr = '';
  proc.stderr.on('data', (d) => (stderr += d));
  const done = new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg failed: ' + stderr.slice(-1500)))));
  });
  done.catch(() => {});
  job = { proc, done, audioWav, outPath, audioOnly: !!f.audioOnly };
  return { audioOnly: !!f.audioOnly };
}

export async function writeFrame(buf) {
  if (!job) throw new Error('No export running');
  const ok = job.proc.stdin.write(Buffer.from(buf));
  if (!ok) await new Promise((r) => job.proc.stdin.once('drain', r));
}

export async function finishExport() {
  if (!job) throw new Error('No export running');
  const j = job;
  j.proc.stdin.end();
  try {
    await j.done;
  } finally {
    job = null;
    if (j.audioWav) fs.rm(j.audioWav, { force: true }, () => {});
  }
  return { path: j.outPath, size: fs.statSync(j.outPath).size };
}

export function cancelExport() {
  if (!job) return;
  const j = job;
  job = null;
  try {
    j.proc.stdin.destroy();
    j.proc.kill('SIGKILL');
  } catch {}
  setTimeout(() => fs.rm(j.outPath, { force: true }, () => {}), 500);
}

export function writeTempWav(buf) {
  const p = path.join(os.tmpdir(), `icut-mix-${Date.now()}.wav`);
  fs.writeFileSync(p, Buffer.from(buf));
  return p;
}

// ---------- WebCodecs path: the UI encodes video; we receive the container in chunks, then mux in audio ----------
let wc = null;

const toBuffer = (x) => (Buffer.isBuffer(x) ? x : ArrayBuffer.isView(x) ? Buffer.from(x.buffer, x.byteOffset, x.byteLength) : Buffer.from(x));

export function wcStart({ ext }) {
  if (wc) wcCancel();
  const tmp = path.join(os.tmpdir(), `icut-video-${Date.now()}.${ext === 'webm' ? 'webm' : 'mp4'}`);
  wc = { tmp, fd: fs.openSync(tmp, 'w') };
  return { tmp };
}

export function wcChunk({ position, data }) {
  if (!wc) throw new Error('No export running');
  const b = toBuffer(data);
  fs.writeSync(wc.fd, b, 0, b.length, position);
}

export async function wcFinish({ outPath, audio, format, ...o }) {
  if (!wc) throw new Error('No export running');
  const { tmp, fd } = wc;
  wc = null;
  fs.closeSync(fd);
  const wav = audio ? writeTempWav(toBuffer(audio)) : null;
  const f = FORMATS[format];
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const args = ['-y', '-v', 'error', '-i', tmp];
  if (wav) args.push('-i', wav, '-map', '0:v', '-map', '1:a');
  args.push('-c:v', 'copy');
  if (wav) args.push(...f.audio(o));
  if (f.ext === 'mp4') args.push('-movflags', '+faststart');
  args.push(outPath);
  try {
    await new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, args, { windowsHide: true });
      let err = '';
      p.stderr.on('data', (d) => (err += d));
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg mux failed: ' + err.slice(-1500)))));
    });
  } finally {
    fs.rm(tmp, { force: true }, () => {});
    if (wav) fs.rm(wav, { force: true }, () => {});
  }
  return { path: outPath, size: fs.statSync(outPath).size };
}

export function wcCancel() {
  if (!wc) return;
  const { tmp, fd } = wc;
  wc = null;
  try {
    fs.closeSync(fd);
  } catch {}
  fs.rm(tmp, { force: true }, () => {});
}
