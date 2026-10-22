// Executes IngrainedCut MCP tools against the editor state, and describes the timeline for Claude's context.
import { mediaSrc } from './webBridge';
import type { CallToolResult, Clip, KeyProp, Project, TextStyle, TransitionType } from './types';
import { S, setS, commit, undo, redo, toast, applyStashedMedia } from './store';
import {
  clipEnd, closeGaps, deleteClips, ensureTrack, expandLinked, findTrack, getClip, getTrack, linkedGroup, makeClip, mediaOf,
  placeMedia, razor, rippleDeleteRange, sequenceDuration, shiftClips, splitWithLinks, trackEnd, trackLabel, tracksOf, trimEnd,
  trimStart, clearRegion, nid, assertUnlocked, maxSrc, setClipSpeed, DEFAULT_TEXT, DEFAULT_FX, DEFAULT_TRANSFORM,
} from './ops';
import { fmtTC, r3 } from './time';
import { importPaths, freeVideoTrack, saveProject } from './actions';
import { Compositor } from './compositor';
import { ExportFrames } from './exportFrames';
import { ALL_FORMATS, CanvasSink, Input, UrlSource } from 'mediabunny';
import { engine } from './engine';
import { runExport } from './exporter';
import { ensureLook, gradeIsNeutral } from './grade';
import { syncClips } from './sync';
import { findSilences } from './cutTools';
import { autoColor } from './colorActions';

// ---------------- describing state ----------------

const f2 = (x: number) => (Math.round(x * 100) / 100).toFixed(2);

function nonDefault(obj: Record<string, any>, def: Record<string, any>) {
  const out: string[] = [];
  for (const k of Object.keys(def)) if (obj?.[k] !== undefined && obj[k] !== def[k]) out.push(`${k}=${obj[k]}`);
  return out;
}

export function clipLine(p: Project, c: Clip) {
  const parts = [`${c.id} ${c.kind}`];
  if (c.kind === 'text' && c.text) parts.push(JSON.stringify(c.text.content.length > 40 ? c.text.content.slice(0, 40) + '…' : c.text.content));
  else if (c.kind === 'color') parts.push(c.color || '');
  else parts.push(JSON.stringify(c.name));
  parts.push(`${f2(c.start)}→${f2(clipEnd(c))}`);
  if (c.mediaId) parts.push(`src ${f2(c.in)}–${f2(c.in + c.duration * c.speed)} (${c.mediaId})`);
  if (c.speed !== 1) parts.push(`speed ${c.speed}x`);
  if (c.linkId) parts.push(`link ${c.linkId}`);
  if (!c.enabled) parts.push('DISABLED');
  if (c.kind === 'audio' || c.kind === 'video') {
    if (c.volume && c.kind === 'audio') parts.push(`vol ${c.volume}dB`);
  }
  if (c.fadeIn) parts.push(`fadeIn ${c.fadeIn}`);
  if (c.fadeOut) parts.push(`fadeOut ${c.fadeOut}`);
  if (c.transitionIn) parts.push(`transIn ${c.transitionIn.type} ${c.transitionIn.duration}s`);
  if (c.transitionOut) parts.push(`transOut ${c.transitionOut.type} ${c.transitionOut.duration}s`);
  if (c.kind !== 'audio') {
    const t = nonDefault(c.transform, DEFAULT_TRANSFORM);
    if (t.length) parts.push(`transform{${t.join(',')}}`);
    const fx = nonDefault(c.fx, DEFAULT_FX);
    if (fx.length) parts.push(`fx{${fx.join(',')}}`);
    if (c.blend !== 'normal') parts.push(`blend ${c.blend}`);
    if (c.chromaKey?.enabled) parts.push(`chromaKey ${c.chromaKey.color}`);
    if (!gradeIsNeutral(c.grade)) {
      const g = c.grade!;
      const bits = (['exposure', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance'] as const).filter((k) => g[k]).map((k) => `${k}:${g[k]}`);
      if (g.wheels && Object.values(g.wheels).some((w) => w && (w.x || w.y || w.luma))) bits.push('wheels');
      if (g.curves && Object.values(g.curves).some((v) => v?.length)) bits.push('curves');
      if (g.lut?.intensity) bits.push(`look:${g.lut.id}@${g.lut.intensity}`);
      parts.push(`grade{${bits.join(',')}}`);
    }
  }
  if (c.pan) parts.push(`pan ${c.pan}`);
  const kf = Object.entries(c.keyframes || {}).filter(([, v]) => v && v.length);
  if (kf.length) parts.push(`keyframes{${kf.map(([k, v]) => `${k}:${v!.length}`).join(',')}}`);
  return parts.join(' ');
}

export function describeProject(p: Project, opts: { playhead?: number; selection?: string[] } = {}) {
  const st = p.settings;
  const dur = sequenceDuration(p);
  const lines: string[] = [];
  lines.push(`Sequence "${st.name}": ${st.width}x${st.height} @ ${st.fps}fps, background ${st.background}, duration ${f2(dur)}s (${fmtTC(dur, st.fps)})`);
  lines.push(
    `Playhead ${f2(opts.playhead ?? 0)}s | In ${p.inPoint == null ? '—' : f2(p.inPoint)} | Out ${p.outPoint == null ? '—' : f2(p.outPoint)} | Selected: ${opts.selection?.length ? opts.selection.join(', ') : 'none'}`,
  );
  lines.push(`Project file: ${p.path || '(unsaved)'}`);
  lines.push(`Media bin (${p.media.length}):`);
  for (const m of p.media) {
    const bits = [`${m.id} ${JSON.stringify(m.name)} ${m.type}`];
    if (m.type !== 'image') bits.push(`${f2(m.duration)}s`);
    if (m.width) bits.push(`${m.width}x${m.height}`);
    if (m.type === 'video') bits.push(`${Math.round(m.fps * 100) / 100}fps`);
    if (m.hasAudio && m.type === 'video') bits.push('+audio');
    if (m.status === 'missing') bits.push('MISSING FILE');
    if (m.composition) bits.push(`composition=${m.composition}`);
    bits.push(`path=${m.path}`);
    lines.push('  - ' + bits.join(' '));
  }
  lines.push('Tracks and clips (video tracks: higher number draws on top):');
  const vids = tracksOf(p, 'video').slice().reverse();
  for (const t of [...vids, ...tracksOf(p, 'audio')]) {
    const flags = [t.muted && 'muted', t.solo && 'solo', t.locked && 'locked', t.hidden && 'hidden', t.volume && `vol ${t.volume}dB`].filter(Boolean);
    const clips = p.clips.filter((c) => c.trackId === t.id).sort((a, b) => a.start - b.start);
    lines.push(`  ${trackLabel(p, t)} (id ${t.id})${flags.length ? ' [' + flags.join(', ') + ']' : ''}: ${clips.length ? '' : 'empty'}`);
    for (const c of clips) lines.push('    ' + clipLine(p, c));
  }
  if (p.markers.length) {
    lines.push('Markers:');
    for (const m of [...p.markers].sort((a, b) => a.time - b.time)) lines.push(`  ${m.id} @ ${f2(m.time)}s "${m.name}"${m.note ? ' — ' + m.note : ''}`);
  }
  return lines.join('\n');
}

export function contextBlock() {
  const s = S();
  return `<editor_state>\n${describeProject(s.project, { playhead: s.playhead, selection: s.selection })}\n</editor_state>`;
}

function fullJson(p: Project) {
  const s = S();
  return JSON.stringify(
    {
      settings: p.settings,
      playhead: r3(s.playhead),
      selection: s.selection,
      in_point: p.inPoint,
      out_point: p.outPoint,
      duration: r3(sequenceDuration(p)),
      media: p.media.map(({ peaks, sprite, thumb, url, audioUrl, ...m }) => m),
      tracks: p.tracks.map((t) => ({ ...t, label: trackLabel(p, t) })),
      clips: p.clips
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((c) => ({ ...c, track: trackLabel(p, c.trackId), end: r3(clipEnd(c)) })),
      markers: p.markers,
    },
    null,
    1,
  );
}

// ---------------- helpers ----------------

const txt = (t: string | object): CallToolResult => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) }] });

