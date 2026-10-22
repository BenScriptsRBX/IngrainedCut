// Pure editing operations. Every function mutates the given (already cloned) project draft.
import type { Clip, ClipKind, Effects, Keyframe, KeyProp, MediaItem, Project, TextStyle, Track, Transform, Crop } from './types';
import { EPS } from './time';

export const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scale: 100, rotation: 0, opacity: 100 };
export const DEFAULT_FX: Effects = { brightness: 0, contrast: 0, saturation: 100, hue: 0, temperature: 0, tint: 0, blur: 0, grayscale: 0, sepia: 0, invert: 0, vignette: 0 };
export const DEFAULT_CROP: Crop = { left: 0, right: 0, top: 0, bottom: 0 };
export const DEFAULT_TEXT: TextStyle = {
  content: 'Title',
  font: 'Inter, Segoe UI, Arial, sans-serif',
  size: 96,
  color: '#ffffff',
  bold: true,
  italic: false,
  align: 'center',
  strokeColor: '#000000',
  strokeWidth: 0,
  backgroundColor: '#000000',
  backgroundOpacity: 0,
  shadow: true,
};

export function newProject(): Project {
  const tr = (id: string, kind: 'video' | 'audio'): Track => ({ id, kind, muted: false, solo: false, locked: false, hidden: false, volume: 0, height: kind === 'video' ? 52 : 48 });
  return {
    version: 1,
    name: 'Untitled Project',
    path: null,
    settings: { name: 'Sequence 01', width: 1920, height: 1080, fps: 30, sampleRate: 48000, background: '#000000' },
    media: [],
    tracks: [tr('v1', 'video'), tr('v2', 'video'), tr('v3', 'video'), tr('a1', 'audio'), tr('a2', 'audio'), tr('a3', 'audio')],
    clips: [],
    markers: [],
    inPoint: null,
    outPoint: null,
    nextId: 1,
  };
}

/** A new id; skips ids already taken (new projects start with fixed track ids v1…a3 while the counter starts at 1). */
export function nid(p: Project, prefix: string) {
  let id: string;
  do id = `${prefix}${p.nextId++}`;
  while (p.tracks.some((t) => t.id === id) || p.clips.some((c) => c.id === id) || p.markers.some((m) => m.id === id));
  return id;
}
export const clipEnd = (c: Clip) => c.start + c.duration;
export const isVisual = (c: Clip) => c.kind !== 'audio';

export function tracksOf(p: Project, kind: 'video' | 'audio') {
  return p.tracks.filter((t) => t.kind === kind);
}

export function trackLabel(p: Project, t: Track | string | undefined) {
  const tr = typeof t === 'string' ? p.tracks.find((x) => x.id === t) : t;
  if (!tr) return '?';
  return (tr.kind === 'video' ? 'V' : 'A') + (tracksOf(p, tr.kind).indexOf(tr) + 1);
}

export function findTrack(p: Project, ref: string | undefined | null): Track | undefined {
  if (!ref) return undefined;
  const r = ref.trim().toLowerCase();
  return p.tracks.find((t) => t.id.toLowerCase() === r) || p.tracks.find((t) => trackLabel(p, t).toLowerCase() === r);
}

export function getTrack(p: Project, ref: string): Track {
  const t = findTrack(p, ref);
  if (!t) throw new Error(`Track "${ref}" not found. Tracks: ${p.tracks.map((x) => trackLabel(p, x)).join(', ')}`);
  return t;
}

export function ensureTrack(p: Project, kind: 'video' | 'audio', index: number): Track {
  let list = tracksOf(p, kind);
  while (list.length <= index) {
    const t: Track = { id: nid(p, kind === 'video' ? 'v' : 'a'), kind, muted: false, solo: false, locked: false, hidden: false, volume: 0, height: kind === 'video' ? 52 : 48 };
    // keep video tracks grouped before audio tracks
    if (kind === 'video') {
      const lastV = p.tracks.map((x) => x.kind).lastIndexOf('video');
      p.tracks.splice(lastV + 1, 0, t);
    } else p.tracks.push(t);
    list = tracksOf(p, kind);
  }
  return list[index];
}

