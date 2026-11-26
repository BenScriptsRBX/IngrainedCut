// Documentary-editing tools (renderer side): build a timeline from an EDL / cue sheet, the doc track layout, slow
// motion moves, J/L cuts, text card presets, floating panels, ducking and "breaths", beat grids, and the timeline
// loudness / silence analysis the QA report uses. The main process reads the files (electron/docTools.mjs) and
// passes their text in as `_text` / `_style`. Reading the plan files themselves is in docPlan.ts.
import type { Clip, Keyframe, MediaItem, Project, TextStyle, Track, TransitionType } from './types';
import {
  DEFAULT_TEXT, DEFAULT_TRANSFORM, DEFAULT_FX, assertUnlocked, clearRegion, clipEnd, ensureTrack, evalKey, findTrack, getClip, getTrack, linkedGroup,
  makeClip, mediaOf, nid, placeMedia, rippleDeleteRange, sequenceDuration, trackLabel, tracksOf, trimEnd, trimStart,
} from './ops';
import { measureText } from './compositor';
import { renderMix } from './exporter';
import { measureTimeline, type LoudnessMeter } from './loudness';
import { beatGrid } from './beats';
import { stripForFile } from './store';
import {
  AUDIO_EXT, CARD_KINDS, CARD_PRESETS, IMAGE_EXT, MEDIA_EXT, VISUAL, cardOf, cardText, inferCard, isAbs, isUrl, joinPath, matchTitle, num, parseMotion, parseStyle,
  parseTransition, type CardPreset, type CueRow, type DocStyle, type EdlRow, type Motion,
} from './docPlan';

export * from './docPlan';

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const EPS = 1e-6;

// ---------------- sources ----------------

const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
const base = (p: string) => norm(p).split('/').pop()!;

/** A bin item by id, name, path, or the file name of a path. */
export function findMedia(p: Project, src: string, baseDir?: string): MediaItem | undefined {
  const s = src.trim();
  if (!s) return undefined;
  const byId = p.media.find((m) => m.id === s);
  if (byId) return byId;
  const full = baseDir ? joinPath(baseDir, s) : s;
  return (
    p.media.find((m) => norm(m.path) === norm(full)) ||
    p.media.find((m) => norm(m.path) === norm(s)) ||
    p.media.find((m) => m.name.toLowerCase() === s.toLowerCase()) ||
    (MEDIA_EXT.test(s) ? p.media.find((m) => base(m.path) === base(s)) : undefined)
  );
}

/** Paths among `srcs` that point at files not in the bin yet (absolute, resolved against baseDir). */
export function missingFiles(p: Project, srcs: string[], baseDir?: string) {
  const out = new Set<string>();
  for (const s of srcs) {
    if (!s || !MEDIA_EXT.test(s.trim())) continue;
    if (findMedia(p, s, baseDir)) continue;
    const full = baseDir ? joinPath(baseDir, s.trim()) : s.trim();
    if (isAbs(full)) out.add(full);
  }
  return [...out];
}

/** Stand-in bin items for a dry run (nothing is imported). */
export function fakeMedia(d: Project, paths: string[]) {
  for (const path of paths) {
    const image = IMAGE_EXT.test(path);
    const audio = /\.(wav|mp3|m4a|aac|flac|ogg|opus)$/i.test(path);
    d.media.push({
      id: nid(d, 'm'), name: path.split(/[\\/]/).pop()!, path, url: '', type: image ? 'image' : audio ? 'audio' : 'video', duration: image ? 0 : 3600,
      width: d.settings.width, height: d.settings.height, fps: d.settings.fps, hasVideo: !audio, hasAudio: !image, status: 'loading',
    });
  }
}

// ---------------- tracks: the documentary layout ----------------

/** The skill's layout (section 3 of fraggedin-documentary-editor): footage V1 with its sound on A1, panels V2, the
 * blur / darken layers behind cards V3, cards V4; overlay sound A2, narration A3, music A4, SFX and ambience A5. */
export const DOC_TRACKS = {
  video: ['Footage', 'Panels', 'Adjustments', 'Cards'],
  audio: ['Clip audio', 'Overlay audio', 'Narration', 'Music', 'SFX / Ambience'],
} as const;

const ROLE_TRACK: Record<string, ['video' | 'audio', number, string]> = {
  footage: ['video', 0, 'Footage'],
  overlay: ['video', 1, 'Panels'],
  adjust: ['video', 2, 'Adjustments'],
  text: ['video', 3, 'Cards'],
  clip_audio: ['audio', 0, 'Clip audio'],
  overlay_audio: ['audio', 1, 'Overlay audio'],
  narration: ['audio', 2, 'Narration'],
  music: ['audio', 3, 'Music'],
  sfx: ['audio', 4, 'SFX / Ambience'],
  ambience: ['audio', 4, 'SFX / Ambience'],
};
/** The 0.2.33 layout, kept by projects that were set up with it. */
const OLD_ROLE_TRACK: Record<string, string> = { overlay: 'Overlays', text: 'Text', narration: 'Narration', clip_audio: 'Clip audio', music: 'Music', sfx: 'SFX / Ambience', ambience: 'SFX / Ambience' };
const oldLayout = (d: Project) => tracksOf(d, 'audio')[0]?.name === 'Narration';

export function applyTemplate(d: Project) {
  const out: Record<string, string> = {};
  if (oldLayout(d)) {
    for (const t of d.tracks) if (t.name) out[trackLabel(d, t)] = t.name;
    return out;
  }
  (['video', 'audio'] as const).forEach((kind) =>
    DOC_TRACKS[kind].forEach((name, i) => {
      const t = ensureTrack(d, kind, i);
      t.name = name;
      out[trackLabel(d, t)] = name;
    }),
  );
  return out;
}

/** The track for a role: by its template name, else by its template position. */
export function roleTrack(d: Project, role: keyof typeof ROLE_TRACK): Track {
  const [kind, idx, name] = ROLE_TRACK[role];
  if (role === 'ambience') {
    const amb = d.tracks.find((t) => t.kind === 'audio' && /^ambience/i.test(t.name ?? ''));
    if (amb) return amb;
  }
  const old = OLD_ROLE_TRACK[role];
  return d.tracks.find((t) => t.kind === kind && t.name === name) ?? (old ? d.tracks.find((t) => t.kind === kind && t.name === old) : undefined) ?? ensureTrack(d, kind, idx);
}

const busy = (d: Project, tid: string, a: number, b: number, exclude?: Set<string>) =>
  d.clips.some((c) => c.trackId === tid && !exclude?.has(c.id) && c.start < b - EPS && clipEnd(c) > a + EPS);

/** First video track at or above index `from` that is free over [a, b) (a new one on top if none is). */
function freeVideoFrom(d: Project, from: number, a: number, b: number, name?: string) {
  const vids = tracksOf(d, 'video');
  for (let i = from; i < vids.length; i++) if (!vids[i].locked && !busy(d, vids[i].id, a, b)) return vids[i];
  const t = ensureTrack(d, 'video', Math.max(from, vids.length));
  if (name && !t.name) t.name = name;
  return t;
}

/** The track `t` if free over [a, b), else another audio track named like it ("Music 2"…), created if needed. */
function freeAudioLike(d: Project, t: Track, a: number, b: number) {
  if (!busy(d, t.id, a, b)) return t;
  const stem = (t.name || trackLabel(d, t)).replace(/\s+\d+$/, '');
  const like = d.tracks.filter((x) => x.kind === 'audio' && x.id !== t.id && (x.name ?? '').replace(/\s+\d+$/, '') === stem);
  for (const x of like) if (!x.locked && !busy(d, x.id, a, b)) return x;
  const n = ensureTrack(d, 'audio', tracksOf(d, 'audio').length);
  n.name = `${stem} ${like.length + 2}`;
  return n;
}

// ---------------- motion ----------------

export function applyMotion(d: Project, c: Clip, type: Motion, amountPct = 3, ease: 'inOut' | 'linear' = 'inOut', direction?: string) {
  if (c.kind === 'audio') throw new Error(`${c.id} is an audio clip; motion needs a picture`);
  const W = d.settings.width;
  const H = d.settings.height;
  const m = mediaOf(d, c);
  const vw = m?.width || W;
  const vh = m?.height || H;
  const fit = Math.min(W / vw, H / vh);
  const s0 = c.transform.scale || 100;
  const k = 1 + Math.max(0, amountPct) / 100;
  const e: Keyframe['ease'] = ease === 'linear' ? 'linear' : 'ease';
  const T = c.duration;
  c.keyframes = c.keyframes || {};
  delete c.keyframes.scale;
  delete c.keyframes.x;
  delete c.keyframes.y;
  const two = (a: number, b: number): Keyframe[] => [{ t: 0, v: r3(a), ease: e }, { t: r3(T), v: r3(b), ease: 'linear' }];
  const x0 = c.transform.x;
  const y0 = c.transform.y;
  if (type === 'none') return { type };
  if (type === 'push_in') c.keyframes.scale = two(s0, s0 * k);
  else if (type === 'pull_out') c.keyframes.scale = two(s0 * k, s0);
  else if (type === 'pan') {
    const s = s0 * k;
    const vertical = direction === 'up' || direction === 'down';
    const disp = vertical ? vh * fit * (s / 100) : vw * fit * (s / 100);
    const frame = vertical ? H : W;
    let margin = Math.max(0, (disp - frame) / 2) * 0.95;
    if (margin < 1) margin = (frame * (k - 1)) / 2;
    c.keyframes.scale = two(s, s);
    // "pan right": the view travels right, so the picture slides left
    const forward = direction === 'left' || direction === 'up' ? -1 : 1;
    if (vertical) c.keyframes.y = two(y0 + forward * margin, y0 - forward * margin);
    else c.keyframes.x = two(x0 + forward * margin, x0 - forward * margin);
  } else if (type === 'slow_scroll') {
    // fill the width and travel from the top of the picture to the bottom (tall screenshots, documents)
    const sFill = Math.max(s0, (100 * (W / vw)) / fit);
    const over = vh * fit * (sFill / 100) - H;
    const dir = direction === 'up' ? -1 : 1;
    if (over > 2) {
      c.keyframes.scale = two(sFill, sFill);
      c.keyframes.y = two(y0 + (dir * over) / 2, y0 - (dir * over) / 2);
    } else {
      const s = s0 * k;
      const margin = (H * (k - 1)) / 2;
      c.keyframes.scale = two(s, s);
      c.keyframes.y = two(y0 + dir * margin, y0 - dir * margin);
    }
  } else throw new Error(`Unknown motion "${type}" (push_in, pull_out, pan, slow_scroll, none)`);
  return { type, keyframes: Object.fromEntries(Object.entries(c.keyframes).filter(([k]) => ['scale', 'x', 'y'].includes(k))) };
}