function diffSummary(before: Project, after: Project) {
  const b = new Map(before.clips.map((c) => [c.id, c]));
  const a = new Map(after.clips.map((c) => [c.id, c]));
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [id, c] of a) {
    const old = b.get(id);
    if (!old) added.push(clipLine(after, c) + ` on ${trackLabel(after, c.trackId)}`);
    else if (JSON.stringify(old) !== JSON.stringify(c)) changed.push(clipLine(after, c) + ` on ${trackLabel(after, c.trackId)}`);
  }
  for (const id of b.keys()) if (!a.has(id)) removed.push(id);
  const ids = [...a.keys()].filter((id) => !b.has(id) || JSON.stringify(b.get(id)) !== JSON.stringify(a.get(id)));
  return { added, changed, removed, ids };
}

function textStyleFrom(a: any, base: TextStyle): TextStyle {
  if (!a) return base;
  const s = { ...base };
  const map: Record<string, keyof TextStyle> = {
    content: 'content', font: 'font', size: 'size', color: 'color', bold: 'bold', italic: 'italic', align: 'align',
    stroke_color: 'strokeColor', stroke_width: 'strokeWidth', background_color: 'backgroundColor', background_opacity: 'backgroundOpacity', shadow: 'shadow',
  };
  for (const [k, v] of Object.entries(a)) if (v !== undefined && map[k]) (s as any)[map[k]] = v;
  return s;
}

function defaultText(p: Project, content: string): TextStyle {
  return { ...DEFAULT_TEXT, content, size: Math.round((96 * p.settings.height) / 1080) };
}

function trackIds(d: Project, refs?: string[]) {
  return refs?.length ? refs.map((r) => getTrack(d, r).id) : undefined;
}

// ---------------- mutating tools (usable inside batch) ----------------

type Mut = (d: Project, a: any, after: { playhead?: number; select?: string[] }) => any;

