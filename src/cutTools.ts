// Cutting tools beyond the razor: add edit on every track, split at markers, cut out silence (from the waveform
// data every engine produces, so it also works in the browser) and scene edit detection (needs the FFmpeg engine).
import type { Clip, Project } from './types';
import { S, commit, toast } from './store';
import { clipEnd, mediaOf, razor, rippleDeleteRange, splitWithLinks } from './ops';
import { snapFrame } from './time';
import { isBrowserEngine } from './webBridge';
import { NEEDS_HELPER } from './browserEngine';

/** Add Edit to All Tracks at the playhead, whatever is selected (Ctrl+Shift+K). */
export function addEditAllTracks() {
  const s = S();
  const t = snapFrame(s.playhead, s.project.settings.fps);
  try {
    commit('Add Edit to All Tracks', (d) => razor(d, t));
  } catch (e: any) {
    toast(e.message, 'error');
  }
}

/** Split every clip under a marker (or the selected clips only) at each marker. */
export function splitAtMarkers() {
  const s = S();
  const times = s.project.markers.map((m) => m.time).sort((a, b) => b - a);
  if (!times.length) return toast('There are no markers to split at', 'info');
  commit('Split at Markers', (d) => {
    for (const t of times) {
      const ids = d.clips.filter((c) => (!s.selection.length || s.selection.includes(c.id)) && c.start < t - 1e-6 && clipEnd(c) > t + 1e-6).map((c) => c.id);
      if (ids.length) splitWithLinks(d, ids, t);
    }
  });
}

export interface SilenceOptions {
  /** quieter than this counts as silence (dBFS) */
  thresholdDb: number;
  /** only cut silences at least this long (s) */
  minDuration: number;
  /** keep this much around speech (s) */
  padding: number;
  /** clip ids to analyse; empty = every audio clip on the timeline */
  clipIds?: string[];
}

/** Timeline ranges where every considered audio clip is quiet (from the media's 100-per-second peaks). */
export function findSilences(p: Project, o: SilenceOptions): { start: number; end: number }[] {
  const wanted = o.clipIds?.length ? new Set(o.clipIds) : null;
  const clips = p.clips.filter((c) => {
    if (!c.enabled || (wanted && !wanted.has(c.id))) return false;
    const m = mediaOf(p, c);
    if (!m?.hasAudio || !m.peaks?.length) return false;
    // a video clip counts only when it has no linked audio clip of its own on the timeline
    if (c.kind === 'video' && p.clips.some((x) => x.kind === 'audio' && x.linkId && x.linkId === c.linkId)) return false;
    return c.kind === 'audio' || c.kind === 'video';
  });
  if (!clips.length) return [];
  const level = Math.round(255 * Math.pow(10, o.thresholdDb / 40)); // peaks are 255·sqrt(|amplitude|)
  const loud: [number, number][] = [];
  let spanA = Infinity;
  let spanB = -Infinity;
  for (const c of clips) {
    const peaks = mediaOf(p, c)!.peaks!;
    spanA = Math.min(spanA, c.start);
    spanB = Math.max(spanB, clipEnd(c));
    const step = 0.01 / c.speed; // one peak per 10 ms of source
    let runStart: number | null = null;
    for (let t = c.start; t < clipEnd(c); t += step) {
      const src = c.in + (t - c.start) * c.speed;
      const v = peaks[Math.floor(src * 100)] ?? 0;
      if (v > level) {
        if (runStart == null) runStart = t;
      } else if (runStart != null) {
        loud.push([runStart, t]);
        runStart = null;
      }
    }
    if (runStart != null) loud.push([runStart, clipEnd(c)]);
  }
  // merge loud ranges (padded), then silences are the gaps between them inside the analysed span
  const padded = loud.map(([a, b]) => [Math.max(spanA, a - o.padding), Math.min(spanB, b + o.padding)] as [number, number]).sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of padded) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  const out: { start: number; end: number }[] = [];
  let cur = spanA;
  for (const [a, b] of merged) {
    if (a - cur >= o.minDuration) out.push({ start: cur, end: a });
    cur = Math.max(cur, b);
  }
  if (spanB - cur >= o.minDuration) out.push({ start: cur, end: spanB });
  const fps = p.settings.fps;
  return out.map((r) => ({ start: snapFrame(r.start, fps), end: snapFrame(r.end, fps) })).filter((r) => r.end - r.start > 1e-3);
}

/** Ripple-delete the silences on every track (keeps picture and sound in sync). One undo step. */
export function removeSilence(o: SilenceOptions) {
  const ranges = findSilences(S().project, o);
  if (!ranges.length) {
    toast('No silences found with those settings', 'info');
    return ranges;
  }
  commit(`Remove Silence (${ranges.length})`, (d) => {
    for (const r of [...ranges].sort((a, b) => b.start - a.start)) rippleDeleteRange(d, r.start, r.end);
  });
  const total = ranges.reduce((a, r) => a + r.end - r.start, 0);
  toast(`Removed ${ranges.length} silence${ranges.length === 1 ? '' : 's'} (${total.toFixed(1)} s)`, 'success', 5000);
  return ranges;
}

/** Scene Edit Detection: find shot changes inside the selected clips and cut there. */
export async function sceneEditDetection(threshold = 0.3) {
  const s = S();
  const clips = s.project.clips.filter((c) => s.selection.includes(c.id) && c.kind === 'video');
  if (!clips.length) return toast('Select one or more video clips first', 'info');
  if (isBrowserEngine()) return toast(NEEDS_HELPER, 'info', 7000);
  toast('Detecting scene changes…', 'info', 2000);
  const cuts: { clip: Clip; t: number }[] = [];
  for (const c of clips) {
    const r = await window.icut.engineTool('detect_scenes', { clip_id: c.id, threshold });
    const text = r?.content?.find((x: any) => x.type === 'text')?.text ?? '';
    if (r?.isError) return toast(text.replace(/^Error: /, ''), 'error', 7000);
    const found: { timeline_time?: number }[] = JSON.parse(text).cuts ?? [];
    for (const f of found) if (f.timeline_time != null && f.timeline_time > c.start + 0.05 && f.timeline_time < clipEnd(c) - 0.05) cuts.push({ clip: c, t: f.timeline_time });
  }
  if (!cuts.length) return toast('No scene changes found', 'info');
  const fps = S().project.settings.fps;
  commit(`Scene Edit Detection (${cuts.length})`, (d) => {
    for (const { clip, t } of cuts.sort((a, b) => b.t - a.t)) {
      const live = d.clips.find((x) => x.trackId === clip.trackId && x.start < t && clipEnd(x) > t);
      if (live) splitWithLinks(d, [live.id], snapFrame(t, fps));
    }
  });
  toast(`Cut at ${cuts.length} scene change${cuts.length === 1 ? '' : 's'}`, 'success');
}