// ---------------- J / L cuts ----------------

export function splitEdit(d: Project, clipId: string, frames: number, kind: 'j' | 'l') {
  const c = getClip(d, clipId);
  const group = linkedGroup(d, c);
  const audio = group.filter((g) => g.kind === 'audio');
  const pic = group.find((g) => g.kind !== 'audio');
  if (!audio.length || !pic) throw new Error(`${clipId} needs linked picture and sound for a ${kind.toUpperCase()}-cut`);
  const df = frames / d.settings.fps;
  const out: any[] = [];
  for (const a of audio) {
    assertUnlocked(d, a.trackId);
    if (kind === 'j') {
      const want = Math.max(0, pic.start - df);
      if (want < a.start) clearRegion(d, a.trackId, want, a.start, new Set([a.id]));
      trimStart(d, a, want);
      out.push({ audio: a.id, audio_start: r3(a.start), picture_start: r3(pic.start), lead_frames: Math.round((pic.start - a.start) * d.settings.fps) });
    } else {
      const want = clipEnd(pic) + df;
      if (want > clipEnd(a)) clearRegion(d, a.trackId, clipEnd(a), want, new Set([a.id]));
      trimEnd(d, a, want);
      out.push({ audio: a.id, audio_end: r3(clipEnd(a)), picture_end: r3(clipEnd(pic)), tail_frames: Math.round((clipEnd(a) - clipEnd(pic)) * d.settings.fps) });
    }
  }
  return out;
}

/**
 * jl_cut: the clip's linked sound starts `lead` seconds before its picture and/or ends `tail` seconds after it,
 * snapped to whole frames, without unlinking. A side left undefined keeps its current offset.
 */
export function jlCut(d: Project, clipId: string, lead?: number, tail?: number) {
  if (lead == null && tail == null) throw new Error('Pass audio_lead and/or audio_tail (seconds)');
  const fps = d.settings.fps;
  const c = getClip(d, clipId);
  const group = linkedGroup(d, c);
  const pic = group.find((g) => g.kind !== 'audio');
  const audio = group.filter((g) => g.kind === 'audio');
  if (!pic || !audio.length) throw new Error(`${clipId} has no linked picture and sound (link_clips links them)`);
  const out: any[] = [];
  for (const a of audio) {
    assertUnlocked(d, a.trackId);
    const ex = new Set(group.map((g) => g.id));
    if (lead != null) {
      const f = Math.round(lead * fps);
      const want = Math.max(0, pic.start - f / fps);
      if (want < a.start) clearRegion(d, a.trackId, want, a.start, ex);
      trimStart(d, a, want);
    }
    if (tail != null) {
      const f = Math.round(tail * fps);
      const want = clipEnd(pic) + f / fps;
      if (want > clipEnd(a)) clearRegion(d, a.trackId, clipEnd(a), want, ex);
      trimEnd(d, a, want);
    }
    const leadF = Math.round((pic.start - a.start) * fps);
    const tailF = Math.round((clipEnd(a) - clipEnd(pic)) * fps);
    const o: any = { audio: a.id, picture: pic.id, audio_start: r3(a.start), picture_start: r3(pic.start), audio_end: r3(clipEnd(a)), picture_end: r3(clipEnd(pic)), lead_frames: leadF, tail_frames: tailF, lead_s: r3(leadF / fps), tail_s: r3(tailF / fps) };
    if (lead != null && leadF !== Math.round(lead * fps)) o.note = `the source has no sound before ${r3(a.in)} s, so the lead stops at ${leadF} frames`;
    if (tail != null && tailF !== Math.round(tail * fps)) o.note = `${o.note ? o.note + '; ' : ''}the source ends, so the tail stops at ${tailF} frames`;
    out.push(o);
  }
  return { fps, clips: out };
}

export function linkClips(d: Project, ids: string[]) {
  const clips = [...new Set(ids)].map((id) => getClip(d, id));
  if (clips.length < 2) throw new Error('Pass two or more clip_ids');
  for (const c of clips) assertUnlocked(d, c.trackId);
  const id = nid(d, 'L');
  for (const c of clips) c.linkId = id;
  return { link: id, clips: clips.map((c) => c.id) };
}

export function unlinkClips(d: Project, ids: string[]) {
  const done: string[] = [];
  for (const cid of ids) {
    const c = getClip(d, cid);
    if (!c.linkId) continue;
    const group = linkedGroup(d, c);
    c.linkId = null;
    done.push(c.id);
    // a partner left on its own is no longer linked either
    const rest = group.filter((g) => g.id !== c.id && g.linkId);
    if (rest.length === 1) {
      rest[0].linkId = null;
      done.push(rest[0].id);
    }
  }
  return { unlinked: [...new Set(done)] };
}

// ---------------- text cards ----------------

function wrap(text: string, max: number) {
  return text
    .split('\n')
    .map((para) => {
      const words = para.split(/\s+/);
      const lines: string[] = [];
      let cur = '';
      for (const w of words) {
        if (cur && (cur + ' ' + w).length > max) {
          lines.push(cur);
          cur = w;
        } else cur = cur ? cur + ' ' + w : w;
      }
      if (cur) lines.push(cur);
      return lines.join('\n');
    })
    .join('\n');
}

function textClip(d: Project, trackId: string, at: number, dur: number, st: TextStyle, x: number, y: number, fade: number) {
  return makeClip(d, {
    kind: 'text', trackId, start: at, duration: dur, name: st.content.split('\n')[0].slice(0, 40), text: st,
    transform: { ...DEFAULT_TRANSFORM, x: r3(x), y: r3(y) }, fadeIn: fade, fadeOut: fade,
  });
}

export type Backdrop = 'blur' | 'black' | 'none';

/**
 * Lay a text card over [at, at+dur) in one go: the backdrop on the Adjustments track (V3: a blur-and-darken
 * adjustment layer over the footage, or a black matte), the main line on Cards (V4), the subtitle above it.
 */