const MUT: Record<string, { label: (a: any) => string; run: Mut }> = {
  add_clip: {
    label: () => 'Claude: Add Clip',
    run: (d, a) => {
      const m = d.media.find((x) => x.id === a.media_id);
      if (!m) throw new Error(`Media ${a.media_id} not found. Bin: ${d.media.map((x) => x.id).join(', ') || 'empty'}`);
      let vt: string | undefined;
      let at: string | undefined;
      let start = a.start ?? (a.at_playhead ? S().playhead : undefined);
      if (a.track === 'auto') {
        const at0 = start ?? 0;
        const dur = a.duration ?? (m.type === 'image' ? 5 : (a.source_out ?? m.duration) - (a.source_in ?? 0));
        vt = freeVideoTrack(d, at0, Math.max(0.04, dur)).id;
        start = at0;
      } else if (a.track) {
        const tr = getTrack(d, a.track);
        if (tr.kind === 'video') vt = tr.id;
        else at = tr.id;
      }
      if (a.audio_track) at = getTrack(d, a.audio_track).id;
      if (start == null) {
        const tid = vt || at || (m.type === 'audio' ? tracksOf(d, 'audio')[0]?.id : tracksOf(d, 'video')[0]?.id);
        start = tid ? trackEnd(d, tid) : 0;
      }
      const clips = placeMedia(d, m, {
        videoTrackId: vt, audioTrackId: at, start, srcIn: a.source_in, srcOut: a.source_out, duration: a.duration,
        includeAudio: a.include_audio, includeVideo: a.include_video, mode: a.mode,
      });
      return { created: clips.map((c) => c.id) };
    },
  },
  add_text: {
    label: () => 'Claude: Add Text',
    run: (d, a) => {
      const tr = a.track ? getTrack(d, a.track) : freeVideoTrack(d, a.start, a.duration);
      if (tr.kind !== 'video') throw new Error('Text must go on a video track');
      assertUnlocked(d, tr.id);
      clearRegion(d, tr.id, a.start, a.start + a.duration);
      const style = textStyleFrom(a.style, defaultText(d, a.text));
      style.content = a.text;
      const c = makeClip(d, {
        kind: 'text', trackId: tr.id, start: a.start, duration: a.duration, name: a.text.split('\n')[0].slice(0, 40), text: style,
        transform: { ...DEFAULT_TRANSFORM, ...(a.transform || {}) }, fadeIn: a.fade_in ?? 0, fadeOut: a.fade_out ?? 0,
      });
      d.clips.push(c);
      return { created: [c.id], track: trackLabel(d, tr) };
    },
  },
  add_captions: {
    label: () => 'Claude: Add Captions',
    run: (d, a) => {
      const tr = ensureTrack(d, 'video', tracksOf(d, 'video').length);
      tr.name = 'Captions';
      const created: string[] = [];
      const y = a.y ?? d.settings.height * 0.35;
      for (const s of a.segments) {
        if (s.end <= s.start) continue;
        const style = textStyleFrom(a.style, {
          ...defaultText(d, s.text), size: Math.round(d.settings.height * 0.05), bold: true, shadow: false, backgroundOpacity: 55, backgroundColor: '#000000',
        });
        style.content = s.text;
        const c = makeClip(d, { kind: 'text', trackId: tr.id, start: s.start, duration: s.end - s.start, name: s.text.slice(0, 40), text: style, transform: { ...DEFAULT_TRANSFORM, y } });
        d.clips.push(c);
        created.push(c.id);
      }
      return { track: trackLabel(d, tr), created: created.length };
    },
  },
  add_color_matte: {
    label: () => 'Claude: Add Color Matte',
    run: (d, a) => {
      const tr = a.track ? getTrack(d, a.track) : freeVideoTrack(d, a.start, a.duration);
      clearRegion(d, tr.id, a.start, a.start + a.duration);
      const c = makeClip(d, { kind: 'color', trackId: tr.id, start: a.start, duration: a.duration, name: 'Color Matte', color: a.color });
      d.clips.push(c);
      return { created: [c.id] };
    },
  },
  add_adjustment_layer: {
    label: () => 'Claude: Add Adjustment Layer',
    run: (d, a) => {
      const tr = a.track ? getTrack(d, a.track) : freeVideoTrack(d, a.start, a.duration);
      clearRegion(d, tr.id, a.start, a.start + a.duration);
      const c = makeClip(d, { kind: 'adjustment', trackId: tr.id, start: a.start, duration: a.duration, name: 'Adjustment Layer', fx: { ...DEFAULT_FX, ...(a.effects || {}) } });
      d.clips.push(c);
      return { created: [c.id] };
    },
  },
  move_clip: {
    label: () => 'Claude: Move Clip',
    run: (d, a) => {
      const c = getClip(d, a.clip_id);
      const group = a.move_linked === false ? [c] : linkedGroup(d, c);
      const dt = (a.start ?? c.start) - c.start;
      let dIdx = 0;
      if (a.track) {
        const nt = getTrack(d, a.track);
        const ot = d.tracks.find((t) => t.id === c.trackId)!;
        if (nt.kind !== ot.kind) throw new Error(`Cannot move a ${ot.kind} clip to ${trackLabel(d, nt)}`);
        dIdx = tracksOf(d, nt.kind).indexOf(nt) - tracksOf(d, ot.kind).indexOf(ot);
      }
      const ids = new Set(group.map((g) => g.id));
      for (const g of group) {
        const ot = d.tracks.find((t) => t.id === g.trackId)!;
        const list = tracksOf(d, ot.kind);
        const idx = list.indexOf(ot) + (ot.kind === d.tracks.find((t) => t.id === c.trackId)!.kind ? dIdx : 0);
        const nt = ensureTrack(d, ot.kind, Math.max(0, idx));
        assertUnlocked(d, nt.id);
        const ns = Math.max(0, g.start + dt);
        clearRegion(d, nt.id, ns, ns + g.duration, ids);
        g.trackId = nt.id;
        g.start = ns;
      }
      return { moved: [...ids] };
    },
  },
  trim_clip: {
    label: () => 'Claude: Trim Clip',
    run: (d, a) => {
      const c = getClip(d, a.clip_id);
      const group = linkedGroup(d, c).filter((g) => Math.abs(g.start - c.start) < 1e-3 && Math.abs(clipEnd(g) - clipEnd(c)) < 1e-3);
      const tracks = [...new Set(group.map((g) => g.trackId))];
      const ids = new Set(group.map((g) => g.id));
      for (const g of group) assertUnlocked(d, g.trackId);
      if (a.new_end != null) {
        const oldEnd = clipEnd(c);
        for (const g of group) trimEnd(d, g, a.new_end);
        const delta = clipEnd(c) - oldEnd;
        if (a.ripple) shiftClips(d, tracks, oldEnd - 1e-6, delta, ids);
        else if (delta > 0) for (const g of group) clearRegion(d, g.trackId, oldEnd, clipEnd(g), ids);
      }
      if (a.new_start != null) {
        const oldStart = c.start;
        for (const g of group) trimStart(d, g, a.new_start);
        const delta = c.start - oldStart;
        if (a.ripple) {
          for (const g of group) g.start -= delta;
          shiftClips(d, tracks, clipEnd(c) + delta - 1e-6, -delta, ids);
        } else if (delta < 0) for (const g of group) clearRegion(d, g.trackId, g.start, oldStart, ids);
      }
      return { clip: c.id, start: r3(c.start), end: r3(clipEnd(c)) };
    },
  },
  split_clip: {
    label: () => 'Claude: Split',
    run: (d, a) => {
      if (a.clip_id) return { created: splitWithLinks(d, [a.clip_id], a.time) };
      if (a.track) return { created: razor(d, a.time, [getTrack(d, a.track).id]) };
      return { created: razor(d, a.time) };
    },
  },
  delete_clips: {
    label: (a) => (a.ripple ? 'Claude: Ripple Delete' : 'Claude: Delete'),
    run: (d, a) => {
      for (const id of a.clip_ids) getClip(d, id);
      const ids = a.include_linked === false ? a.clip_ids : expandLinked(d, a.clip_ids);
      deleteClips(d, ids, !!a.ripple);
      return { deleted: ids };
    },
  },
  ripple_delete_range: {
    label: () => 'Claude: Ripple Delete Range',
    run: (d, a) => {
      rippleDeleteRange(d, a.start, a.end, trackIds(d, a.tracks));
      return { removed_seconds: r3(a.end - a.start) };
    },
  },
  ripple_delete_ranges: {
    label: (a) => `Claude: Remove ${a.ranges?.length ?? 0} Ranges`,
    run: (d, a) => {
      const rs = [...a.ranges].filter((r: any) => r.end > r.start).sort((x: any, y: any) => x.start - y.start);
      const merged: { start: number; end: number }[] = [];
      for (const r of rs) {
        const last = merged[merged.length - 1];
        if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
        else merged.push({ start: r.start, end: r.end });
      }
      const tids = trackIds(d, a.tracks);
      let total = 0;
      for (const r of merged.reverse()) {
        rippleDeleteRange(d, r.start, r.end, tids);
        total += r.end - r.start;
      }
      return { ranges_removed: merged.length, removed_seconds: r3(total), new_duration: r3(sequenceDuration(d)) };
    },
  },
  close_gaps: {
    label: () => 'Claude: Close Gaps',
    run: (d, a) => {
      closeGaps(d, trackIds(d, a.tracks));
      return { duration: r3(sequenceDuration(d)) };
    },
  },
  set_clip_properties: {
    label: () => 'Claude: Clip Properties',
    run: (d, a) => {
      const P = a.properties || {};
      for (const id of a.clip_ids) {
        const c = getClip(d, id);
        assertUnlocked(d, c.trackId);
        if (P.name != null) c.name = P.name;
        if (P.enabled != null) c.enabled = P.enabled;
        if (P.volume_db != null) c.volume = Math.max(-60, Math.min(24, P.volume_db));
        if (P.pan != null) c.pan = P.pan;
        if (P.fade_in != null) c.fadeIn = Math.max(0, P.fade_in);
        if (P.fade_out != null) c.fadeOut = Math.max(0, P.fade_out);
        if (P.source_in != null) c.in = Math.max(0, Math.min(P.source_in, maxSrc(d, c) - c.duration * c.speed));
        if (P.transform) c.transform = { ...c.transform, ...P.transform };
        if (P.effects) c.fx = { ...c.fx, ...P.effects };
        if (P.crop) c.crop = { ...c.crop, ...P.crop };
        if (P.blend_mode) c.blend = P.blend_mode;
        if (P.text) {
          if (c.kind !== 'text') throw new Error(`${id} is not a text clip`);
          c.text = textStyleFrom(P.text, c.text!);
          if (P.text.content) c.name = P.text.content.split('\n')[0].slice(0, 40);
        }
        if (P.color) c.color = P.color;
        if (P.label) c.label = P.label;
        if (P.chroma_key) c.chromaKey = { enabled: true, color: '#00ff00', tolerance: 30, softness: 15, ...(c.chromaKey || {}), ...P.chroma_key };
        if (P.color_grade) {
          const g = c.grade ?? {};
          const n = P.color_grade;
          c.grade = {
            ...g,
            ...n,
            wheels: n.wheels ? { ...(g.wheels ?? {}), ...Object.fromEntries(Object.entries(n.wheels).map(([k, w]: [string, any]) => [k, { x: 0, y: 0, luma: 0, ...((g.wheels as any)?.[k] ?? {}), ...w }])) } : g.wheels,
            curves: n.curves ? { ...(g.curves ?? {}), ...n.curves } : g.curves,
          };
        }
        if (P.look) {
          if (P.look === 'none') c.grade = { ...(c.grade ?? {}), lut: undefined };
          else {
            ensureLook(d, P.look);
            c.grade = { ...(c.grade ?? {}), lut: { id: P.look, intensity: P.look_intensity ?? 100 } };
          }
        } else if (P.look_intensity != null && c.grade?.lut) c.grade = { ...c.grade, lut: { ...c.grade.lut, intensity: P.look_intensity } };
        if (P.speed != null && P.speed > 0 && P.speed !== c.speed) setClipSpeed(d, c.id, P.speed, P.speed_ripple !== false);
      }
      return { updated: a.clip_ids };
    },
  },
  add_transition: {
    label: () => 'Claude: Add Transition',
    run: (d, a) => {
      const type: TransitionType = a.type || 'cross-dissolve';
      const edge = a.edge || 'in';
      for (const id of a.clip_ids) {
        const c = getClip(d, id);
        const dur = Math.min(a.duration ?? 1, c.duration);
        if (edge !== 'out') c.transitionIn = { type, duration: dur };
        if (edge !== 'in') c.transitionOut = { type, duration: dur };
      }
      return { ok: true };
    },
  },
  remove_transition: {
    label: () => 'Claude: Remove Transition',
    run: (d, a) => {
      for (const id of a.clip_ids) {
        const c = getClip(d, id);
        if (a.edge !== 'out') c.transitionIn = null;
        if (a.edge !== 'in') c.transitionOut = null;
      }
      return { ok: true };
    },
  },
  set_keyframes: {
    label: (a) => `Claude: Animate ${a.property}`,
    run: (d, a) => {
      const c = getClip(d, a.clip_id);
      c.keyframes = c.keyframes || {};
      const prop = a.property as KeyProp;
      if (!a.keyframes.length) delete c.keyframes[prop];
      else c.keyframes[prop] = a.keyframes.map((k: any) => ({ t: k.time - c.start, v: k.value, ease: k.ease || 'linear' })).sort((x: any, y: any) => x.t - y.t);
      return { clip: c.id, property: prop, keyframes: a.keyframes.length };
    },
  },
  manage_tracks: {
    label: (a) => `Claude: ${a.action === 'add' ? 'Add' : a.action === 'remove' ? 'Remove' : 'Set'} Track`,
    run: (d, a) => {
      if (a.action === 'add') {
        const kind = a.kind || 'video';
        const t = ensureTrack(d, kind, tracksOf(d, kind).length);
        return { added: trackLabel(d, t) };
      }
      const t = getTrack(d, a.track);
      if (a.action === 'remove') {
        if (tracksOf(d, t.kind).length <= 1) throw new Error('Cannot remove the last track of its kind');
        d.clips = d.clips.filter((c) => c.trackId !== t.id);
        d.tracks = d.tracks.filter((x) => x.id !== t.id);
        return { removed: a.track };
      }
      if (a.muted != null) t.muted = a.muted;
      if (a.solo != null) t.solo = a.solo;
      if (a.locked != null) t.locked = a.locked;
      if (a.hidden != null) t.hidden = a.hidden;
      if (a.volume_db != null) t.volume = a.volume_db;
      return { track: trackLabel(d, t), ...t };
    },
  },
  markers: {
    label: (a) => `Claude: ${a.action} marker`,
    run: (d, a) => {
      if (a.action === 'clear') {
        d.markers = [];
        return { cleared: true };
      }
      if (a.action === 'remove') {
        d.markers = d.markers.filter((m) => m.id !== a.marker_id && !(a.marker_id == null && a.time != null && Math.abs(m.time - a.time) < 0.01));
        return { ok: true };
      }
      const m = { id: nid(d, 'k'), time: a.time ?? S().playhead, name: a.name || `Marker ${d.markers.length + 1}`, color: a.color || '#3bb26b', note: a.note };
      d.markers.push(m);
      return { marker: m.id };
    },
  },
  set_playhead: {
    label: () => 'Claude: In/Out',
    run: (d, a, after) => {
      if (a.in_point !== undefined) d.inPoint = a.in_point;
      if (a.out_point !== undefined) d.outPoint = a.out_point;
      if (a.time != null) after.playhead = a.time;
      return { playhead: a.time ?? S().playhead, in: d.inPoint, out: d.outPoint };
    },
  },
  set_sequence_settings: {
    label: () => 'Claude: Sequence Settings',
    run: (d, a) => {
      const st = d.settings;
      if (a.width) st.width = Math.round(a.width / 2) * 2;
      if (a.height) st.height = Math.round(a.height / 2) * 2;
      if (a.fps) st.fps = a.fps;
      if (a.background) st.background = a.background;
      if (a.name) st.name = a.name;
      return st;
    },
  },
  remove_silence: {
    label: (a) => (a.dry_run ? 'Claude: Find Silence' : 'Claude: Remove Silence'),
    run: (d, a) => {
      const ranges = findSilences(d, { thresholdDb: a.threshold_db ?? -40, minDuration: a.min_duration ?? 0.6, padding: a.padding ?? 0.12, clipIds: a.clip_ids });
      if (!a.dry_run) for (const r of [...ranges].sort((x, y) => y.start - x.start)) rippleDeleteRange(d, r.start, r.end);
      return { removed: !a.dry_run, ranges: ranges.map((r) => [r3(r.start), r3(r.end)]), total_seconds: r3(ranges.reduce((t, r) => t + r.end - r.start, 0)) };
    },
  },
  select_clips: {
    label: () => '',
    run: (_d, a, after) => {
      after.select = a.clip_ids;
      return { selected: a.clip_ids };
    },
  },
};

