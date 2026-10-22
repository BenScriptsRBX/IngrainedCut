// Synchronize: line clips up with a reference clip by their audio (cross-correlation of loudness envelopes, FFT),
// or by their start or end. Linked clips move together; optionally the synced clips are linked into one group.
import type { Clip, Project } from './types';
import { S, commit, toast } from './store';
import { clearRegion, clipEnd, linkedGroup, mediaOf } from './ops';
import { mediaSrc } from './webBridge';

export type SyncMethod = 'audio' | 'start' | 'end';

const SR = 8000; // decode rate: plenty for loudness envelopes, small for long files
const RATE = 400; // envelope samples per second (2.5 ms resolution)

// ---------- FFT ----------
function fft(re: Float64Array, im: Float64Array, inverse = false) {
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
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) (re[i] /= n), (im[i] /= n);
}

/** Lag k (in envelope samples) maximising sum a[j+k]·b[j], with a confidence score. */
function bestLag(a: Float64Array, b: Float64Array) {
  let n = 1;
  while (n < a.length + b.length) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(a);
  br.set(b);
  fft(ar, ai);
  fft(br, bi);
  for (let i = 0; i < n; i++) {
    // a · conj(b)
    const r = ar[i] * br[i] + ai[i] * bi[i];
    const im = ai[i] * br[i] - ar[i] * bi[i];
    ar[i] = r;
    ai[i] = im;
  }
  fft(ar, ai, true);
  const minOverlap = Math.min(RATE, Math.floor(Math.min(a.length, b.length) / 2));
  let best = -Infinity;
  let bestK = 0;
  let sum = 0;
  let sum2 = 0;
  let count = 0;
  for (let k = -(b.length - 1); k <= a.length - 1; k++) {
    const overlap = Math.min(a.length, k + b.length) - Math.max(0, k);
    if (overlap < minOverlap) continue;
    const v = ar[k >= 0 ? k : n + k] / Math.sqrt(overlap); // normalise so short overlaps don't win by chance
    sum += v;
    sum2 += v * v;
    count++;
    if (v > best) (best = v), (bestK = k);
  }
  // sub-sample refinement
  const at = (k: number) => ar[k >= 0 ? k : n + k];
  const y0 = at(bestK - 1), y1 = at(bestK), y2 = at(bestK + 1);
  const den = y0 - 2 * y1 + y2;
  const frac = den ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : 0;
  const mean = sum / Math.max(1, count);
  const sd = Math.sqrt(Math.max(1e-12, sum2 / Math.max(1, count) - mean * mean));
  return { lag: bestK + frac, confidence: (best - mean) / sd };
}

// ---------- audio envelopes ----------
const decoded = new Map<string, Promise<Float32Array>>();
function decodeMono(url: string) {
  if (!decoded.has(url)) {
    decoded.set(
      url,
      (async () => {
        const buf = await (await fetch(url)).arrayBuffer();
        const ab = await new OfflineAudioContext(1, 1, SR).decodeAudioData(buf);
        const out = new Float32Array(ab.length);
        for (let ch = 0; ch < ab.numberOfChannels; ch++) {
          const d = ab.getChannelData(ch);
          for (let i = 0; i < d.length; i++) out[i] += d[i] / ab.numberOfChannels;
        }
        return out;
      })(),
    );
  }
  return decoded.get(url)!;
}

/**
 * Onset-style envelope of the part of the clip's audio that is on the timeline: log loudness with its slow trend
 * removed, so two recordings of the same moment match even with different mics and levels.
 */
async function envelope(p: Project, c: Clip): Promise<Float64Array> {
  const m = mediaOf(p, c)!;
  const pcm = await decodeMono(mediaSrc(m.audioUrl || m.url));
  const hop = SR / RATE;
  const i0 = Math.floor(c.in * SR);
  const n = Math.floor((c.duration * SR) / hop);
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const a = i0 + i * hop;
    for (let j = 0; j < hop; j++) s += Math.abs(pcm[a + j] ?? 0);
    env[i] = Math.log(1e-4 + s / hop);
  }
  const win = RATE; // 1 s moving average
  const out = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += env[i];
    if (i >= win) acc -= env[i - win];
    out[i] = env[i] - acc / Math.min(i + 1, win);
  }
  return out;
}

/** The clip in a linked group whose audio represents it (an audio clip if there is one). */
function audioClipOf(p: Project, group: Clip[]) {
  return group.find((c) => c.kind === 'audio' && mediaOf(p, c)?.hasAudio) ?? group.find((c) => mediaOf(p, c)?.hasAudio) ?? null;
}

export interface SyncResult {
  reference: string;
  moved: { clip: string; by: number; confidence?: number }[];
  skipped: { clip: string; reason: string }[];
}

/**
 * Sync the selected clips to a reference. The reference is `referenceId`'s group, or the selected group that sits on
 * the lowest track and starts first. Groups are linked clips, which move together.
 */