export function addTextCard(
  d: Project,
  a: { preset: CardPreset; text: string; at: number; dur: number; subtitle?: string; style?: DocStyle; marker?: boolean; meta?: Clip['meta']; backdrop?: Backdrop },
) {
  const preset = a.preset;
  if (!CARD_PRESETS.includes(preset)) throw new Error(`Unknown preset "${preset}". Presets: ${CARD_PRESETS.join(', ')}`);
  if (!(a.dur > 0)) throw new Error('A card needs a duration above 0');
  const st = a.style ?? parseStyle();
  const W = d.settings.width;
  const H = d.settings.height;
  const k = H / 1080;
  const at = a.at;
  const end = at + a.dur;
  const base: TextStyle = { ...DEFAULT_TEXT, font: st.font, color: st.color, bold: st.bold, italic: st.italic, align: 'center', shadow: true, strokeWidth: 0, backgroundOpacity: 0, content: '' };
  const created: string[] = [];
  const meta = { ...(a.meta ?? {}), preset, role: 'card' };
  const backdrop: Backdrop = a.backdrop ?? (preset === 'name_super' ? 'none' : 'blur');
  if (!['blur', 'black', 'none'].includes(backdrop)) throw new Error(`backdrop "${backdrop}": use blur, black or none`);
  const fade = preset === 'name_super' ? 0.3 : 0.5;
  let bgIdx = 2;
  if (backdrop !== 'none') {
    const tr = freeVideoFrom(d, 2, at, end, 'Adjustments');
    const bg =
      backdrop === 'blur'
        ? makeClip(d, {
            kind: 'adjustment', trackId: tr.id, start: at, duration: a.dur, name: `${preset} background`,
            fx: { ...DEFAULT_FX, blur: Math.round(st.blur * k), brightness: -Math.abs(st.darken) }, fadeIn: fade, fadeOut: fade, meta: { ...meta, role: 'card_bg' },
          })
        : makeClip(d, { kind: 'color', trackId: tr.id, start: at, duration: a.dur, name: `${preset} black`, color: '#000000', fadeIn: fade, fadeOut: fade, meta: { ...meta, role: 'card_bg' } });
    d.clips.push(bg);
    created.push(bg.id);
    bgIdx = tracksOf(d, 'video').indexOf(tr);
  }
  let main: TextStyle;
  let sub: TextStyle | null = null;
  let mx = 0;
  let my = 0;
  let sx = 0;
  let sy = 0;
  const text = a.text.trim();
  const subtitle = a.subtitle?.trim();
  if (preset === 'chapter_card') {
    main = { ...base, content: text, size: Math.round(120 * k) };
    my = 20 * k;
    if (subtitle) {
      sub = { ...base, content: subtitle.toUpperCase(), size: Math.round(40 * k), color: st.accent, italic: false };
      sy = my - 60 * k - (measureText(main).h / 2);
    }
  } else if (preset === 'date_card') {
    main = { ...base, content: text, size: Math.round(96 * k) };
    if (subtitle) {
      sub = { ...base, content: subtitle, size: Math.round(40 * k), color: st.accent, italic: false };
      sy = measureText(main).h / 2 + 40 * k;
    }
  } else if (preset === 'quote_card') {
    const q = /^[“"']/.test(text) ? text : `“${text.replace(/["”]$/, '')}”`;
    main = { ...base, content: wrap(q, 34), size: Math.round(60 * k), italic: true, bold: false };
    const h = measureText(main).h;
    my = subtitle ? -30 * k : 0;
    if (subtitle) {
      sub = { ...base, content: subtitle.startsWith('—') ? subtitle : `— ${subtitle}`, size: Math.round(36 * k), color: st.accent, italic: false };
      sy = my + h / 2 + 50 * k;
    }
  } else if (preset === 'list_card') {
    const items = text.split(/\n|;|\|/).map((x) => x.trim()).filter(Boolean);
    main = { ...base, content: items.map((x) => `•  ${x}`).join('\n'), size: Math.round(56 * k), align: 'left' };
    const h = measureText(main).h;
    my = subtitle ? 40 * k : 0;
    if (subtitle) {
      sub = { ...base, content: subtitle.toUpperCase(), size: Math.round(44 * k), color: st.accent };
      sy = my - h / 2 - 50 * k;
    }
  } else {
    // name_super: lower third, left
    main = { ...base, content: text, size: Math.round(54 * k), align: 'left' };
    const w = measureText(main).w;
    mx = -W / 2 + 0.07 * W + w / 2;
    my = H * 0.3;
    if (subtitle) {
      sub = { ...base, content: subtitle, size: Math.round(34 * k), color: st.accent, align: 'left', bold: false };
      sx = -W / 2 + 0.07 * W + measureText(sub).w / 2;
      sy = my + 52 * k;
    }
  }
  const mt = freeVideoFrom(d, Math.max(3, bgIdx + 1), at, end, 'Cards');
  const mc = textClip(d, mt.id, at, a.dur, main, mx, my, fade);
  mc.meta = meta;
  d.clips.push(mc);
  created.push(mc.id);
  if (sub) {
    const stTrack = freeVideoFrom(d, tracksOf(d, 'video').indexOf(mt) + 1, at, end, 'Cards 2');
    const sc = textClip(d, stTrack.id, at, a.dur, sub, sx, sy, fade);
    sc.meta = meta;
    d.clips.push(sc);
    created.push(sc.id);
  }
  let marker: string | undefined;
  if (preset === 'chapter_card' && a.marker !== false) {
    d.markers = d.markers.filter((m) => !(m.kind === 'chapter' && Math.abs(m.time - at) < 0.05));
    const mk = { id: nid(d, 'k'), time: r3(at), name: text.split('\n')[0], color: '#e0a400', kind: 'chapter' };
    d.markers.push(mk);
    marker = mk.id;
  }
  return { created, backdrop, chapter_marker: marker, style: st.source };
}

// ---------------- panels ----------------

const POSITIONS = ['center', 'left', 'right', 'top', 'bottom', 'top_left', 'top_right', 'bottom_left', 'bottom_right'];

export function addPanel(
  d: Project,
  a: { media: MediaItem; at: number; dur: number; position?: string; scale?: number; push?: number; dim?: number; blur?: number; source_in?: number; meta?: Clip['meta'] },
) {
  const pos = (a.position ?? 'center').toLowerCase().replace(/[\s-]+/g, '_');
  if (!POSITIONS.includes(pos)) throw new Error(`position "${a.position}": use ${POSITIONS.join(', ')}`);
  const W = d.settings.width;
  const H = d.settings.height;
  const end = a.at + a.dur;
  const created: string[] = [];
  let from = 1;
  if (a.dim || a.blur) {
    const tr = freeVideoFrom(d, 1, a.at, end);
    const adj = makeClip(d, { kind: 'adjustment', trackId: tr.id, start: a.at, duration: a.dur, name: 'Panel background', fx: { ...DEFAULT_FX, brightness: -Math.abs(a.dim ?? 0), blur: a.blur ?? 0 }, fadeIn: 0.3, fadeOut: 0.3, meta: { ...(a.meta ?? {}), role: 'card_bg' } });
    d.clips.push(adj);
    created.push(adj.id);
    from = tracksOf(d, 'video').indexOf(tr) + 1;
  }
  const tr = freeVideoFrom(d, from, a.at, end, 'Overlays');
  const [c] = placeMedia(d, a.media, { videoTrackId: tr.id, start: a.at, duration: a.dur, srcIn: a.source_in, includeAudio: false });
  if (!c) throw new Error(`${a.media.name} has no picture`);
  const scale = a.scale ?? 70;
  const vw = a.media.width || W;
  const vh = a.media.height || H;
  const fit = Math.min(W / vw, H / vh);
  const dw = vw * fit * (scale / 100);
  const dh = vh * fit * (scale / 100);
  const mx = 0.05 * W;
  const my = 0.07 * H;
  let x = 0;
  let y = 0;
  if (pos.includes('left')) x = -W / 2 + mx + dw / 2;
  if (pos.includes('right')) x = W / 2 - mx - dw / 2;
  if (pos.startsWith('top')) y = -H / 2 + my + dh / 2;
  if (pos.startsWith('bottom')) y = H / 2 - my - dh / 2;
  c.transform = { ...c.transform, scale, x: r3(x), y: r3(y) };
  c.fadeIn = 0.3;
  c.fadeOut = 0.3;
  c.meta = { ...(a.meta ?? {}), role: 'panel' };
  if (a.push !== 0) applyMotion(d, c, 'push_in', a.push ?? 2);
  created.push(c.id);
  return { created, panel: c.id, track: trackLabel(d, tr) };
}

// ---------------- volume envelopes (duck, breath, mute, fades) ----------------

const interp = (pts: [number, number][], t: number) => {
  if (!pts.length || t <= pts[0][0]) return pts[0]?.[1] ?? 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ta, va] = pts[i];
    const [tb, vb] = pts[i + 1];
    if (t <= tb) return tb - ta < EPS ? vb : va + ((vb - va) * (t - ta)) / (tb - ta);
  }
  return pts[pts.length - 1][1];
};

/** Timeline-time points → clip-local points covering exactly [0, duration]. */
function localPoints(c: Clip, pts: [number, number][]): [number, number][] {
  const local = pts.map(([t, v]) => [t - c.start, v] as [number, number]);
  const out: [number, number][] = [[0, interp(local, 0)]];
  for (const p of local) if (p[0] > EPS && p[0] < c.duration - EPS) out.push([r3(p[0]), p[1]]);
  out.push([r3(c.duration), interp(local, c.duration)]);
  return out;
}

/** Set (or with null remove) one named volume envelope on a clip and rewrite its volume keyframes. */
export function setGainLayer(c: Clip, name: string, pts: [number, number][] | null) {
  const meta = (c.meta ??= {});
  const cur = JSON.stringify(c.keyframes?.volume ?? null);
  if (meta.gainOut !== undefined && meta.gainOut !== cur) {
    // someone changed the volume keyframes by hand: that is the new base
    meta.gainBase = c.keyframes?.volume ? structuredClone(c.keyframes.volume) : null;
    meta.gainLayers = {};
  }
  if (meta.gainBase === undefined) meta.gainBase = c.keyframes?.volume ? structuredClone(c.keyframes.volume) : null;
  meta.gainLayers ??= {};
  if (pts && pts.some(([, v]) => Math.abs(v) > 1e-3)) meta.gainLayers[name] = pts;
  else delete meta.gainLayers[name];
  const layers = Object.values(meta.gainLayers);
  c.keyframes = c.keyframes || {};
  if (!layers.length) {
    if (meta.gainBase) c.keyframes.volume = structuredClone(meta.gainBase);
    else delete c.keyframes.volume;
    delete meta.gainBase;
    delete meta.gainLayers;
    delete meta.gainOut;
    return;
  }
  const baseKf = meta.gainBase ?? undefined;
  const times = new Set<number>([0, r3(c.duration)]);
  for (const k of baseKf ?? []) if (k.t >= 0 && k.t <= c.duration) times.add(r3(k.t));
  baseKf?.forEach((k, i) => {
    const nx = baseKf[i + 1];
    if (nx && k.ease === 'ease') for (let t = k.t + 0.25; t < nx.t; t += 0.25) times.add(r3(t));
  });
  for (const l of layers) for (const [t] of l) if (t >= 0 && t <= c.duration) times.add(r3(t));
  const ts = [...times].sort((x, y) => x - y);
  let kf: Keyframe[] = ts.map((t) => ({ t, v: Math.round(Math.max(-80, Math.min(24, evalKey(baseKf, t, c.volume) + layers.reduce((s, l) => s + interp(l, t), 0))) * 100) / 100, ease: 'linear' as const }));
  // drop points in the middle of flat runs
  kf = kf.filter((k, i) => i === 0 || i === kf.length - 1 || !(Math.abs(kf[i - 1].v - k.v) < 1e-3 && Math.abs(kf[i + 1].v - k.v) < 1e-3));
  c.keyframes.volume = kf;
  meta.gainOut = JSON.stringify(kf);
}

/** Timeline ranges where any of `clips` is louder than thresholdDb (from the media's 100-per-second peaks). */
export function loudRanges(p: Project, clips: Clip[], thresholdDb: number, mergeGap: number, minLen = 0.08) {
  const level = 255 * Math.pow(10, thresholdDb / 40);
  const raw: [number, number][] = [];
  for (const c of clips) {
    const m = mediaOf(p, c);
    if (!c.enabled || !m?.hasAudio) continue;
    if (!m.peaks?.length) {
      raw.push([c.start, clipEnd(c)]); // no waveform yet: treat the whole clip as speech
      continue;
    }
    const step = 0.01 / c.speed;
    let run: number | null = null;
    for (let t = c.start; t < clipEnd(c); t += step) {
      const v = m.peaks[Math.floor((c.in + (t - c.start) * c.speed) * 100)] ?? 0;
      if (v > level) run ??= t;
      else if (run != null) {
        raw.push([run, t]);
        run = null;
      }
    }
    if (run != null) raw.push([run, clipEnd(c)]);
  }
  raw.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r[0] - last[1] <= mergeGap) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out.filter(([a, b]) => b - a >= minLen);
}

function audioClipsOn(d: Project, track: Track) {
  return d.clips.filter((c) => c.trackId === track.id && (c.kind === 'audio' || (c.kind === 'video' && mediaOf(d, c)?.hasAudio && !d.clips.some((x) => x.kind === 'audio' && x.linkId && x.linkId === c.linkId))));
}

const resolveTrack = (d: Project, ref: string | undefined, role: keyof typeof ROLE_TRACK) => (ref ? getTrack(d, ref) : roleTrack(d, role));

export function duck(d: Project, a: any) {
  const music = resolveTrack(d, a.music_track, 'music');
  const key = resolveTrack(d, a.key_track, 'narration');
  if (music.id === key.id) throw new Error('music_track and key_track are the same track');
  const targets = (a.clip_ids?.length ? a.clip_ids.map((id: string) => getClip(d, id)) : audioClipsOn(d, music)) as Clip[];
  if (a.remove) {
    for (const c of targets) setGainLayer(c, 'duck', null);
    return { removed_from: targets.map((c) => c.id) };
  }
  const depth = Math.abs(a.depth_db ?? 15);
  const att = (a.attack_ms ?? 150) / 1000;
  const rel = (a.release_ms ?? 600) / 1000;
  const hold = a.hold_s ?? 0.3;
  const regions = loudRanges(d, audioClipsOn(d, key), a.threshold_db ?? -40, att + rel + hold);
  const pts: [number, number][] = [];
  for (const [s, e] of regions) pts.push([s - att, 0], [s, -depth], [e, -depth], [e + rel, 0]);
  for (const c of targets) setGainLayer(c, 'duck', pts.length ? localPoints(c, pts) : null);
  const speech = regions.reduce((t, [s, e]) => t + e - s, 0);
  return { music_track: trackLabel(d, music), key_track: trackLabel(d, key), ducked_clips: targets.map((c) => c.id), speech_regions: regions.length, speech_seconds: r3(speech), depth_db: depth };
}

/**
 * duck_audio: ducking written as the target clips' volume keyframes, keyed from the key tracks' waveforms.
 * Down by depth over `attack` before the sound starts, held `hold` after it stops, back up over `release`.
 */
export function duckAudio(d: Project, a: any) {
  const targets = ((a.target_tracks?.length ? a.target_tracks : null) ?? [roleTrack(d, 'music').id]).map((t: string) => (typeof t === 'string' ? getTrack(d, t) : t)) as Track[];
  const keys = ((a.key_tracks?.length ? a.key_tracks : null) ?? [roleTrack(d, 'narration').id]).map((t: string) => getTrack(d, t)) as Track[];
  for (const t of [...targets, ...keys]) if (t.kind !== 'audio') throw new Error(`${trackLabel(d, t)} is a video track; duck_audio works on audio tracks`);
  const keyIds = new Set(keys.map((t) => t.id));
  const clash = targets.find((t) => keyIds.has(t.id));
  if (clash) throw new Error(`${trackLabel(d, clash)} is both a target and a key track`);
  const depth = Math.abs(a.depth_db ?? 15);
  const att = Math.max(0, a.attack ?? 0.15);
  const rel = Math.max(0, a.release ?? 0.6);
  const hold = Math.max(0, a.hold ?? 0.2);
  const keyClips = keys.flatMap((t) => audioClipsOn(d, t));
  const noWave = keyClips.filter((c) => mediaOf(d, c)?.hasAudio && !mediaOf(d, c)?.peaks?.length).map((c) => c.id);
  const regions = loudRanges(d, keyClips, a.threshold_db ?? -40, att + rel + hold);
  const pts: [number, number][] = [];
  for (const [s, e] of regions) pts.push([s - att, 0], [s, -depth], [e + hold, -depth], [e + hold + rel, 0]);
  const clips = targets.flatMap((t) => audioClipsOn(d, t));
  const out: any[] = [];
  for (const c of clips) {
    assertUnlocked(d, c.trackId);
    const hit = pts.length && pts.some(([t]) => t > c.start - rel - att && t < clipEnd(c) + rel + att);
    setGainLayer(c, 'duck', hit ? localPoints(c, pts) : null);
    out.push({ clip: c.id, track: trackLabel(d, c.trackId), keyframes: (c.keyframes?.volume ?? []).map((k) => ({ t: r3(c.start + k.t), db: k.v })), note: 'keyframe t is timeline seconds (stored clip-relative)' });
  }
  return {
    target_tracks: targets.map((t) => trackLabel(d, t)),
    key_tracks: keys.map((t) => trackLabel(d, t)),
    depth_db: depth, threshold_db: a.threshold_db ?? -40, attack: att, release: rel, hold,
    key_regions: regions.map(([s, e]) => [r3(s), r3(e)]),
    clips: out,
    ...(noWave.length ? { warning: `No waveform yet for ${noWave.join(', ')}: treated as sound all the way through` } : {}),
  };
}

function envelopeOn(d: Project, clips: Clip[], name: string, pts: [number, number][] | null) {
  const a = pts?.[0][0] ?? -Infinity;
  const b = pts?.[pts.length - 1][0] ?? Infinity;
  const hit: string[] = [];
  for (const c of clips) {
    if (pts && (clipEnd(c) <= a || c.start >= b)) continue;
    if (!pts && !c.meta?.gainLayers?.[name]) continue;
    setGainLayer(c, name, pts ? localPoints(c, pts) : null);
    hit.push(c.id);
  }
  return hit;
}

export function breath(d: Project, a: any) {
  const at = a.at;
  const name = `breath@${Number(at).toFixed(2)}`;
  const except = new Set((a.except ?? []).map((t: string) => getTrack(d, t).id));
  const tracks = (a.tracks?.length ? a.tracks.map((t: string) => getTrack(d, t)) : tracksOf(d, 'audio')).filter((t: Track) => !except.has(t.id));
  const clips = tracks.flatMap((t: Track) => audioClipsOn(d, t));
  if (a.remove) return { removed_from: envelopeOn(d, clips, name, null) };
  const dur = a.dur ?? 2.5;
  const fo = a.fade_out_s ?? 2;
  const rel = a.release_s ?? 1.5;
  const depth = Math.abs(a.depth_db ?? 40);
  const pts: [number, number][] = [[at - fo, 0], [at, -depth], [at + dur, -depth], [at + dur + rel, 0]];
  return { breath: name, clips: envelopeOn(d, clips, name, pts), silent_from: r3(at), silent_to: r3(at + dur), tracks: tracks.map((t: Track) => trackLabel(d, t)) };
}

export function muteMusicUnder(d: Project, a: any) {
  const music = resolveTrack(d, a.music_track, 'music');
  let s = a.start;
  let e = a.end;
  let name = `mute@${Number(s).toFixed(2)}`;
  if (a.clip_id) {
    const c = getClip(d, a.clip_id);
    s = c.start;
    e = clipEnd(c);
    name = `mute:${c.id}`;
  }
  if (s == null || e == null) throw new Error('Pass clip_id, or start and end');
  const clips = audioClipsOn(d, music);
  if (a.remove) return { removed_from: envelopeOn(d, clips, name, null) };
  const f = a.fade_s ?? 0.5;
  const depth = Math.abs(a.depth_db ?? 60);
  return { muted_under: r3(s) + '–' + r3(e), music_clips: envelopeOn(d, clips, name, [[s - f, 0], [s, -depth], [e, -depth], [e + f, 0]]) };
}

export function fadeClips(d: Project, a: any) {
  const out: string[] = [];
  for (const id of a.clip_ids ?? [a.clip_id]) {
    const c = getClip(d, id);
    assertUnlocked(d, c.trackId);
    const fin = a.in_s ?? 0;
    const fout = a.out_s ?? 0;
    if (a.curve === 'exp' && c.kind === 'audio') {
      // linear in dB ("exponential" in level): sounds even, unlike a linear gain ramp
      c.fadeIn = 0;
      c.fadeOut = 0;
      const pts: [number, number][] = [];
      if (fin > 0) pts.push([0, -50], [fin, 0]);
      else pts.push([0, 0]);
      if (fout > 0) pts.push([c.duration - fout, 0], [c.duration, -50]);
      else pts.push([c.duration, 0]);
      setGainLayer(c, 'fade', pts);
    } else {
      if (c.meta?.gainLayers?.fade) setGainLayer(c, 'fade', null);
      c.fadeIn = Math.max(0, fin);
      c.fadeOut = Math.max(0, fout);
    }
    out.push(c.id);
  }
  return { faded: out, curve: a.curve ?? 'linear' };
}

// ---------------- ambience ----------------

export function ambienceFill(d: Project, a: { media: MediaItem; track?: string; level_db?: number; start?: number; end?: number; fade_s?: number; min_gap?: number; only_under?: string }) {
  const tr = a.track ? getTrack(d, a.track) : roleTrack(d, 'ambience');
  if (tr.kind !== 'audio') throw new Error('ambience_fill needs an audio track');
  assertUnlocked(d, tr.id);
  const m = a.media;
  if (!m.hasAudio) throw new Error(`${m.name} has no audio`);
  const total = sequenceDuration(d);
  let targets: [number, number][] = [[a.start ?? 0, a.end ?? total]];
  if (a.only_under === 'recreation') {
    targets = d.clips.filter((c) => c.meta?.role === 'recreation').map((c) => [c.start, clipEnd(c)] as [number, number]).sort((x, y) => x[0] - y[0]);
    if (!targets.length) throw new Error('No clips are marked as recreations (EDL visual_type "recreation")');
  }
  const minGap = a.min_gap ?? 1;
  const fade = a.fade_s ?? 1;
  const created: string[] = [];
  let srcPos = 0;
  const len = m.duration || 0;
  if (len < 1) throw new Error(`${m.name} is too short to loop`);
  for (const [ta, tb] of targets) {
    const occupied = d.clips.filter((c) => c.trackId === tr.id && c.start < tb && clipEnd(c) > ta).map((c) => [c.start, clipEnd(c)] as [number, number]).sort((x, y) => x[0] - y[0]);
    const gaps: [number, number][] = [];
    let cur = ta;
    for (const [s, e] of occupied) {
      if (s - cur >= minGap) gaps.push([cur, s]);
      cur = Math.max(cur, e);
    }
    if (tb - cur >= minGap) gaps.push([cur, tb]);
    for (const [gs, ge] of gaps) {
      let t = gs;
      while (t < ge - 0.05) {
        if (srcPos >= len - 0.5) srcPos = 0;
        const piece = Math.min(ge - t, len - srcPos);
        const c = makeClip(d, { kind: 'audio', trackId: tr.id, start: r3(t), duration: r3(piece), in: r3(srcPos), mediaId: m.id, name: m.name, volume: a.level_db ?? -40, meta: { role: 'ambience' } });
        c.fadeIn = Math.min(fade, piece / 2);
        c.fadeOut = Math.min(fade, piece / 2);
        d.clips.push(c);
        created.push(c.id);
        srcPos += piece;
        t += piece;
      }
    }
  }
  return { track: trackLabel(d, tr), created, level_db: a.level_db ?? -40 };
}

// ---------------- EDL ----------------

const rowRole = (type: string) => (VISUAL.raw.has(type) ? 'raw' : type === 'recreation' ? 'recreation' : 'footage');
const isHex = (s: string) => /^#[0-9a-f]{3,8}$/i.test(s.trim());

export function applyEdl(d: Project, rows: EdlRow[], o: { baseDir?: string; style: DocStyle; replace?: boolean; template?: boolean }) {
  if (o.template !== false) applyTemplate(d);
  const fps = d.settings.fps;
  const ids = new Set(rows.map((r) => r.id));
  if (o.replace !== false) {
    d.clips = d.clips.filter((c) => !(c.meta?.edl && ids.has(c.meta.edl)));
    d.markers = d.markers.filter((m) => !((m.kind === 'hold' || m.kind === 'chapter') && m.note && ids.has(m.note.replace(/^EDL /, ''))));
  }
  const report: any[] = [];
  const skipped: { id: string; line: string; reason: string }[] = [];
  const notes: string[] = [];
  const sorted = [...rows].sort((a, b) => (a.tin ?? 0) - (b.tin ?? 0));
  const sections = new Set<string>();
  let prevPic: Clip | undefined;
  for (const r of sorted) {
    const skip = (reason: string) => skipped.push({ id: r.id, line: r.line, reason });
    try {
      if (r.tin == null) {
        skip('no timeline_in');
        continue;
      }
      const sec = r.section.trim().toLowerCase();
      const firstOfSection = !!sec && !sections.has(sec);
      if (sec) sections.add(sec);
      let dur = r.tout != null ? r.tout - r.tin : r.sout != null ? r.sout - (r.sin ?? 0) : undefined;
      let type = r.type;
      const isCard = type === 'card' || type === 'text_card' || !!cardOf(type);
      const url = r.source && isUrl(r.source);
      if (url && !isCard) {
        skip(`source_file_or_url is a link (${r.source}): download it first (download_media) and put the file's path in the EDL`);
        continue;
      }
      if (url) notes.push(`${r.id}: the card's source is a link, so it is shown over black`);
      const src = r.source && !url && !isHex(r.source) ? findMedia(d, r.source, o.baseDir) : undefined;
      if (r.source && !url && !isHex(r.source) && !src && !VISUAL.black.has(type)) {
        skip(`source "${r.source}" not found (not in the bin, and no such file next to the CSV)`);
        continue;
      }
      if (!type) type = src ? (src.type === 'image' ? 'image' : src.type === 'audio' ? 'audio' : 'footage') : r.text ? 'name_super' : 'black';
      if (src?.type === 'audio') {
        skip(`${src.name} is audio only: put sound in the cue sheet (05_cues.csv)`);
        continue;
      }
      if (src?.type === 'image' && VISUAL.video.has(type)) type = 'image';
      if (dur == null && src?.type === 'video') dur = (src.duration || 0) - (r.sin ?? 0);
      if (dur == null || !(dur > 0)) {
        skip('no length: give timeline_out (or source_in and source_out)');
        continue;
      }
      dur = Math.max(1 / fps, dur);
      const meta = { edl: r.id, ...(r.type ? { visual: r.type } : {}), ...(r.section ? { section: r.section } : {}), ...(r.credit ? { credit: r.credit } : {}), ...(r.hold ? { hold: true } : {}) };
      const made: string[] = [];
      let pic: Clip | undefined;
      let onFootage = false;
      if (src && (VISUAL.video.has(type) || VISUAL.image.has(type) || isCard)) {
        const db = num(r.audioDb);
        const withAudio = src.hasAudio && db != null && !/mute|off|none|-inf/i.test(r.audioDb);
        const clips = placeMedia(d, src, {
          videoTrackId: roleTrack(d, 'footage').id, audioTrackId: withAudio ? roleTrack(d, 'clip_audio').id : undefined, start: r.tin, duration: dur,
          srcIn: r.sin, includeAudio: withAudio,
        });
        for (const c of clips) {
          c.meta = { ...meta, role: c.kind === 'audio' ? 'clip_audio' : rowRole(type) };
          if (c.kind === 'audio' && db != null) c.volume = Math.max(-60, Math.min(24, db));
          made.push(c.id);
        }
        pic = clips.find((c) => c.kind !== 'audio');
        onFootage = !!pic;
        if (r.sout != null && r.sin != null && Math.abs(r.sout - r.sin - dur) > 1.5 / fps && src.type !== 'image')
          notes.push(`${r.id}: source range is ${r3(r.sout - r.sin)} s but the timeline slot is ${r3(dur)} s — used the slot length from source_in`);
      } else if (src && VISUAL.panel.has(type)) {
        const res = addPanel(d, { media: src, at: r.tin, dur, source_in: r.sin, push: 0, meta });
        made.push(...res.created);
        pic = d.clips.find((c) => c.id === res.panel);
      } else if (type.startsWith('color') || isHex(r.source)) {
        const color = r.source.match(/#[0-9a-f]{3,8}/i)?.[0] ?? '#000000';
        const tr = roleTrack(d, 'footage');
        clearRegion(d, tr.id, r.tin, r.tin + dur);
        const c = makeClip(d, { kind: 'color', trackId: tr.id, start: r.tin, duration: dur, name: 'Color', color, meta: { ...meta, role: 'footage' } });
        d.clips.push(c);
        made.push(c.id);
        pic = c;
        onFootage = true;
      } else if (VISUAL.black.has(type) || isCard) {
        // nothing on the footage track (black), or a card over black / over another row's footage
      } else if (!src) {
        skip(`visual_type "${r.type}" needs a source_file_or_url`);
        continue;
      } else {
        skip(`visual_type "${r.type}" not understood (original_clip, artifact, interview, photo, recreation, era_broll, illustration, gameplay, card)`);
        continue;
      }
      if (pic && r.motion) {
        const mo = parseMotion(r.motion);
        if (mo) applyMotion(d, pic, mo.type, mo.amount ?? 3, 'inOut', mo.direction);
      }
      let preset: CardPreset | undefined;
      if (r.text || isCard) {
        const ct = cardText(r.text || '');
        preset = cardOf(type) ?? ct.preset ?? (isCard ? inferCard(r.text || '') : 'name_super');
        if (ct.main) {
          const explicitChapter = cardOf(type) === 'chapter_card' || ct.preset === 'chapter_card';
          const marker = preset === 'chapter_card' && (explicitChapter || firstOfSection || /^(chapter|part)\b/i.test(ct.main) || (!!sec && ct.main.toLowerCase().includes(sec)));
          const under = d.clips.some((c) => c.trackId === roleTrack(d, 'footage').id && c.kind !== 'audio' && c.start < r.tin! + dur! - EPS && clipEnd(c) > r.tin! + EPS);
          const backdrop: Backdrop = preset === 'name_super' && !isCard ? 'none' : under ? 'blur' : 'black';
          const res = addTextCard(d, { preset, text: ct.main, subtitle: ct.sub, at: r.tin, dur, style: o.style, meta, marker, backdrop });
          made.push(...res.created);
          if (res.chapter_marker) {
            const mk = d.markers.find((m) => m.id === res.chapter_marker);
            if (mk) mk.note = `EDL ${r.id}`;
          }
          if (!pic) pic = d.clips.find((c) => c.id === res.created[0] && c.kind === 'color');
        } else if (isCard) notes.push(`${r.id}: a card without on_screen_text`);
      }
      if (r.transition) {
        const tr = parseTransition(r.transition);
        if (tr && (tr.type === 'j_cut' || tr.type === 'l_cut')) {
          const f = ('frames' in tr ? tr.frames : undefined) ?? 10;
          if (tr.type === 'j_cut') {
            if (pic && linkedGroup(d, pic).some((g) => g.kind === 'audio')) jlCut(d, pic.id, f / fps);
            else notes.push(`${r.id}: j_cut needs the shot's own sound (give clip_audio_db)`);
          } else if (prevPic && d.clips.includes(prevPic) && linkedGroup(d, prevPic).some((g) => g.kind === 'audio')) jlCut(d, prevPic.id, undefined, f / fps);
          else notes.push(`${r.id}: l_cut needs the previous shot's sound (give it a clip_audio_db)`);
          if (pic) pic.transitionIn = null;
        } else if (tr && pic) {
          if (tr.type !== 'cut') pic.transitionIn = { type: tr.type as TransitionType, duration: Math.min(('duration' in tr ? tr.duration : undefined) ?? 0.5, pic.duration) };
          else pic.transitionIn = null;
        }
      }
      if (r.sfx) {
        const [file, g] = r.sfx.split('@');
        const m = MEDIA_EXT.test(file.trim()) ? findMedia(d, file.trim(), o.baseDir) : undefined;
        if (m) {
          const len = m.duration || 1;
          const tr = freeAudioLike(d, roleTrack(d, 'sfx'), r.tin, r.tin + len);
          const [c] = placeMedia(d, m, { audioTrackId: tr.id, start: r.tin, includeVideo: false });
          if (c) {
            c.volume = num(g ?? '') ?? 0;
            c.meta = { ...meta, role: 'sfx' };
            made.push(c.id);
          }
        } else if (MEDIA_EXT.test(file.trim())) notes.push(`${r.id}: sfx file "${file.trim()}" not found`);
      }
      if (r.hold) d.markers.push({ id: nid(d, 'k'), time: r3(r.tin), duration: r3(dur), name: `Hold ${r.id}`, color: '#7f8fa6', kind: 'hold', note: `EDL ${r.id}` });
      if (onFootage) prevPic = pic;
      report.push({ id: r.id, type, ...(preset ? { card: preset } : {}), start: r3(r.tin), end: r3(r.tin + dur), clips: made });
    } catch (e: any) {
      skip(e.message);
    }
  }
  if (rows.some((r) => r.music && !MEDIA_EXT.test(r.music))) notes.push('music_cue values are labels: the music itself comes from the cue sheet (import_cues)');
  if (rows.some((r) => r.sfx && !MEDIA_EXT.test(r.sfx.split('@')[0].trim()))) notes.push('sfx values that are not file names are kept as notes (place the sound with the cue sheet)');
  return { rows: rows.length, placed: report.length, skipped, notes, created: report };
}