// ---------------- frame capture ----------------

/**
 * Captures run one at a time. They used to share one compositor, so parallel calls could draw or read out each
 * other's frames.
 */
let captureQueue: Promise<unknown> = Promise.resolve();
function serially<T>(fn: () => Promise<T>): Promise<T> {
  const run = captureQueue.then(fn, fn);
  captureQueue = run.catch(() => {});
  return run;
}

/**
 * Render timeline frames the way export does: every video clip's exact source frame is decoded with WebCodecs.
 * Seeking a <video> element could hand back the previous frame, which showed up as stuck frames in slowed clips.
 */
async function renderTimelineFrames(p: Project, times: number[], w: number, h: number, each: (canvas: HTMLCanvasElement, i: number) => void) {
  const comp = new Compositor();
  comp.setSize(w, h);
  // the decoders stream frames in time order; report them back in the caller's order
  const order = times.map((t, i) => [t, i] as const).sort((a, b) => a[0] - b[0]);
  comp.frames = new ExportFrames(p, order.map(([t]) => t));
  try {
    for (let k = 0; k < order.length; k++) {
      await comp.frames.beforeFrame(k);
      await comp.render(p, order[k][0], 'export');
      each(comp.canvas, order[k][1]);
    }
  } finally {
    comp.frames.close();
    comp.dispose();
  }
}