export function getClip(p: Project, id: string): Clip {
  const c = p.clips.find((x) => x.id === id);
  if (!c) throw new Error(`Clip "${id}" not found`);
  return c;
}

export function mediaOf(p: Project, c: Clip): MediaItem | undefined {
  return c.mediaId ? p.media.find((m) => m.id === c.mediaId) : undefined;
}

/** Source-time upper bound for a clip (media duration for time-based media). */
export function maxSrc(p: Project, c: Clip) {
  if (c.kind === 'video' || c.kind === 'audio') {
    const m = mediaOf(p, c);
    return m && m.duration > 0 ? m.duration : Infinity;
  }
  return Infinity;
}

export function sequenceDuration(p: Project) {
  let d = 0;
  for (const c of p.clips) d = Math.max(d, clipEnd(c));
  return d;
}

export function clipsOnTrack(p: Project, trackId: string) {
  return p.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
}

export function assertUnlocked(p: Project, trackId: string) {
  const t = p.tracks.find((x) => x.id === trackId);
  if (t?.locked) throw new Error(`Track ${trackLabel(p, t)} is locked`);
}

export function makeClip(p: Project, o: Partial<Clip> & { kind: ClipKind; trackId: string; start: number; duration: number }): Clip {
  return {
    id: nid(p, 'c'),
    name: o.name ?? o.kind,
    in: 0,
    speed: 1,
    enabled: true,
    linkId: null,
    transform: { ...DEFAULT_TRANSFORM },
    fx: { ...DEFAULT_FX },
    crop: { ...DEFAULT_CROP },
    blend: 'normal',
    volume: 0,
    pan: 0,
    fadeIn: 0,
    fadeOut: 0,
    transitionIn: null,
    transitionOut: null,
    ...o,
  } as Clip;
}

export function cloneClip(p: Project, c: Clip): Clip {
  const n = structuredClone(c);
  n.id = nid(p, 'c');
  return n;
}

export function shiftKeyframes(c: Clip, dt: number) {
  if (!c.keyframes) return;
  for (const k of Object.keys(c.keyframes) as KeyProp[]) {
    const list = c.keyframes[k];
    if (list) c.keyframes[k] = list.map((f) => ({ ...f, t: f.t + dt }));
  }
}

/** Move the left edge to newStart keeping content anchored. */
export function trimStart(p: Project, c: Clip, newStart: number) {
  const end = clipEnd(c);
  let ns = Math.min(newStart, end - 1 / p.settings.fps);
  let newIn = c.in + (ns - c.start) * c.speed;
  if (newIn < 0) {
    ns -= newIn / c.speed;
    newIn = 0;
  }
  shiftKeyframes(c, c.start - ns);
  c.in = newIn;
  c.duration = end - ns;
  c.start = ns;
}

/** Move the right edge to newEnd. */
export function trimEnd(p: Project, c: Clip, newEnd: number) {
  let ne = Math.max(newEnd, c.start + 1 / p.settings.fps);
  const maxEnd = c.start + (maxSrc(p, c) - c.in) / c.speed;
  ne = Math.min(ne, maxEnd);
  c.duration = ne - c.start;
}

/** Split c at t, returns the new right-hand clip (or null if t is outside). */
export function splitClip(p: Project, c: Clip, t: number): Clip | null {
  if (t <= c.start + EPS || t >= clipEnd(c) - EPS) return null;
  const right = cloneClip(p, c);
  const leftDur = t - c.start;
  right.start = t;
  right.duration = c.duration - leftDur;
  right.in = c.in + leftDur * c.speed;
  right.transitionIn = null;
  right.fadeIn = 0;
  shiftKeyframes(right, -leftDur);
  c.duration = leftDur;
  c.transitionOut = null;
  c.fadeOut = 0;
  p.clips.push(right);
  return right;
}