export function checkEdl(d: Project, rows: EdlRow[], tolFrames = 1) {
  const fps = d.settings.fps;
  const tol = tolFrames / fps + 1e-4;
  const missing: any[] = [];
  const moved: any[] = [];
  const wrongLength: any[] = [];
  const slipped: any[] = [];
  let ok = 0;
  const ids = new Set(rows.map((r) => r.id));
  const checked = rows.filter((r) => r.tin != null && !VISUAL.black.has(r.type));
  for (const r of checked) {
    const clips = d.clips.filter((c) => c.meta?.edl === r.id);
    const pic =
      clips.find((c) => (c.kind === 'video' || c.kind === 'image' || c.kind === 'color') && c.meta?.role !== 'card_bg') ??
      clips.find((c) => c.meta?.role === 'panel') ??
      clips.find((c) => c.kind === 'color') ??
      clips.find((c) => c.kind === 'text');
    if (!pic) {
      missing.push({ id: r.id, line: r.line, expected_start: r3(r.tin!) });
      continue;
    }
    const dur = r.tout != null ? r.tout - r.tin! : r.sout != null ? r.sout - (r.sin ?? 0) : pic.duration;
    let good = true;
    if (Math.abs(pic.start - r.tin!) > tol) {
      moved.push({ id: r.id, clip: pic.id, expected_start: r3(r.tin!), actual_start: r3(pic.start), by: r3(pic.start - r.tin!) });
      good = false;
    }
    if (Math.abs(pic.duration - dur) > tol) {
      wrongLength.push({ id: r.id, clip: pic.id, expected: r3(dur), actual: r3(pic.duration) });
      good = false;
    }
    if (r.sin != null && pic.kind === 'video' && Math.abs(pic.in - r.sin) > tol) {
      slipped.push({ id: r.id, clip: pic.id, expected_source_in: r3(r.sin), actual_source_in: r3(pic.in) });
      good = false;
    }
    if (good) ok++;
  }
  const extra = [...new Set(d.clips.filter((c) => c.meta?.edl && !ids.has(c.meta.edl)).map((c) => c.meta!.edl!))];
  const untracked = d.clips.filter((c) => !c.meta?.edl && c.kind !== 'audio' && c.meta?.role !== 'ambience').length;
  return {
    rows_checked: checked.length,
    matching: ok,
    differences: missing.length + moved.length + wrongLength.length + slipped.length + extra.length,
    missing,
    moved,
    wrong_length: wrongLength,
    slipped,
    clips_from_rows_not_in_file: extra,
    visual_clips_without_edl_id: untracked,
  };
}