function captureFrame(t: number, width: number) {
  return serially(async () => {
    const p = S().project;
    const w = Math.min(1920, Math.max(160, width));
    let data = '';
    await renderTimelineFrames(p, [t], w, Math.round((w * p.settings.height) / p.settings.width / 2) * 2, (cv) => {
      data = cv.toDataURL('image/jpeg', 0.85).split(',')[1];
    });
    return data;
  });
}

async function mediaFrame(url: string, kind: string, times: number[], tileW: number, tileH: number, draw: (img: CanvasImageSource, w: number, h: number, i: number) => void) {
  if (kind === 'image') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();
    times.forEach((_, i) => draw(img, img.naturalWidth, img.naturalHeight, i));
    return;
  }
  // exact frames with WebCodecs where possible (sorted timestamps stream through one decoder)
  try {
    const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(new URL(url, location.href).href) });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (track && (await track.canDecode())) {
        const offset = await track.getFirstTimestamp();
        const order = times.map((t, i) => [t, i] as const).sort((a, b) => a[0] - b[0]);
        const sink = new CanvasSink(track, { width: tileW * 2, height: tileH * 2, fit: 'contain' });
        let k = 0;
        for await (const frame of sink.canvasesAtTimestamps(order.map(([t]) => t + offset))) {
          const i = order[k++][1];
          if (frame) draw(frame.canvas, frame.canvas.width, frame.canvas.height, i);
        }
        return;
      }
    } finally {
      input.dispose();
    }
  } catch (e) {
    console.warn('contact sheet: WebCodecs unavailable, seeking a <video> instead', e);
  }
  const v = document.createElement('video');
  v.crossOrigin = 'anonymous';
  v.muted = true;
  v.preload = 'auto';
  v.src = url;
  await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }));
  for (let i = 0; i < times.length; i++) {
    await new Promise<void>((r) => {
      const to = setTimeout(r, 3000);
      v.addEventListener('seeked', () => (clearTimeout(to), r()), { once: true });
      v.currentTime = times[i];
    });
    draw(v, v.videoWidth, v.videoHeight, i);
  }
  v.removeAttribute('src');
  v.load();
}