/** Remove material in [start,end) on a track (overwrite semantics). */
export function clearRegion(p: Project, trackId: string, start: number, end: number, exclude: Set<string> = new Set()) {
  if (end - start <= EPS) return;
  for (const c of [...p.clips]) {
    if (c.trackId !== trackId || exclude.has(c.id)) continue;
    const ce = clipEnd(c);
    if (ce <= start + EPS || c.start >= end - EPS) continue;
    if (c.start >= start - EPS && ce <= end + EPS) {
      p.clips = p.clips.filter((x) => x.id !== c.id);
    } else if (c.start < start && ce > end) {
      const right = splitClip(p, c, end)!;
      right.linkId = null;
      c.duration = start - c.start;
    } else if (c.start < start) {
      c.duration = start - c.start;
      c.transitionOut = null;
    } else {
      trimStart(p, c, end);
      c.transitionIn = null;
    }
  }
}

export function shiftClips(p: Project, trackIds: string[], from: number, delta: number, exclude: Set<string> = new Set()) {
  const set = new Set(trackIds);
  for (const c of p.clips) {
    if (set.has(c.trackId) && !exclude.has(c.id) && c.start >= from - EPS) c.start = Math.max(0, c.start + delta);
  }
  for (const m of p.markers) if (trackIds.length === p.tracks.length && m.time >= from - EPS) m.time = Math.max(0, m.time + delta);
}

export function linkedGroup(p: Project, c: Clip): Clip[] {
  if (!c.linkId) return [c];
  return p.clips.filter((x) => x.linkId === c.linkId);
}

export function expandLinked(p: Project, ids: string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const c = p.clips.find((x) => x.id === id);
    if (!c) continue;
    for (const g of linkedGroup(p, c)) out.add(g.id);
  }
  return [...out];
}

/** Split clips (and their linked partners) at t. Returns ids of the new right-hand clips. */
export function splitWithLinks(p: Project, ids: string[], t: number): string[] {
  const done = new Set<string>();
  const created: string[] = [];
  const newLink = new Map<string, string>();
  for (const id of expandLinked(p, ids)) {
    if (done.has(id)) continue;
    done.add(id);
    const c = p.clips.find((x) => x.id === id);
    if (!c) continue;
    assertUnlocked(p, c.trackId);
    const r = splitClip(p, c, t);
    if (!r) continue;
    if (c.linkId) {
      if (!newLink.has(c.linkId)) newLink.set(c.linkId, nid(p, 'L'));
      r.linkId = newLink.get(c.linkId)!;
    }
    created.push(r.id);
  }
  return created;
}

export function razor(p: Project, t: number, trackIds?: string[]): string[] {
  const tracks = (trackIds ?? p.tracks.map((x) => x.id)).filter((id) => !p.tracks.find((x) => x.id === id)?.locked);
  const set = new Set(tracks);
  const created: string[] = [];
  for (const c of [...p.clips]) {
    if (!set.has(c.trackId)) continue;
    const r = splitClip(p, c, t);
    if (r) {
      if (c.linkId) r.linkId = c.linkId + '_' + Math.round(t * 1000);
      created.push(r.id);
    }
  }
  return created;
}

export function deleteClips(p: Project, ids: string[], ripple = false) {
  const victims = p.clips.filter((c) => ids.includes(c.id));
  for (const v of victims) assertUnlocked(p, v.trackId);
  p.clips = p.clips.filter((c) => !ids.includes(c.id));
  if (!ripple) return;
  // merge the deleted time ranges, then close each gap on every unlocked track that is empty there
  // (sync-lock behaviour: linked clips on other tracks stay in sync)
  const ranges = victims.map((v) => ({ start: v.start, end: clipEnd(v) })).sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + EPS) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  for (const r of merged.reverse()) {
    const free = p.tracks.filter((t) => !t.locked && !p.clips.some((c) => c.trackId === t.id && c.start < r.end - EPS && clipEnd(c) > r.start + EPS));
    shiftClips(p, free.map((t) => t.id), r.end - EPS, -(r.end - r.start));
  }
}