// ---------------- cues ----------------

/** The file a cue plays: named in track_title / source_and_licence, else the file in `files` matching track_title. */
export function cueFile(r: CueRow, files: string[] = []) {
  return r.file ?? (r.title ? matchTitle(r.title, files) : undefined);
}

export function resolveCue(d: Project, r: CueRow, baseDir?: string, files: string[] = []) {
  const f = cueFile(r, files);
  return (f ? findMedia(d, f, baseDir) : undefined) ?? (r.title ? findMedia(d, r.title) : undefined);
}

/** Audio clips a cue applies to on a track over [a, b). */
const clipsIn = (d: Project, t: Track, a: number, b: number) => audioClipsOn(d, t).filter((c) => c.start < b - EPS && clipEnd(c) > a + EPS);

const musicTracks = (d: Project) => {
  const m = roleTrack(d, 'music');
  return [m, ...d.tracks.filter((t) => t.kind === 'audio' && t.id !== m.id && /^music \d+$/i.test(t.name ?? ''))];
};

/**
 * Place the cue sheet. `rel` is each cue's measured gain for 0 dB relative to the narration (narration LUFS − the
 * cue's own LUFS, from DOC_ASYNC); without it level_vs_narration_db is applied as plain gain.
 */
export function applyCues(d: Project, rows: CueRow[], o: { baseDir?: string; files?: string[]; replace?: boolean; template?: boolean; rel?: Record<string, number>; duck?: boolean }) {
  if (o.template !== false) applyTemplate(d);
  const ids = new Set(rows.map((r) => r.id));
  if (o.replace !== false) {
    d.clips = d.clips.filter((c) => !(c.meta?.cue && ids.has(c.meta.cue)));
    for (const c of d.clips)
      for (const id of ids) {
        if (c.meta?.gainLayers?.[`cue:${id}`]) setGainLayer(c, `cue:${id}`, null);
        if (c.meta?.gainLayers?.[`mute:cue:${id}`]) setGainLayer(c, `mute:cue:${id}`, null);
      }
  }
  const placed: any[] = [];
  const skipped: any[] = [];
  const notes: string[] = [];
  const toDuck: { clip: string; depth: number }[] = [];
  const toSnap: { clip: string; grid: string }[] = [];
  const toPhrase: { clip: string; end: number }[] = [];
  const total = Math.max(sequenceDuration(d), ...rows.map((r) => r.tout ?? 0));
  const fps = d.settings.fps;
  // the sound first, then the cues that shape it (silences, clip sound with the music out under it)
  const later = (r: CueRow) => (r.type === "silence" || r.type === "clip_audio" ? 1 : 0);
  for (const r of [...rows].sort((a, b) => later(a) - later(b) || (a.tin ?? 0) - (b.tin ?? 0))) {
    const skip = (reason: string) => skipped.push({ id: r.id, line: r.line, reason });
    try {
      if (r.tin == null) {
        skip('no timeline_in');
        continue;
      }
      const tin = r.tin;
      const m = resolveCue(d, r, o.baseDir, o.files);
      const type = r.type || (m ? 'music' : '');
      const meta = { cue: r.id, ...(r.credit ? { credit: r.credit } : {}) };
      const rel = o.rel?.[r.id];
      if (type === 'silence') {
        // music and SFX that play through the silence fade down into it (entry fade) and back after it (exit
        // fade); a cue that already ends at timeline_in or starts at timeline_out is left as it is
        const tout = r.tout ?? tin + 2;
        const into = r.fadeIn ?? 1;
        const back = r.fadeOut ?? 1;
        const clips = [...musicTracks(d), roleTrack(d, 'sfx')].flatMap((t) => clipsIn(d, t, tin, tout));
        const hit = envelopeOn(d, clips, `cue:${r.id}`, [[tin - into, 0], [tin, -60], [tout, -60], [tout + back, 0]]);
        placed.push({ id: r.id, type, silent: `${r3(tin)}–${r3(tout)}`, faded_clips: hit });
        continue;
      }
      if (type === 'clip_audio' && !m) {
        // the sound of the clips already on A1 in this range: matched to the narration, music out under it
        const tout = r.tout ?? total;
        const clipT = roleTrack(d, 'clip_audio');
        const clips = clipsIn(d, clipT, tin, tout);
        if (!clips.length) {
          skip(`no clip sound on ${trackLabel(d, clipT)} between ${r3(tin)} and ${r3(tout)} s (give the EDL row a clip_audio_db)`);
          continue;
        }
        const out: any[] = [];
        for (const c of clips) {
          const want = rel != null ? rel + (r.level ?? 0) : r.level ?? r.gain;
          if (want == null) continue;
          const g = want - c.volume;
          setGainLayer(c, `cue:${r.id}`, localPoints(c, [[tin - 0.05, 0], [tin, g], [tout, g], [tout + 0.05, 0]]));
          out.push({ clip: c.id, gain_db: r3(want) });
        }
        // Reference F: no music under raw dialogue
        const fi = r.fadeIn ?? 0.5;
        const fo = r.fadeOut ?? 0.5;
        const music = musicTracks(d).flatMap((t) => audioClipsOn(d, t));
        const muted = envelopeOn(d, music, `mute:cue:${r.id}`, [[tin - fi, 0], [tin, -60], [tout, -60], [tout + fo, 0]]);
        // entry j_cut / exit l_cut: the clip's sound leads into / tails out of its picture
        const jl: any[] = [];
        const first = clips[0];
        const last = clips[clips.length - 1];
        if (r.entry === 'j_cut' && linkedGroup(d, first).some((g) => g.kind !== 'audio')) jl.push(jlCut(d, first.id, 10 / fps));
        if (r.exit === 'l_cut' && linkedGroup(d, last).some((g) => g.kind !== 'audio')) jl.push(jlCut(d, last.id, undefined, 10 / fps));
        placed.push({ id: r.id, type, clips: out, music_out_under: muted, ...(jl.length ? { jl_cuts: jl.flatMap((x) => x.clips) } : {}) });
        continue;
      }
      if (!m) {
        const f = cueFile(r, o.files);
        skip(f ? `"${f}" not found` : r.title ? `no file for track_title "${r.title}": name the file (e.g. music/${r.title.replace(/[^\w]+/g, '_').toLowerCase()}.wav) in track_title or source_and_licence, or put it in the CSV's folder` : 'no file (track_title)');
        continue;
      }
      if (!m.hasAudio) {
        skip(`${m.name} has no audio`);
        continue;
      }
      const role = (['music', 'sfx', 'ambience', 'clip_audio', 'narration'].includes(type) ? type : 'music') as keyof typeof ROLE_TRACK;
      if (!['music', 'sfx', 'ambience', 'clip_audio', 'narration'].includes(type)) notes.push(`${r.id}: type "${r.type}" placed as music (types: music, silence, sfx, ambience, clip_audio)`);
      const sin = r.sin ?? 0;
      const len = m.duration || 0;
      let end = r.tout ?? (role === 'ambience' ? total : tin + Math.max(0.04, len - sin));
      const loops = r.loop || role === 'ambience' || (role === 'music' && r.tout != null && /loop/i.test(r.notes));
      if (!loops) end = Math.min(end, tin + Math.max(0.04, len - sin));
      if (r.tout != null && end < r.tout - 0.5) notes.push(`${r.id}: ${m.name} is ${r3(len - sin)} s from its in point, shorter than the cue (${r3(r.tout - tin)} s); it ends at ${r3(end)} s (say "loop" in notes to loop it)`);
      const tr = freeAudioLike(d, roleTrack(d, role), tin, end);
      assertUnlocked(d, tr.id);
      let vol = r.gain ?? (role === 'ambience' ? -40 : role === 'music' ? -18 : 0);
      let duckDepth: number | undefined;
      if (r.level != null) {
        if (rel != null) {
          vol = rel + r.level;
          if (o.duck && role === 'music' && r.level < 0) {
            // the bed at the narration level in the gaps, level_vs_narration_db under the voice while it speaks
            vol = rel;
            duckDepth = -r.level;
          }
        } else {
          vol = r.level;
          notes.push(`${r.id}: no narration on A3 to measure against, so level_vs_narration_db ${r.level} was used as plain gain (place the narration first, then re-import)`);
        }
      }
      vol = Math.max(-60, Math.min(24, Math.round(vol * 10) / 10));
      const made: string[] = [];
      let t = tin;
      let pos = sin;
      while (t < end - 0.02) {
        if (pos >= len - 0.05) pos = 0;
        const piece = Math.min(end - t, len - pos);
        clearRegion(d, tr.id, t, t + piece);
        const c = makeClip(d, { kind: 'audio', trackId: tr.id, start: r3(t), duration: r3(piece), in: r3(pos), mediaId: m.id, name: m.name, volume: vol, meta: { ...meta, role } });
        d.clips.push(c);
        made.push(c.id);
        t += piece;
        pos += piece;
      }
      const first = d.clips.find((c) => c.id === made[0]);
      const last = d.clips.find((c) => c.id === made[made.length - 1]);
      if (first && r.fadeIn) first.fadeIn = Math.min(r.fadeIn, first.duration);
      if (last && r.fadeOut) last.fadeOut = Math.min(r.fadeOut, last.duration);
      if (duckDepth != null || r.duck) made.forEach((id) => toDuck.push({ clip: id, depth: duckDepth ?? r.duckDepth ?? 15 }));
      if (r.snap && first) toSnap.push({ clip: first.id, grid: r.snap });
      if (r.exit === 'cut_on_phrase' && last) toPhrase.push({ clip: last.id, end: clipEnd(last) });
      placed.push({ id: r.id, type: role, file: m.name, track: trackLabel(d, tr), start: r3(tin), end: r3(end), gain_db: vol, ...(r.level != null ? { level_vs_narration_db: r.level } : {}), ...(duckDepth != null ? { ducks_by_db: duckDepth } : {}), clips: made });
    } catch (e: any) {
      skip(e.message);
    }
  }
  const depths = [...new Set(toDuck.map((x) => x.depth))];
  for (const depth of depths) duck(d, { clip_ids: toDuck.filter((x) => x.depth === depth).map((x) => x.clip), depth_db: depth });
  return { rows: rows.length, placed, skipped, notes, ducked: toDuck.map((x) => x.clip), to_snap: toSnap, to_phrase: toPhrase };
}