function contactSheet(a: any) {
  return serially(() => buildContactSheet(a));
}

async function buildContactSheet(a: any) {
  const s = S();
  const p = s.project;
  const count = Math.max(1, Math.min(30, Math.round(a.count ?? 12)));
  let start = a.start ?? 0;
  let end: number;
  let aspect = p.settings.width / p.settings.height;
  const media = a.media_id ? p.media.find((m) => m.id === a.media_id) : null;
  if (a.media_id && !media) throw new Error(`Media ${a.media_id} not found`);
  if (media) {
    end = a.end ?? (media.duration || 0);
    if (media.width) aspect = media.width / media.height;
  } else end = a.end ?? sequenceDuration(p);
  if (end <= start) end = start + 0.001;
  const times = Array.from({ length: count }, (_, i) => (count === 1 ? start : start + ((end - start) * (i + 0.5)) / count));
  const cols = count <= 3 ? count : count <= 8 ? 4 : count <= 15 ? 5 : 6;
  const rows = Math.ceil(count / cols);
  const tileW = 300;
  const tileH = Math.round(tileW / aspect);
  const labelH = 18;
  const sheet = document.createElement('canvas');
  sheet.width = cols * tileW;
  sheet.height = rows * (tileH + labelH);
  const sc = sheet.getContext('2d')!;
  sc.fillStyle = '#111';
  sc.fillRect(0, 0, sheet.width, sheet.height);
  const label = (i: number) => {
    const x = (i % cols) * tileW;
    const y = Math.floor(i / cols) * (tileH + labelH) + tileH;
    sc.fillStyle = '#000';
    sc.fillRect(x, y, tileW, labelH);
    sc.fillStyle = '#ffd24a';
    sc.font = '12px monospace';
    sc.fillText(`#${i + 1}  ${times[i].toFixed(2)}s  ${fmtTC(times[i], p.settings.fps)}`, x + 6, y + 13);
  };
  if (media) {
    await mediaFrame(mediaSrc(media.url), media.type, times, tileW, tileH, (img, w, h, i) => {
      const x = (i % cols) * tileW;
      const y = Math.floor(i / cols) * (tileH + labelH);
      const fit = Math.min(tileW / w, tileH / h);
      sc.drawImage(img, x + (tileW - w * fit) / 2, y + (tileH - h * fit) / 2, w * fit, h * fit);
      label(i);
    });
  } else {
    await renderTimelineFrames(p, times, tileW, tileH, (cv, i) => {
      sc.drawImage(cv, (i % cols) * tileW, Math.floor(i / cols) * (tileH + labelH));
      label(i);
    });
  }
  return { data: sheet.toDataURL('image/jpeg', 0.82).split(',')[1], times };
}