export function rippleDeleteRange(p: Project, start: number, end: number, trackIds?: string[]) {
  if (end <= start) throw new Error('end must be after start');
  const tracks = (trackIds ?? p.tracks.map((t) => t.id)).filter((id) => !p.tracks.find((x) => x.id === id)?.locked);
  for (const tid of tracks) clearRegion(p, tid, start, end);
  const all = tracks.length === p.tracks.length;
  const set = new Set(tracks);
  for (const c of p.clips) if (set.has(c.trackId) && c.start >= end - EPS) c.start -= end - start;
  if (all) {
    p.markers = p.markers.filter((m) => m.time < start || m.time >= end);
    for (const m of p.markers) if (m.time >= end) m.time -= end - start;
  }
}

export function closeGaps(p: Project, trackIds?: string[]) {
  const tracks = trackIds ?? p.tracks.filter((t) => !t.locked).map((t) => t.id);
  for (const tid of tracks) {
    let cursor = 0;
    for (const c of clipsOnTrack(p, tid)) {
      if (c.start > cursor + EPS) c.start = cursor;
      cursor = clipEnd(c);
    }
  }
}

/** Open a gap of dur at time `at` on the tracks (splitting clips that span it). */
export function insertSpace(p: Project, trackIds: string[], at: number, dur: number) {
  for (const tid of trackIds) {
    for (const c of [...p.clips]) if (c.trackId === tid) splitClip(p, c, at);
  }
  shiftClips(p, trackIds, at, dur);
}

export interface PlaceOptions {
  videoTrackId?: string;
  audioTrackId?: string;
  start: number;
  srcIn?: number;
  srcOut?: number;
  duration?: number;
  includeAudio?: boolean;
  includeVideo?: boolean;
  mode?: 'overwrite' | 'insert';
}

export function placeMedia(p: Project, m: MediaItem, o: PlaceOptions): Clip[] {
  const fps = p.settings.fps;
  const srcIn = Math.max(0, o.srcIn ?? 0);
  let dur: number;
  if (m.type === 'image') dur = o.duration ?? 5;
  else {
    const srcOut = Math.min(o.srcOut ?? m.duration, m.duration || Infinity);
    dur = o.duration ?? srcOut - srcIn;
    dur = Math.min(dur, (m.duration || Infinity) - srcIn);
  }
  dur = Math.max(1 / fps, dur);
  const start = Math.max(0, o.start);
  const wantVideo = m.type !== 'audio' && (o.includeVideo ?? true) && (m.hasVideo || m.type === 'image');
  const wantAudio = m.hasAudio && (o.includeAudio ?? true);
  const vt = wantVideo ? (o.videoTrackId ? p.tracks.find((t) => t.id === o.videoTrackId)! : tracksOf(p, 'video')[0]) : null;
  let at: Track | null = null;
  if (wantAudio) {
    if (o.audioTrackId) at = p.tracks.find((t) => t.id === o.audioTrackId)!;
    else if (vt) at = ensureTrack(p, 'audio', tracksOf(p, 'video').indexOf(vt));
    else at = tracksOf(p, 'audio')[0] ?? ensureTrack(p, 'audio', 0);
  }
  const used = [vt, at].filter(Boolean) as Track[];
  for (const t of used) assertUnlocked(p, t.id);
  if (o.mode === 'insert') insertSpace(p, used.map((t) => t.id), start, dur);
  else for (const t of used) clearRegion(p, t.id, start, start + dur);
  const linkId = vt && at ? nid(p, 'L') : null;
  const out: Clip[] = [];
  if (vt) {
    const c = makeClip(p, { kind: m.type === 'image' ? 'image' : 'video', trackId: vt.id, start, duration: dur, in: m.type === 'image' ? 0 : srcIn, mediaId: m.id, name: m.name, linkId });
    p.clips.push(c);
    out.push(c);
  }
  if (at) {
    const c = makeClip(p, { kind: 'audio', trackId: at.id, start, duration: dur, in: srcIn, mediaId: m.id, name: m.name, linkId });
    p.clips.push(c);
    out.push(c);
  }
  return out;
}

export function trackEnd(p: Project, trackId: string) {
  let e = 0;
  for (const c of p.clips) if (c.trackId === trackId) e = Math.max(e, clipEnd(c));
  return e;
}