/** Integrated loudness of `clips` alone (zero: at 0 dB with their gain, envelopes and fades taken off), over [a, b). */
export async function soloLoudness(p: Project, clips: Clip[], o: { zero?: boolean; a?: number; b?: number } = {}) {
  if (!clips.length) return null;
  const q = structuredClone(p);
  const keep = new Set(clips.map((c) => c.id));
  q.clips = q.clips.filter((c) => keep.has(c.id));
  for (const t of q.tracks) {
    t.muted = false;
    t.solo = false;
    if (o.zero) t.volume = 0;
  }
  if (o.zero)
    for (const c of q.clips) {
      c.volume = 0;
      if (c.keyframes) delete c.keyframes.volume;
      c.fadeIn = 0;
      c.fadeOut = 0;
      c.meta = undefined;
    }
  const A = Math.max(o.a ?? -Infinity, Math.min(...clips.map((c) => c.start)));
  const B = Math.min(o.b ?? Infinity, Math.max(...clips.map((c) => clipEnd(c))));
  if (!(B > A)) return null;
  const meter = await measureTimeline(q, A, B, renderMix);
  const v = meter.integrated();
  return Number.isFinite(v) ? v : null;
}

/** Narration clips (A3 Narration, or the 0.2.33 layout's A1 Narration) */
export function narrationClips(p: Project) {
  const t = p.tracks.find((x) => x.kind === 'audio' && x.name === 'Narration') ?? tracksOf(p, 'audio')[2];
  return t ? audioClipsOn(p, t).filter((c) => c.enabled) : [];
}

