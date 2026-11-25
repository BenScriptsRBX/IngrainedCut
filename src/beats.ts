// Beat grid of a music file, in the editor: onset strength (spectral flux), tempo from its autocorrelation, beats by
// dynamic programming (Ellis 2007, as in librosa), downbeats from where the low end hits hardest, phrases every 4 bars.
import { mediaSrc } from './webBridge';
import type { MediaItem } from './types';

export interface BeatGrid {
  bpm: number;
  /** source seconds */
  beats: number[];
  downbeats: number[];
  phrases: number[];
  confidence: number;
}

const SR = 22050;
const N = 1024;
const HOP = 256;
const FPS = SR / HOP;

function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

async function decodeMono(m: MediaItem, a: number, b: number) {
  const ctx = new OfflineAudioContext(1, 1, SR);
  const data = await (await fetch(mediaSrc(m.audioUrl || m.url))).arrayBuffer();
  const buf = await ctx.decodeAudioData(data);
  const i0 = Math.max(0, Math.floor(a * SR));
  const i1 = Math.min(buf.length, Math.ceil(b * SR));
  const out = new Float32Array(Math.max(0, i1 - i0));
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = i0; i < i1; i++) out[i - i0] += d[i] / buf.numberOfChannels;
  }
  return out;
}

/** onset strength per frame (full band and low band), frames centred on i·HOP */
function onsets(x: Float32Array) {
  const frames = Math.floor(x.length / HOP) + 1;
  const full = new Float32Array(frames);
  const low = new Float32Array(frames);
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const bins = N / 2;
  const maxBin = Math.floor((8000 / SR) * N);
  const lowBin = Math.max(2, Math.floor((200 / SR) * N));
  let prev = new Float32Array(bins);
  for (let f = 0; f < frames; f++) {
    const c = f * HOP - N / 2;
    for (let i = 0; i < N; i++) {
      const k = c + i;
      re[i] = k >= 0 && k < x.length ? x[k] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(bins);
    let s = 0;
    let sl = 0;
    for (let k = 1; k < maxBin; k++) {
      mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = mag[k] - prev[k];
      if (d > 0) {
        s += d;
        if (k < lowBin) sl += d;
      }
    }
    full[f] = s;
    low[f] = sl;
    prev = mag;
  }
  // remove the slow trend and scale
  const w = Math.round(FPS * 0.5);
  const det = new Float32Array(frames);
  let acc = 0;
  for (let i = 0; i < frames; i++) {
    acc += full[i];
    if (i >= w) acc -= full[i - w];
    det[i] = Math.max(0, full[i] - acc / Math.min(i + 1, w));
  }
  const sd = Math.sqrt(det.reduce((a, v) => a + v * v, 0) / Math.max(1, frames)) || 1;
  for (let i = 0; i < frames; i++) det[i] /= sd;
  return { env: det, low };
}

function tempo(env: Float32Array) {
  const minLag = Math.floor((60 / 200) * FPS);
  const maxLag = Math.ceil((60 / 55) * FPS);
  let best = 0;
  let bestLag = Math.round((60 / 120) * FPS);
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    s /= env.length - lag;
    const bpm = (60 * FPS) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    scores.push(s * prior);
    if (s * prior > best) {
      best = s * prior;
      bestLag = lag;
    }
  }
  // parabolic refinement of the peak
  const k = bestLag - minLag;
  let period = bestLag;
  if (k > 0 && k < scores.length - 1) {
    const [a, b, c] = [scores[k - 1], scores[k], scores[k + 1]];
    const den = a - 2 * b + c;
    if (den < 0) period = bestLag + (0.5 * (a - c)) / den;
  }
  const mean = scores.reduce((a, v) => a + v, 0) / scores.length || 1;
  return { period, confidence: best / mean };
}

function track(env: Float32Array, period: number) {
  const n = env.length;
  const score = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = -Infinity;
    let arg = -1;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const v = score[p] - 100 * Math.pow(Math.log((t - p) / period), 2);
      if (v > best) {
        best = v;
        arg = p;
      }
    }
    score[t] = env[t] + (arg >= 0 ? Math.max(0, best) : 0);
    back[t] = arg >= 0 && best > 0 ? arg : -1;
  }
  let t = n - 1;
  let m = -Infinity;
  for (let i = Math.max(0, n - Math.ceil(period)); i < n; i++)
    if (score[i] > m) {
      m = score[i];
      t = i;
    }
  const beats: number[] = [];
  while (t >= 0) {
    beats.push(t);
    t = back[t];
  }
  return beats.reverse();
}

const cache = new Map<string, BeatGrid>();

/** Beat grid of a music media item over source seconds [a, b] (default the whole file). */
export async function beatGrid(m: MediaItem, a = 0, b = m.duration || 0): Promise<BeatGrid> {
  const key = `${m.id}|${m.path}|${a.toFixed(2)}|${b.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const x = await decodeMono(m, a, b);
  if (x.length < SR * 4) throw new Error(`${m.name}: too short to find a beat (needs at least 4 s)`);
  const { env, low } = onsets(x);
  const { period, confidence } = tempo(env);
  const frames = track(env, period);
  const beats = frames.map((f) => Math.round((a + (f * HOP) / SR) * 1000) / 1000);
  const strength = (arr: Float32Array, f: number) => Math.max(arr[f] ?? 0, arr[f - 1] ?? 0, arr[f + 1] ?? 0);
  let phase = 0;
  let best = -1;
  for (let ph = 0; ph < 4; ph++) {
    let s = 0;
    for (let i = ph; i < frames.length; i += 4) s += strength(low, frames[i]) + 0.5 * strength(env, frames[i]);
    if (s > best) {
      best = s;
      phase = ph;
    }
  }
  const downIdx = frames.map((_, i) => i).filter((i) => i >= phase && (i - phase) % 4 === 0);
  let bar = 0;
  best = -1;
  for (let ph = 0; ph < 4; ph++) {
    let s = 0;
    for (let j = ph; j < downIdx.length; j += 4) s += strength(env, frames[downIdx[j]]);
    if (s > best) {
      best = s;
      bar = ph;
    }
  }
  const downbeats = downIdx.map((i) => beats[i]);
  const phrases = downbeats.filter((_, j) => j >= bar && (j - bar) % 4 === 0);
  const g: BeatGrid = { bpm: Math.round(((60 * FPS) / period) * 10) / 10, beats, downbeats, phrases, confidence: Math.round(confidence * 100) / 100 };
  cache.set(key, g);
  return g;
}