export function evalKey(list: Keyframe[] | undefined, local: number, base: number) {
  if (!list || !list.length) return base;
  if (local <= list[0].t) return list[0].v;
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i];
    const b = list[i + 1];
    if (local < b.t) {
      if (a.ease === 'hold') return a.v;
      let u = (local - a.t) / Math.max(1e-6, b.t - a.t);
      if (a.ease === 'ease') u = u * u * (3 - 2 * u);
      return a.v + (b.v - a.v) * u;
    }
  }
  return list[list.length - 1].v;
}

export function propAt(c: Clip, prop: KeyProp, local: number): number {
  const base = prop === 'volume' ? c.volume : c.transform[prop as keyof Transform];
  return evalKey(c.keyframes?.[prop], local, base);
}

/** 0..1 multiplier from fade in/out at clip-local time. */
export function fadeFactor(c: Clip, local: number) {
  let f = 1;
  if (c.fadeIn > 0 && local < c.fadeIn) f *= Math.max(0, local / c.fadeIn);
  if (c.fadeOut > 0 && local > c.duration - c.fadeOut) f *= Math.max(0, (c.duration - local) / c.fadeOut);
  return f;
}

/** Set/replace a keyframe at local time on a clip property. */
export function upsertKeyframe(c: Clip, prop: KeyProp, local: number, v: number) {
  c.keyframes = c.keyframes || {};
  const list = [...(c.keyframes[prop] || [])].filter((k) => Math.abs(k.t - local) > 1e-3);
  list.push({ t: local, v, ease: 'linear' });
  list.sort((a, b) => a.t - b.t);
  c.keyframes[prop] = list;
}

export function snapshotForHistory(p: Project): Project {
  return structuredClone(p);
}

/** Find clip at time on a track. */
export function clipAt(p: Project, trackId: string, t: number) {
  return p.clips.find((c) => c.trackId === trackId && c.start <= t + EPS && clipEnd(c) > t + EPS);
}

export function prevAdjacent(p: Project, c: Clip, fps: number) {
  return p.clips.find((x) => x.trackId === c.trackId && x.id !== c.id && Math.abs(clipEnd(x) - c.start) < 0.5 / fps);
}
export function nextAdjacent(p: Project, c: Clip, fps: number) {
  return p.clips.find((x) => x.trackId === c.trackId && x.id !== c.id && Math.abs(x.start - clipEnd(c)) < 0.5 / fps);
}

export function editPoints(p: Project) {
  const s = new Set<number>([0]);
  for (const c of p.clips) {
    s.add(Math.round(c.start * 1000) / 1000);
    s.add(Math.round(clipEnd(c) * 1000) / 1000);
  }
  return [...s].sort((a, b) => a - b);
}

/** Change playback speed of a clip and its linked partners, keeping the source range and rippling trailing clips. */
/**
 * Change a clip's speed (and its linked partners'). ripple = true shifts every later clip on those tracks by the
 * change in length; ripple = false leaves them where they are, like Premiere with "Ripple Edit" unticked: a slower
 * clip may only grow into the empty space before the next clip (the end of its source is cut), a faster one leaves a gap.
 */
export function setClipSpeed(p: Project, id: string, speed: number, ripple = true) {
  const sp = Math.max(0.05, Math.min(20, speed));
  const c = getClip(p, id);
  const group = linkedGroup(p, c);
  let room = Infinity;
  if (!ripple)
    for (const g of group) {
      const next = clipsOnTrack(p, g.trackId).find((x) => x.id !== g.id && x.start >= clipEnd(g) - EPS);
      if (next) room = Math.min(room, next.start - g.start);
    }
  for (const g of group) {
    const oldEnd = clipEnd(g);
    const span = g.duration * g.speed;
    g.speed = sp;
    g.duration = Math.min(span / sp, room);
    if (ripple) shiftClips(p, [g.trackId], oldEnd - 1e-6, clipEnd(g) - oldEnd, new Set([g.id]));
  }
}
