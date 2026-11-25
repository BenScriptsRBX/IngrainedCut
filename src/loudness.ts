// Loudness of the timeline mix, measured in the editor (ITU-R BS.1770-4 / EBU R128): integrated and short-term
// LUFS, true peak (4x oversampled by the browser's resampler), 50 ms levels for silence detection, and the
// normalisation export applies (gain to a target, then a true-peak limiter), like ffmpeg's two-pass loudnorm.
import type { Project } from './types';

class Biquad {
  private s: Float64Array;
  constructor(private b: number[], private a: number[], ch: number) {
    this.s = new Float64Array(ch * 2);
  }
  run(x: Float32Array, out: Float32Array, ch: number) {
    const [b0, b1, b2] = this.b;
    const [a1, a2] = this.a;
    let z1 = this.s[ch * 2];
    let z2 = this.s[ch * 2 + 1];
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const y = b0 * v + z1;
      z1 = b1 * v - a1 * y + z2;
      z2 = b2 * v - a2 * y;
      out[i] = y;
    }
    this.s[ch * 2] = z1;
    this.s[ch * 2 + 1] = z2;
  }
}

/** The two K-weighting stages for any sample rate (libebur128's formulas). */
function kWeighting(fs: number, ch: number) {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = new Biquad([(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0], ch);
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const hp = new Biquad([1, -2, 1], [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0], ch);
  return [shelf, hp];
}

const lufs = (meanSquare: number) => (meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : -Infinity);
const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const r1 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

/** Streaming BS.1770 meter: feed buffers in order. */
export class LoudnessMeter {
  private filters: Biquad[];
  private step: number;
  private acc = 0;
  private accN = 0;
  /** K-weighted energy (sum over channels of mean square) per 100 ms step */
  steps: number[] = [];
  /** unweighted max-channel RMS per 50 ms, dBFS */
  rms50: number[] = [];
  private rAcc = [0, 0];
  private rN = 0;
  private r50: number;
  samplePeak = 0;
  truePeak = 0;
  private tmp = new Float32Array(0);
  constructor(public sampleRate: number, public channels: number) {
    this.filters = kWeighting(sampleRate, channels);
    this.step = Math.round(sampleRate / 10);
    this.r50 = Math.round(sampleRate / 20);
  }
  async push(buf: AudioBuffer, truePeak = true) {
    const n = buf.length;
    const ch = Math.min(this.channels, buf.numberOfChannels);
    if (this.tmp.length < n) this.tmp = new Float32Array(n);
    const weighted: Float32Array[] = [];
    for (let c = 0; c < ch; c++) {
      const x = buf.getChannelData(c);
      const y = new Float32Array(n);
      this.filters[0].run(x, this.tmp, c);
      this.filters[1].run(this.tmp.subarray(0, n), y, c);
      weighted.push(y);
    }
    const raw = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
    for (let i = 0; i < n; i++) {
      let e = 0;
      for (let c = 0; c < ch; c++) {
        const w = weighted[c][i];
        e += w * w;
        const v = raw[c][i];
        this.rAcc[c] += v * v;
        const a = v < 0 ? -v : v;
        if (a > this.samplePeak) this.samplePeak = a;
      }
      this.acc += e;
      if (++this.accN === this.step) {
        this.steps.push(this.acc / this.step);
        this.acc = 0;
        this.accN = 0;
      }
      if (++this.rN === this.r50) {
        let m = 0;
        for (let c = 0; c < ch; c++) m = Math.max(m, this.rAcc[c] / this.r50);
        this.rms50.push(m > 0 ? 10 * Math.log10(m) : -120);
        this.rAcc = [0, 0];
        this.rN = 0;
      }
    }
    if (truePeak) this.truePeak = Math.max(this.truePeak, await oversampledPeak(buf));
  }
  /** 400 ms blocks every 100 ms */
  private blocks() {
    const out: number[] = [];
    for (let i = 3; i < this.steps.length; i++) out.push((this.steps[i] + this.steps[i - 1] + this.steps[i - 2] + this.steps[i - 3]) / 4);
    return out;
  }
  integrated() {
    const bl = this.blocks().filter((e) => lufs(e) > -70);
    if (!bl.length) return -Infinity;
    const rel = lufs(bl.reduce((a, b) => a + b, 0) / bl.length) - 10;
    const g = bl.filter((e) => lufs(e) > rel);
    return g.length ? lufs(g.reduce((a, b) => a + b, 0) / g.length) : -Infinity;
  }
  /** short-term loudness (3 s window) ending at each whole second */
  shortTerm() {
    const out: (number | null)[] = [];
    for (let s = 10; s <= this.steps.length; s += 10) {
      const a = Math.max(0, s - 30);
      let e = 0;
      for (let i = a; i < s; i++) e += this.steps[i];
      out.push(r1(lufs(e / (s - a))));
    }
    return out;
  }
  /** loudness range (EBU Tech 3342) */
  range() {
    const st: number[] = [];
    for (let s = 30; s <= this.steps.length; s++) {
      let e = 0;
      for (let i = s - 30; i < s; i++) e += this.steps[i];
      st.push(e / 30);
    }
    const abs = st.filter((e) => lufs(e) > -70);
    if (abs.length < 2) return 0;
    const rel = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 20;
    const v = abs.map(lufs).filter((l) => l > rel).sort((a, b) => a - b);
    if (v.length < 2) return 0;
    return v[Math.floor(0.95 * (v.length - 1))] - v[Math.floor(0.1 * (v.length - 1))];
  }
  momentaryMax() {
    return Math.max(-Infinity, ...this.blocks().map(lufs));
  }
  summary() {
    return {
      integrated_lufs: r1(this.integrated()),
      true_peak_dbtp: r1(db(this.truePeak)),
      sample_peak_dbfs: r1(db(this.samplePeak)),
      loudness_range_lu: r1(this.range()),
      momentary_max_lufs: r1(this.momentaryMax()),
    };
  }
}

/** Peak of the signal upsampled 4x (BS.1770 true peak), in chunks so long mixes stay small. */
export async function oversampledPeak(buf: AudioBuffer) {
  const CH = 20 * buf.sampleRate;
  let peak = 0;
  for (let off = 0; off < buf.length; off += CH) {
    const n = Math.min(CH, buf.length - off);
    const part = new AudioBuffer({ length: n, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
    for (let c = 0; c < buf.numberOfChannels; c++) part.copyToChannel(buf.getChannelData(c).subarray(off, off + n), c);
    const ctx = new OfflineAudioContext(buf.numberOfChannels, n * 4, buf.sampleRate * 4);
    const s = ctx.createBufferSource();
    s.buffer = part;
    s.connect(ctx.destination);
    s.start();
    const up = await ctx.startRendering();
    for (let c = 0; c < up.numberOfChannels; c++) {
      const d = up.getChannelData(c);
      for (let i = 0; i < d.length; i++) {
        const a = d[i] < 0 ? -d[i] : d[i];
        if (a > peak) peak = a;
      }
    }
  }
  return peak;
}

export async function measureBuffer(buf: AudioBuffer) {
  const m = new LoudnessMeter(buf.sampleRate, buf.numberOfChannels);
  await m.push(buf);
  return m;
}

/**
 * Measure the timeline mix over [a, b] in chunks (the mix of a long documentary does not fit in memory at once).
 * `render(a, b)` mixes a stretch of the timeline.
 */
export async function measureTimeline(p: Project, a: number, b: number, render: (p: Project, a: number, b: number, sr: number) => Promise<AudioBuffer>, opts: { truePeak?: boolean } = {}) {
  const sr = 48000;
  const meter = new LoudnessMeter(sr, 2);
  const CH = 60;
  for (let t = a; t < b - 1e-6; t += CH) {
    const buf = await render(p, t, Math.min(b, t + CH), sr);
    await meter.push(buf, opts.truePeak !== false);
  }
  return meter;
}

/**
 * Normalise a finished mix in place: gain to `targetLufs`, then a look-ahead limiter keeps true peaks under
 * `truePeak` dBTP. Returns what was done and the loudness after.
 */
export async function normalizeBuffer(buf: AudioBuffer, targetLufs: number, truePeak: number) {
  const before = await measureBuffer(buf);
  if (!Number.isFinite(before.integrated())) return { applied_gain_db: 0, limited: false, before: before.summary(), after: before.summary() };
  const ch = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const tpLin = Math.pow(10, truePeak / 20);
  let cur = before;
  let total = 0;
  let limited = false;
  // gain, limit, measure again: limiting peaky material lowers its loudness, so repeat until it lands on the target
  for (let pass = 0; pass < 6; pass++) {
    const gainDb = targetLufs - cur.integrated();
    if (Math.abs(gainDb) < 0.15 && cur.truePeak <= tpLin + 1e-6) break;
    const g = Math.pow(10, gainDb / 20);
    for (const d of ch) for (let i = 0; i < d.length; i++) d[i] *= g;
    total += gainDb;
    let ceiling = Math.pow(10, (truePeak - 0.3) / 20); // sample-peak ceiling, a little under the true-peak target
    for (let k = 0; k < 4; k++) {
      if ((await oversampledPeak(buf)) <= tpLin + 1e-6) break;
      limited = true;
      limit(buf, ceiling);
      ceiling *= Math.pow(10, -0.3 / 20);
    }
    cur = await measureBuffer(buf);
  }
  return { applied_gain_db: Math.round(total * 100) / 100, limited, before: before.summary(), after: cur.summary() };
}

/** Look-ahead peak limiter on 1 ms blocks: gain drops ahead of a peak and recovers over ~80 ms. */
function limit(buf: AudioBuffer, ceiling: number) {
  const sr = buf.sampleRate;
  const B = Math.max(1, Math.round(sr / 1000));
  const nb = Math.ceil(buf.length / B);
  const ch = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const need = new Float32Array(nb).fill(1);
  for (let k = 0; k < nb; k++) {
    let p = 0;
    for (const d of ch) for (let i = k * B; i < Math.min(buf.length, (k + 1) * B); i++) p = Math.max(p, Math.abs(d[i]));
    if (p > ceiling) need[k] = ceiling / p;
  }
  const L = 5; // ms of look-ahead on each side
  const m = new Float32Array(nb);
  for (let k = 0; k < nb; k++) {
    let v = 1;
    for (let j = Math.max(0, k - L); j <= Math.min(nb - 1, k + L); j++) v = Math.min(v, need[j]);
    m[k] = v;
  }
  const env = new Float32Array(nb);
  const rel = 1 - Math.exp(-1 / 80);
  let prev = 1;
  for (let k = 0; k < nb; k++) {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, k - L); j <= Math.min(nb - 1, k + L); j++) {
      s += m[j];
      n++;
    }
    const target = s / n;
    prev = Math.min(target, prev + (1 - prev) * rel);
    env[k] = prev;
  }
  for (let k = 0; k < nb; k++) {
    const g0 = env[k];
    const g1 = env[Math.min(nb - 1, k + 1)];
    for (let i = k * B, j = 0; i < Math.min(buf.length, (k + 1) * B); i++, j++) {
      const g = g0 + ((g1 - g0) * j) / B;
      for (const d of ch) d[i] *= g;
    }
  }
}