// ---------------- beats ----------------

export async function clipGrid(d: Project, c: Clip) {
  const m = mediaOf(d, c);
  if (!m?.hasAudio) throw new Error(`${c.id} has no audio to find a beat in`);
  const srcA = c.in;
  const srcB = c.in + c.duration * c.speed;
  const g = await beatGrid(m, Math.max(0, srcA - 8), Math.min(m.duration || srcB, srcB + 8));
  const tl = (s: number) => r3(c.start + (s - c.in) / c.speed);
  const inside = (s: number) => s >= srcA - 1e-3 && s <= srcB + 1e-3;
  return {
    clip: c.id, media: m.id, name: m.name, bpm: g.bpm, confidence: g.confidence,
    beats: g.beats.filter(inside).map(tl), downbeats: g.downbeats.filter(inside).map(tl), phrases: g.phrases.filter(inside).map(tl),
    source: g,
  };
}

/** The nearest grid point at or after `s` in source time (to start a music cue on a downbeat / phrase). */
export function nextGridPoint(list: number[], s: number) {
  return list.find((x) => x >= s - 1e-3);
}

// ---------------- timeline analysis ----------------

let meterCache: { key: string; meter: LoudnessMeter; a: number; b: number } | null = null;

function audioKey(p: Project, a: number, b: number) {
  const s = JSON.stringify([a, b, p.tracks.filter((t) => t.kind === 'audio'), p.clips.filter((c) => c.kind === 'audio' || c.kind === 'video').map((c) => [c.id, c.trackId, c.start, c.duration, c.in, c.speed, c.volume, c.pan, c.fadeIn, c.fadeOut, c.enabled, c.keyframes?.volume, c.mediaId, c.transitionIn, c.transitionOut]), p.media.map((m) => [m.id, m.path])]);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `${h}:${s.length}`;
}

export async function timelineMeter(p: Project, a?: number, b?: number) {
  const A = Math.max(0, a ?? 0);
  const B = Math.min(sequenceDuration(p), b ?? Infinity);
  if (!(B > A)) throw new Error('The timeline is empty in that range');
  const key = audioKey(p, A, B);
  if (meterCache?.key === key) return meterCache;
  const meter = await measureTimeline(p, A, B, renderMix);
  meterCache = { key, meter, a: A, b: B };
  return meterCache;
}

export async function timelineLoudness(p: Project, a: any) {
  const { meter, a: A, b: B } = await timelineMeter(p, a.start, a.end);
  const st = meter.shortTerm();
  const loudest = st.map((v, i) => [i, v] as [number, number | null]).filter(([, v]) => v != null).sort((x, y) => (y[1] as number) - (x[1] as number)).slice(0, 5);
  return {
    range: [r3(A), r3(B)],
    ...meter.summary(),
    loudest_short_term: loudest.map(([i, v]) => ({ at: r3(A + i), lufs: v })),
    ...(a.per_second === false ? {} : { short_term_lufs: st, short_term_note: `short_term_lufs[i] = 3 s window ending at ${r3(A)} + i + 1 s` }),
  };
}