// ---------------- dispatcher ----------------

function applyAfter(after: { playhead?: number; select?: string[] }) {
  if (after.playhead != null) engine.seek(after.playhead);
  if (after.select) setS({ selection: after.select.filter((id) => S().project.clips.some((c) => c.id === id)) });
}

function runMutation(label: string, fn: (d: Project, after: any) => any) {
  const before = S().project;
  const after: { playhead?: number; select?: string[] } = {};
  let result: any;
  const draft = structuredClone(before);
  result = fn(draft, after);
  const diff = diffSummary(before, draft);
  const changedProject = JSON.stringify(before) !== JSON.stringify(draft);
  if (changedProject) commit(label, (d) => Object.assign(d, draft), { by: 'claude', flash: diff.ids });
  applyAfter(after);
  const out: any = { ok: true, result };
  if (diff.added.length) out.added = diff.added;
  if (diff.changed.length) out.changed = diff.changed.slice(0, 60);
  if (diff.removed.length) out.removed = diff.removed;
  out.sequence_duration = r3(sequenceDuration(S().project));
  return out;
}

export async function runTool(name: string, a: any): Promise<CallToolResult> {
  const s = S();
  if (MUT[name]) return txt(runMutation(MUT[name].label(a), (d, after) => MUT[name].run(d, a, after)));
  switch (name) {
    case 'get_project_state':
      return txt(a.detail === 'summary' ? describeProject(s.project, { playhead: s.playhead, selection: s.selection }) : fullJson(s.project));
    case 'batch': {
      const ops: { tool: string; args: any }[] = a.operations || [];
      for (const op of ops) if (!MUT[op.tool]) throw new Error(`"${op.tool}" cannot be used inside batch. Allowed: ${Object.keys(MUT).join(', ')}`);
      const label = `Claude: ${ops.length} edits`;
      return txt(
        runMutation(label, (d, after) =>
          ops.map((op, i) => {
            try {
              return { step: i + 1, tool: op.tool, ...MUT[op.tool].run(d, op.args || {}, after) };
            } catch (e: any) {
              throw new Error(`Step ${i + 1} (${op.tool}) failed: ${e.message}. No changes were applied.`);
            }
          }),
        ),
      );
    }
    case 'import_media': {
      const items = await importPaths(a.paths, { ...(a.composition ? { composition: a.composition } : {}), ...(a.name ? { name: a.name } : {}) });
      return txt({ imported: items.map((m) => ({ id: m.id, name: m.name, type: m.type, duration: r3(m.duration), width: m.width, height: m.height, fps: m.fps, has_audio: m.hasAudio })) });
    }
    case 'capture_frame': {
      const t = a.time ?? s.playhead;
      const data = await captureFrame(t, a.width ?? 960);
      return { content: [{ type: 'image', data, mimeType: 'image/jpeg' }, { type: 'text', text: `Program output at ${r3(t)}s (${fmtTC(t, s.project.settings.fps)})` }] };
    }
    case 'capture_contact_sheet': {
      const { data, times } = await contactSheet(a);
      return { content: [{ type: 'image', data, mimeType: 'image/jpeg' }, { type: 'text', text: `${times.length} frames at ${a.media_id ? 'source' : 'timeline'} times: ${times.map((t) => t.toFixed(2)).join(', ')}` }] };
    }
    case 'screenshot_editor': {
      // web version: the browser tab renders itself (the desktop app captures its window natively)
      const { toJpeg } = await import('html-to-image');
      const w = Math.min(1600, document.documentElement.clientWidth);
      const url = await toJpeg(document.body, { quality: 0.82, pixelRatio: w / document.documentElement.clientWidth, skipFonts: true, backgroundColor: '#121212' });
      return { content: [{ type: 'image', data: url.split(',')[1], mimeType: 'image/jpeg' }] };
    }
    case 'relink_media': {
      const m = s.project.media.find((x) => x.id === a.media_id);
      if (!m) throw new Error(`Media ${a.media_id} not found`);
      const [r] = await window.icut.importMedia([{ id: m.id, path: a.path }]);
      if (!r?.ok) throw new Error(`Could not read ${a.path}: ${r?.error ?? 'unknown error'}`);
      const before = s.project.clips.filter((c) => c.mediaId === m.id).map((c) => c.id);
      commit(
        `Claude: Relink ${m.name}`,
        (d) => {
          const i = d.media.findIndex((x) => x.id === m.id);
          d.media[i] = { ...d.media[i], ...r.info, name: d.media[i].name, id: m.id, status: 'loading', ...(a.composition ? { composition: a.composition } : {}) };
        },
        { by: 'claude', flash: before },
      );
      applyStashedMedia();
      return txt({ relinked: m.id, path: a.path, duration: r3(r.info.duration), clips_updated: before });
    }
    case 'undo': {
      const labels = s.past.slice(-(a.steps ?? 1)).map((h) => h.label).reverse();
      const n = undo(a.steps ?? 1);
      return txt({ undone: n, edits: labels.slice(0, n) });
    }
    case 'redo': {
      const n = redo(a.steps ?? 1);
      return txt({ redone: n });
    }
    case 'sync_clips': {
      const r = await syncClips(a.clip_ids || [], a.method || 'audio', { referenceId: a.reference_clip_id, link: !!a.link });
      return txt({ ...r, moved: r.moved.map((m) => ({ ...m, by: r3(m.by) })) });
    }
    case 'auto_color': {
      await autoColor(a.clip_id);
      const c = S().project.clips.find((x) => x.id === a.clip_id);
      if (!c) throw new Error(`Clip ${a.clip_id} not found`);
      return txt({ clip: c.id, exposure: c.grade?.exposure ?? 0, whites: c.grade?.whites ?? 0, blacks: c.grade?.blacks ?? 0, temperature: c.fx.temperature, tint: c.fx.tint });
    }
    case 'export_video': {
      const r = await runExport({ path: a.path, format: a.format, quality: a.quality, range: a.range, scale: a.scale });
      return txt({ exported: r.path, size_mb: r3(r.size / 1e6), render_seconds: r3(r.seconds), encoder: r.engine });
    }
    case 'save_project': {
      const p = await saveProject(false, a.path);
      return txt(p ? { saved: p } : 'Save cancelled by the user');
    }
  }
  throw new Error(`Unknown tool ${name}`);
}

export function installToolBridge() {
  return window.icut.onToolInvoke(async ({ id, name, args }) => {
    let result: CallToolResult;
    try {
      result = await runTool(name, args || {});
    } catch (e: any) {
      result = { content: [{ type: 'text', text: 'Error: ' + (e?.message || String(e)) }], isError: true };
    }
    window.icut.toolResult(id, result);
  });
}

export { toast, findTrack, mediaOf };