export async function syncClips(ids: string[], method: SyncMethod = 'audio', opts: { referenceId?: string; link?: boolean } = {}): Promise<SyncResult> {
  const p = S().project;
  const trackIndex = (c: Clip) => p.tracks.findIndex((t) => t.id === c.trackId);
  const groups: Clip[][] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const c = p.clips.find((x) => x.id === id);
    if (!c || seen.has(c.id)) continue;
    const g = linkedGroup(p, c);
    g.forEach((x) => seen.add(x.id));
    groups.push(g);
  }
  if (groups.length < 2) throw new Error('Select at least two clips (or linked groups) to synchronize');
  const refGroup =
    (opts.referenceId && groups.find((g) => g.some((c) => c.id === opts.referenceId))) ||
    [...groups].sort((a, b) => Math.min(...a.map(trackIndex)) - Math.min(...b.map(trackIndex)) || Math.min(...a.map((c) => c.start)) - Math.min(...b.map((c) => c.start)))[0];
  const anchor = (g: Clip[]) => g.reduce((a, c) => (c.start < a.start ? c : a));
  const result: SyncResult = { reference: anchor(refGroup).id, moved: [], skipped: [] };
  const deltas = new Map<Clip[], number>();

  if (method === 'audio') {
    const refAudio = audioClipOf(p, refGroup);
    if (!refAudio) throw new Error(`The reference clip ${anchor(refGroup).name} has no audio to sync by`);
    if (Math.abs(refAudio.speed - 1) > 1e-6) throw new Error('Audio sync needs the reference clip at normal speed');
    const a = await envelope(p, refAudio);
    for (const g of groups) {
      if (g === refGroup) continue;
      const ac = audioClipOf(p, g);
      if (!ac) {
        result.skipped.push({ clip: anchor(g).id, reason: 'no audio' });
        continue;
      }
      if (Math.abs(ac.speed - 1) > 1e-6) {
        result.skipped.push({ clip: ac.id, reason: 'speed is not 100%' });
        continue;
      }
      const b = await envelope(p, ac);
      const { lag, confidence } = bestLag(a, b);
      const newStart = refAudio.start + lag / RATE;
      deltas.set(g, newStart - ac.start);
      result.moved.push({ clip: ac.id, by: newStart - ac.start, confidence: Math.round(confidence * 10) / 10 });
      if (confidence < 4) result.skipped.push({ clip: ac.id, reason: `low confidence (${confidence.toFixed(1)}) — check the result` });
    }
  } else {
    const ref = method === 'start' ? Math.min(...refGroup.map((c) => c.start)) : Math.max(...refGroup.map(clipEnd));
    for (const g of groups) {
      if (g === refGroup) continue;
      const cur = method === 'start' ? Math.min(...g.map((c) => c.start)) : Math.max(...g.map(clipEnd));
      deltas.set(g, ref - cur);
      result.moved.push({ clip: anchor(g).id, by: ref - cur });
    }
  }

  // never push anything before 0: shift everyone involved right instead
  let lift = 0;
  for (const [g, dlt] of deltas) lift = Math.max(lift, ...g.map((c) => -(c.start + dlt)));
  const linkId = opts.link ? `L${Date.now().toString(36)}` : null;
  commit(opts.link ? 'Synchronize and Link' : 'Synchronize', (d) => {
    const moving = new Map<string, number>();
    for (const [g, dlt] of deltas) for (const c of g) moving.set(c.id, dlt + lift);
    if (lift > 0) for (const c of refGroup) moving.set(c.id, lift);
    const movedClips = d.clips.filter((c) => moving.has(c.id));
    d.clips = d.clips.filter((c) => !moving.has(c.id));
    for (const c of movedClips) {
      c.start = Math.max(0, c.start + moving.get(c.id)!);
      clearRegion(d, c.trackId, c.start, clipEnd(c));
    }
    d.clips.push(...movedClips);
    if (linkId) for (const c of d.clips) if (seen.has(c.id)) c.linkId = linkId;
  });
  return result;
}

/** Menu / shortcut entry point: sync the selection and report how it went. */
export async function synchronizeSelection(method: SyncMethod, link = false) {
  try {
    toast(method === 'audio' ? 'Synchronizing by audio…' : 'Synchronizing…', 'info', 1500);
    const r = await syncClips(S().selection, method, { link });
    const moved = r.moved.filter((m) => Math.abs(m.by) > 1e-4);
    const msg = moved.length
      ? `Synced ${r.moved.length} clip group${r.moved.length === 1 ? '' : 's'}: ${moved.map((m) => `${m.by >= 0 ? '+' : ''}${m.by.toFixed(3)}s`).join(', ')}`
      : 'Already in sync';
    toast(msg + (r.skipped.length ? ` · ${r.skipped.map((s) => s.reason).join('; ')}` : ''), r.skipped.length ? 'info' : 'success', 7000);
  } catch (e: any) {
    toast(e.message, 'error', 7000);
  }
}