export async function timelineSilences(p: Project, a: any) {
  const { meter, a: A } = await timelineMeter(p, a.start, a.end);
  const th = a.threshold_db ?? -45;
  const min = a.min_duration ?? a.min_s ?? 0.4;
  const out: { start: number; end: number; length: number; under?: string[] }[] = [];
  let run: number | null = null;
  const r = meter.rms50;
  for (let i = 0; i <= r.length; i++) {
    const quiet = i < r.length && r[i] < th;
    if (quiet && run == null) run = i;
    else if (!quiet && run != null) {
      const s = A + run * 0.05;
      const e = A + i * 0.05;
      if (e - s >= min) out.push({ start: r3(s), end: r3(e), length: r3(e - s) });
      run = null;
    }
  }
  for (const s of out) {
    const under = p.clips.filter((c) => c.kind !== 'audio' && c.start < s.end && clipEnd(c) > s.start && (c.meta?.preset || c.meta?.role === 'raw' || c.meta?.hold)).map((c) => `${c.id}${c.meta?.preset ? ' ' + c.meta.preset : c.meta?.role === 'raw' ? ' raw clip' : ' hold'}`);
    if (under.length) s.under = [...new Set(under)];
  }
  return { threshold_db: th, min_duration: min, silences: out, count: out.length, total_seconds: r3(out.reduce((t, s) => t + s.length, 0)) };
}

// ---------------- timeline listing ----------------

export function timelineListing(p: Project, a: any) {
  const want = a.track ? getTrack(p, a.track).id : null;
  const nonDefaultFx = (c: Clip) => Object.entries(c.fx).filter(([k, v]) => (DEFAULT_FX as any)[k] !== v).map(([k, v]) => `${k}=${v}`);
  const clips = p.clips
    .filter((c) => !want || c.trackId === want)
    .sort((x, y) => x.start - y.start || trackLabel(p, x.trackId).localeCompare(trackLabel(p, y.trackId)))
    .map((c) => {
      const m = mediaOf(p, c);
      const o: any = { id: c.id, track: trackLabel(p, c.trackId), kind: c.kind, start: r3(c.start), end: r3(clipEnd(c)) };
      if (m) Object.assign(o, { src: m.name, media_id: m.id, src_in: r3(c.in), src_out: r3(c.in + c.duration * c.speed) });
      if (c.kind === 'text') o.text = c.text?.content;
      if (c.kind === 'color') o.color = c.color;
      if (c.speed !== 1) o.speed = c.speed;
      if (c.kind === 'audio' || c.volume) o.gain_db = c.volume;
      if (c.keyframes?.volume?.length) o.gain_keys = c.keyframes.volume.length;
      const fx = nonDefaultFx(c);
      if (fx.length) o.effects = fx;
      const mv = (['scale', 'x', 'y'] as const).filter((k) => c.keyframes?.[k]?.length);
      if (mv.length) o.motion = mv.map((k) => `${k} ${c.keyframes![k]![0].v}→${c.keyframes![k]![c.keyframes![k]!.length - 1].v}`).join(', ');
      if (c.transitionIn) o.transition_in = `${c.transitionIn.type} ${c.transitionIn.duration}s`;
      if (c.transitionOut) o.transition_out = `${c.transitionOut.type} ${c.transitionOut.duration}s`;
      if (c.fadeIn || c.fadeOut) o.fades = [c.fadeIn, c.fadeOut];
      if (c.linkId) o.link = c.linkId;
      if (!c.enabled) o.disabled = true;
      if (c.meta) {
        const { gainBase, gainLayers, gainOut, ...rest } = c.meta;
        Object.assign(o, rest);
        if (gainLayers && Object.keys(gainLayers).length) o.envelopes = Object.keys(gainLayers);
      }
      return o;
    });
  return {
    duration: r3(sequenceDuration(p)),
    fps: p.settings.fps,
    tracks: p.tracks.map((t) => ({ track: trackLabel(p, t), id: t.id, name: t.name, ...(t.muted ? { muted: true } : {}), ...(t.volume ? { volume_db: t.volume } : {}) })),
    clips,
    markers: [...p.markers].sort((x, y) => x.time - y.time).map((m) => ({ id: m.id, at: r3(m.time), name: m.name, kind: m.kind ?? 'note', ...(m.duration ? { duration: m.duration } : {}), ...(m.note ? { note: m.note } : {}) })),
  };
}

// ---------------- 9:16 short ----------------

export function buildShort(p: Project, a: { start: number; end: number; layout?: string; captions?: { start: number; end: number; text: string }[]; title?: string; style?: DocStyle }) {
  const d = structuredClone(p);
  const { start, end } = a;
  if (!(end > start)) throw new Error('end must be after start');
  for (const t of d.tracks) t.locked = false;
  const total = sequenceDuration(d);
  if (end < total) rippleDeleteRange(d, end, total + 1);
  if (start > 0) rippleDeleteRange(d, 0, start);
  const W = d.settings.width;
  const H = d.settings.height;
  const W2 = 1080;
  const H2 = 1920;
  const k = W2 / W;
  const layout = a.layout ?? 'panel_top';
  const panelH = H * k;
  const panelY = layout === 'center' ? 0 : -H2 / 2 + 0.16 * H2 + panelH / 2;
  const fitOld = (vw: number, vh: number) => Math.min(W / vw, H / vh);
  const fitNew = (vw: number, vh: number) => Math.min(W2 / vw, H2 / vh);
  const bgSources: Clip[] = [];
  for (const c of d.clips) {
    if (c.kind === 'audio' || c.kind === 'adjustment') continue;
    const m = mediaOf(d, c);
    let sMul = 1;
    if (c.kind === 'video' || c.kind === 'image') {
      const vw = m?.width || W;
      const vh = m?.height || H;
      sMul = (fitOld(vw, vh) * k) / fitNew(vw, vh);
      if (tracksOf(d, 'video')[0]?.id === c.trackId) bgSources.push(c);
    }
    if (c.kind === 'text' && c.text) c.text = { ...c.text, size: Math.round(c.text.size * k), strokeWidth: c.text.strokeWidth * k };
    if (c.kind === 'color') {
      const top = ((H2 / 2 + panelY - panelH / 2) / H2) * 100;
      const bottom = 100 - ((H2 / 2 + panelY + panelH / 2) / H2) * 100;
      c.crop = { ...c.crop, top: Math.max(0, top), bottom: Math.max(0, bottom) };
      continue;
    }
    c.transform = { ...c.transform, x: r3(c.transform.x * k), y: r3(c.transform.y * k + panelY), scale: r3(c.transform.scale * sMul) };
    const kf = c.keyframes;
    if (kf?.x) kf.x = kf.x.map((f) => ({ ...f, v: r3(f.v * k) }));
    if (kf?.y) kf.y = kf.y.map((f) => ({ ...f, v: r3(f.v * k + panelY) }));
    if (kf?.scale) kf.scale = kf.scale.map((f) => ({ ...f, v: r3(f.v * sMul) }));
  }
  // blurred, darkened copy of the footage filling the frame behind the panel
  const firstV = d.tracks.findIndex((t) => t.kind === 'video');
  const bgTrack: Track = { id: nid(d, 'v'), kind: 'video', muted: false, solo: false, locked: false, hidden: false, volume: 0, height: 52, name: 'Short background' };
  d.tracks.splice(Math.max(0, firstV), 0, bgTrack);
  for (const c of bgSources) {
    const m = mediaOf(d, c);
    const vw = m?.width || W;
    const vh = m?.height || H;
    const cover = Math.max(W2 / vw, H2 / vh) / fitNew(vw, vh);
    const bg = makeClip(d, { ...structuredClone(c), id: undefined as any, trackId: bgTrack.id, linkId: null, keyframes: {}, transitionIn: c.transitionIn, transitionOut: c.transitionOut, meta: { role: 'short_bg' } });
    bg.id = nid(d, 'c');
    bg.transform = { ...DEFAULT_TRANSFORM, scale: r3(cover * 100 * 1.05) };
    bg.fx = { ...bg.fx, blur: 40, brightness: -45 };
    bg.grade = c.grade;
    d.clips.push(bg);
  }
  const st = a.style ?? parseStyle();
  const top = () => ensureTrack(d, 'video', tracksOf(d, 'video').length);
  if (a.captions?.length) {
    const tr = top();
    tr.name = 'Captions';
    const y = layout === 'center' ? H2 * 0.3 : panelY + panelH / 2 + 0.11 * H2;
    for (const s of a.captions) {
      const s0 = s.start - start;
      const s1 = Math.min(s.end, end) - start;
      if (s1 <= 0 || s0 >= end - start || s1 - s0 < 0.04) continue;
      const style: TextStyle = { ...DEFAULT_TEXT, content: s.text.toUpperCase(), font: st.font, size: 92, bold: true, color: '#ffffff', strokeColor: '#000000', strokeWidth: 8, shadow: true, backgroundOpacity: 0, align: 'center' };
      d.clips.push(makeClip(d, { kind: 'text', trackId: tr.id, start: r3(Math.max(0, s0)), duration: r3(s1 - Math.max(0, s0)), name: s.text.slice(0, 40), text: style, transform: { ...DEFAULT_TRANSFORM, y: r3(y) }, meta: { role: 'caption' } }));
    }
  }
  if (a.title) {
    const tr = top();
    tr.name = 'Short title';
    const style: TextStyle = { ...DEFAULT_TEXT, content: wrap(a.title, 22), font: st.font, size: 70, bold: true, color: '#ffffff', backgroundColor: '#000000', backgroundOpacity: 0, shadow: true, align: 'center' };
    d.clips.push(makeClip(d, { kind: 'text', trackId: tr.id, start: 0, duration: r3(end - start), name: a.title.slice(0, 40), text: style, transform: { ...DEFAULT_TRANSFORM, y: r3(-H2 / 2 + 0.09 * H2) }, meta: { role: 'title' } }));
  }
  d.settings = { ...d.settings, width: W2, height: H2, name: `${d.settings.name} (Short)` };
  d.inPoint = null;
  d.outPoint = null;
  return d;
}

export function shortFile(d: Project, path: string) {
  const name = path.split(/[\\/]/).pop()!.replace(/\.icut$/i, '');
  return stripForFile({ ...d, path, name });
}

export { findTrack };
