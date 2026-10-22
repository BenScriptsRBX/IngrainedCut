// Receives raw RGBA frames from the renderer's compositor and pipes them into ffmpeg.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FFMPEG } from './media.mjs';

// The compositor produces sRGB pixels; convert with the BT.709 matrix (the HD standard players assume) and tag it,
// so exported colours match what the program monitor shows.
const BT709 = ['-vf', 'scale=out_color_matrix=bt709:out_range=tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

export const FORMATS = {
  'mp4-h264': { ext: 'mp4', video: (q) => [...BT709, '-c:v', 'libx264', '-preset', 'medium', '-crf', String(q), '-pix_fmt', 'yuv420p', '-movflags', '+faststart'], audio: ['-c:a', 'aac', '-b:a', '192k'] },
  'mp4-h265': { ext: 'mp4', video: (q) => [...BT709, '-c:v', 'libx265', '-preset', 'medium', '-crf', String(q + 4), '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-movflags', '+faststart'], audio: ['-c:a', 'aac', '-b:a', '192k'] },
  'mov-prores': { ext: 'mov', video: () => [...BT709, '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le'], audio: ['-c:a', 'pcm_s16le'] },
  'webm-vp9': { ext: 'webm', video: (q) => [...BT709, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(q + 13), '-row-mt', '1', '-pix_fmt', 'yuv420p'], audio: ['-c:a', 'libopus', '-b:a', '160k'] },
  gif: { ext: 'gif', video: () => ['-vf', 'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4'], audio: null },
  mp3: { ext: 'mp3', audioOnly: true, audio: ['-c:a', 'libmp3lame', '-b:a', '256k'] },
  wav: { ext: 'wav', audioOnly: true, audio: ['-c:a', 'pcm_s16le'] },
};

let job = null;

export function startExport({ outPath, width, height, fps, format, quality = 18, audioWav }) {
  if (job) throw new Error('An export is already running');
  const f = FORMATS[format];
  if (!f) throw new Error('Unknown format ' + format);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const args = ['-y', '-v', 'error'];
  if (!f.audioOnly) {
    args.push('-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0');
  }
  const useAudio = audioWav && f.audio;
  if (useAudio) args.push('-i', audioWav);
  if (!f.audioOnly) {
    args.push('-map', '0:v');
    if (useAudio) args.push('-map', '1:a');
    args.push(...f.video(quality));
    if (useAudio) args.push(...f.audio, '-shortest');
    else args.push('-an');
  } else {
    args.push(...f.audio);
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

export async function wcFinish({ outPath, audio, format }) {
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
  if (wav) args.push(...f.audio);
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
