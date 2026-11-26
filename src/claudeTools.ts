// Executes IngrainedCut MCP tools against the editor state, and describes the timeline for Claude's context.
import { mediaSrc, isBrowserEngine } from './webBridge';
import type { CallToolResult, Clip, KeyProp, MediaItem, Project, TextStyle, TransitionType } from './types';
import { S, setS, commit, undo, redo, toast, applyStashedMedia, stripForFile } from './store';
import {
  clipEnd, closeGaps, deleteClips, ensureTrack, expandLinked, findTrack, getClip, getTrack, linkedGroup, makeClip, mediaOf,
  placeMedia, razor, rippleDeleteRange, sequenceDuration, shiftClips, splitWithLinks, trackEnd, trackLabel, tracksOf, trimEnd,
  trimStart, clearRegion, nid, assertUnlocked, maxSrc, setClipSpeed, DEFAULT_TEXT, DEFAULT_FX, DEFAULT_TRANSFORM, prevAdjacent, nextAdjacent,
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
import {
  addPanel, addTextCard, ambienceFill, applyCues, applyEdl, applyMotion, applyTemplate, breath, buildShort, checkEdl, clipGrid, cueFile, cueRows, dirOf, duck,
  duckAudio, edlRows, fadeClips, fakeMedia, findMedia, jlCut, linkClips, missingFiles, muteMusicUnder, narrationClips, nextGridPoint, parseCsv, parseStyle,
  resolveCue, roleTrack, shortFile, soloLoudness, splitEdit, timelineListing, timelineLoudness, timelineSilences, transitionType, unlinkClips, CARD_KINDS,
  DEFAULT_STYLE, type DocStyle,
} from './docTools';

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
      for (const c of clips) {
        if (a.volume_db != null && c.kind === 'audio') c.volume = Math.max(-60, Math.min(24, a.volume_db));
        if (a.credit) c.meta = { ...(c.meta ?? {}), credit: a.credit };
      }
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
      const t = transitionType(a.type || 'cross-dissolve');
      const edge = a.edge || 'in';
      const ids: string[] = [...(a.clip_ids ?? [])];
      // the transition at the cut from one clip into the next
      const pair = !!(a.from_clip_id && a.to_clip_id);
      if (pair) {
        const from = getClip(d, a.from_clip_id);
        const to = getClip(d, a.to_clip_id);
        if (from.trackId !== to.trackId || Math.abs(clipEnd(from) - to.start) > 1 / d.settings.fps) throw new Error(`${from.id} and ${to.id} are not next to each other on one track`);
        ids.push(to.id);
      }
      if (!ids.length) throw new Error('Pass clip_ids, or from_clip_id and to_clip_id');
      for (const id of ids) {
        const c = getClip(d, id);
        const inEdge = pair || edge !== 'out';
        const outEdge = !pair && edge !== 'in';
        if (t === 'cut') {
          if (inEdge) c.transitionIn = null;
          if (outEdge) c.transitionOut = null;
          continue;
        }
        const dur = Math.min(a.duration ?? 1, c.duration);
        if (inEdge) c.transitionIn = { type: t, duration: dur };
        if (outEdge) c.transitionOut = { type: t, duration: dur };
      }
      return { ok: true, clips: ids, type: t };
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
      const KIND_COLOR: Record<string, string> = { chapter: '#e0a400', hold: '#7f8fa6', note: '#3bb26b', hook: '#e63946', climax: '#b5179e', beat: '#4895ef' };
      const kind: string | undefined = a.kind || undefined;
      const m = {
        id: nid(d, 'k'), time: a.time ?? S().playhead, name: a.name || `Marker ${d.markers.length + 1}`, color: a.color || KIND_COLOR[kind ?? 'note'] || '#3bb26b', note: a.note,
        ...(kind ? { kind } : {}), ...(a.duration ? { duration: a.duration } : {}),
      };
      if (kind === 'chapter') d.markers = d.markers.filter((x) => !(x.kind === 'chapter' && Math.abs(x.time - m.time) < 0.05));
      d.markers.push(m);
      return { marker: m.id, kind: kind ?? 'note' };
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
  // ---- documentary tools (docTools.ts) ----
  project_template: {
    label: () => 'Claude: Documentary Tracks',
    run: (d, a) => {
      if ((a.template ?? 'doc') !== 'doc') throw new Error('The only template is "doc"');
      return { tracks: applyTemplate(d) };
    },
  },
  set_motion: {
    label: (a) => `Claude: Motion ${a.type}`,
    run: (d, a) => {
      const out: any[] = [];
      for (const id of a.clip_ids ?? [a.clip_id]) {
        const c = getClip(d, id);
        assertUnlocked(d, c.trackId);
        out.push({ clip: id, ...applyMotion(d, c, a.type, a.amount_pct ?? 3, a.ease ?? 'inOut', a.direction) });
      }
      return { clips: out };
    },
  },
  jl_cut: { label: (a) => (a.audio_lead && a.audio_tail ? 'Claude: J/L-Cut' : a.audio_tail ? 'Claude: L-Cut' : 'Claude: J-Cut'), run: (d, a) => jlCut(d, a.clip_id, a.audio_lead, a.audio_tail) },
  link_clips: { label: () => 'Claude: Link', run: (d, a) => linkClips(d, a.clip_ids ?? []) },
  unlink_clips: { label: () => 'Claude: Unlink', run: (d, a) => unlinkClips(d, a.clip_ids ?? []) },
  add_card: {
    label: (a) => `Claude: ${a.kind ?? 'Text'} Card`,
    run: (d, a) => {
      const preset = CARD_KINDS[String(a.kind ?? '').toLowerCase()];
      if (!preset) throw new Error('kind: chapter, date, quote, name or list');
      const [main, ...sub] = String(a.text ?? '').split(/\s*\|\s*/);
      if (!main.trim()) throw new Error('Pass the card text');
      // the style file the main process found (_style: style_path or FraggedIn/style.md), else the add_text defaults
      const style = docStyle(a);
      const dur = a.duration ?? (preset === 'name_super' ? 3 : 4);
      return addTextCard(d, { preset, text: main.replace(/\\n/g, '\n'), subtitle: sub.join(' | ') || undefined, at: a.start ?? S().playhead, dur, style, backdrop: a.backdrop });
    },
  },
  j_cut: { label: () => 'Claude: J-Cut', run: (d, a) => ({ audio: splitEdit(d, a.clip_id, a.frames ?? 10, 'j') }) },
  l_cut: { label: () => 'Claude: L-Cut', run: (d, a) => ({ audio: splitEdit(d, a.clip_id, a.frames ?? 10, 'l') }) },
  add_text_card: {
    label: (a) => `Claude: ${a.preset ?? 'Text Card'}`,
    run: (d, a) => addTextCard(d, { preset: a.preset, text: a.text, subtitle: a.subtitle, at: a.at ?? S().playhead, dur: a.dur ?? 4, style: docStyle(a), marker: a.chapter_marker }),
  },
  add_panel: {
    label: () => 'Claude: Panel',
    run: (d, a) => {
      const m = findMedia(d, a.src ?? '');
      if (!m) throw new Error(`"${a.src}" is not in the bin (pass a media id or bin name; a file path is imported first when add_panel runs on its own, not inside batch)`);
      return addPanel(d, { media: m, at: a.at ?? S().playhead, dur: a.dur ?? 5, position: a.position, scale: a.scale, push: a.push_pct, dim: a.dim, blur: a.blur, source_in: a.source_in });
    },
  },
  duck: { label: (a) => (a.remove ? 'Claude: Remove Ducking' : 'Claude: Duck Music'), run: (d, a) => duck(d, a) },
  duck_audio: { label: () => 'Claude: Duck Audio', run: (d, a) => duckAudio(d, a) },
  breath: { label: () => 'Claude: Breath', run: (d, a) => breath(d, a) },
  mute_music_under: { label: () => 'Claude: Mute Music Under', run: (d, a) => muteMusicUnder(d, a) },
  fade: { label: () => 'Claude: Fade', run: (d, a) => fadeClips(d, a) },
  ambience_fill: {
    label: () => 'Claude: Ambience Fill',
    run: (d, a) => {
      let m = a.src ? findMedia(d, a.src) : undefined;
      if (!a.src) {
        const tr = a.track ? getTrack(d, a.track) : undefined;
        const prev = d.clips.find((c) => c.meta?.role === 'ambience' && (!tr || c.trackId === tr.id));
        m = prev ? mediaOf(d, prev) : undefined;
      }
      if (!m) throw new Error(a.src ? `"${a.src}" is not in the bin` : 'Pass src (the ambience file or bin item)');
      return ambienceFill(d, { media: m, track: a.track, level_db: a.level_db, start: a.start, end: a.end, fade_s: a.fade_s, min_gap: a.min_gap, only_under: a.only_under });
    },
  },
  normalize: {
    label: () => 'Claude: Loudness Target',
    run: (d, a) => {
      d.settings.loudness = a.off ? null : { lufs: a.target_lufs ?? -14, truePeak: a.true_peak ?? -1 };
      return { export_normalizes_to: d.settings.loudness ? `${d.settings.loudness.lufs} LUFS integrated, true peak ≤ ${d.settings.loudness.truePeak} dBTP` : 'off' };
    },
  },
};

let lastStyle: DocStyle | undefined;
/** The card style: style.md text the main process found (`_style`), else the last one seen, else the defaults. */
function docStyle(a: any): DocStyle {
  if (a._style !== undefined) lastStyle = parseStyle(a._style || undefined);
  return lastStyle ?? parseStyle();
}

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
  const MAX = 60;
  let times: number[];
  if (Array.isArray(a.times) && a.times.length) times = a.times.slice(0, MAX).map(Number);
  else if (a.every_s > 0) {
    const n = Math.floor((end - start) / a.every_s) + 1;
    if (n > MAX) throw new Error(`every_s ${a.every_s} gives ${n} frames; at most ${MAX} fit on one sheet — narrow start/end or use a larger every_s`);
    times = Array.from({ length: n }, (_, i) => start + i * a.every_s);
  } else {
    const count = Math.max(1, Math.min(30, Math.round(a.count ?? 12)));
    times = Array.from({ length: count }, (_, i) => (count === 1 ? start : start + ((end - start) * (i + 0.5)) / count));
  }
  const count = times.length;
  const cols = Math.max(1, Math.min(12, a.cols ?? (count <= 3 ? count : count <= 8 ? 4 : count <= 15 ? 5 : 6)));
  const rows = Math.ceil(count / cols);
  const tileW = Math.max(120, Math.min(640, a.width ?? a.tile_width ?? 300));
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
  if (a.save_path) {
    const blob = await new Promise<Blob>((res, rej) => sheet.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the PNG'))), 'image/png'));
    await window.icut.writePng(a.save_path, await blob.arrayBuffer());
  }
  return { data: sheet.toDataURL('image/jpeg', 0.82).split(',')[1], times, saved: a.save_path as string | undefined };
}

// ---------------- dispatcher ----------------

function applyAfter(after: { playhead?: number; select?: string[] }) {
  if (after.playhead != null) engine.seek(after.playhead);
  if (after.select) setS({ selection: after.select.filter((id) => S().project.clips.some((c) => c.id === id)) });
}

/**
 * Run an edit on a copy of the project and commit it as one undo step. dryRun: only report what would change.
 * prepare: set-up on the copy that is not part of the change (stand-in media for a dry run).
 */
function runMutation(label: string, fn: (d: Project, after: any) => any, dryRun = false, prepare?: (d: Project) => void) {
  const before = S().project;
  const after: { playhead?: number; select?: string[] } = {};
  let result: any;
  const draft = structuredClone(before);
  prepare?.(draft);
  const base = prepare ? structuredClone(draft) : before;
  result = fn(draft, after);
  const diff = diffSummary(base, draft);
  if (dryRun) {
    const had = new Set(base.markers.map((m) => m.id));
    const newMarkers = draft.markers.filter((m) => !had.has(m.id));
    return {
      dry_run: true,
      note: 'Nothing was changed: this is what the call would do.',
      result,
      ...(diff.added.length ? { would_add: diff.added } : {}),
      ...(diff.changed.length ? { would_change: diff.changed.slice(0, 80) } : {}),
      ...(diff.removed.length ? { would_remove: diff.removed } : {}),
      ...(newMarkers.length ? { would_add_markers: newMarkers.map((m) => `${m.kind ?? 'note'} @ ${r3(m.time)} "${m.name}"`) } : {}),
      ...(JSON.stringify(base.settings) !== JSON.stringify(draft.settings) ? { would_set: draft.settings } : {}),
      sequence_duration_after: r3(sequenceDuration(draft)),
    };
  }
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

// ---------------- documentary tools that read files or analyse audio ----------------

const GRID_KEY = { beat: 'beats', downbeat: 'downbeats', phrase: 'phrases' } as const;
type GridKind = keyof typeof GRID_KEY;
const gridKind = (g: any): GridKind => {
  const k = String(g ?? 'downbeat').toLowerCase().replace(/s$/, '');
  if (!(k in GRID_KEY)) throw new Error(`grid "${g}": use beat, downbeat or phrase`);
  return k as GridKind;
};
const needText = (a: any, tool: string) => {
  if (a._text == null) throw new Error(`${tool} reads the file on your computer, so it needs the IngrainedCut app or helper`);
};
const musicClips = (p: Project, trackRef?: string) => {
  const tr = trackRef ? getTrack(p, trackRef) : p.tracks.find((t) => t.kind === 'audio' && t.name === 'Music') ?? tracksOf(p, 'audio')[2];
  if (!tr) throw new Error('No music track: pass track (or music_clip_id)');
  return p.clips.filter((c) => c.trackId === tr.id && c.kind === 'audio' && c.enabled).sort((x, y) => x.start - y.start);
};

/** Wait (up to `ms`) until the waveforms of the audio on `trackRef` (default Narration) are ready: ducking reads them. */
async function waitForWaveforms(trackRef?: string, ms = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const p = S().project;
    const tr = trackRef ? findTrack(p, trackRef) : p.tracks.find((t) => t.kind === 'audio' && t.name === 'Narration') ?? tracksOf(p, 'audio')[0];
    const pending = p.clips.filter((c) => c.trackId === tr?.id).map((c) => mediaOf(p, c)).filter((m) => m && m.hasAudio && !m.peaks?.length && m.status !== 'error' && m.status !== 'missing');
    if (!pending.length || Date.now() - t0 > ms) return pending.length === 0;
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** The paths that are files on disk (the rest are reported as "not found" by the import). */
async function existing(paths: string[]) {
  const ok = await Promise.all(paths.map((p) => window.icut.exists(p).catch(() => false)));
  return paths.filter((_, i) => ok[i]);
}

const DOC_ASYNC: Record<string, (a: any) => Promise<CallToolResult>> = {
  import_edl: async (a) => {
    needText(a, 'import_edl');
    const p0 = S().project;
    const rows = edlRows(parseCsv(a._text), p0.settings.fps);
    if (!rows.length) throw new Error(`${a.path}: no rows (the first line must be the column names)`);
    const baseDir = dirOf(a.path);
    const missing = await existing(missingFiles(p0, rows.flatMap((r) => [r.source, r.sfx.split('@')[0].trim()]), baseDir));
    let imported: { id: string; name: string }[] = [];
    if (missing.length && !a.dry_run) imported = (await importPaths(missing)).filter((m) => missing.some((x) => x.toLowerCase() === m.path.toLowerCase())).map((m) => ({ id: m.id, name: m.name }));
    const style = docStyle(a);
    return txt(
      runMutation(
        `Claude: Import EDL (${rows.length} rows)`,
        (d) => ({
          ...(imported.length ? { imported } : {}),
          ...(a.dry_run && missing.length ? { would_import: missing } : {}),
          card_style: style,
          ...applyEdl(d, rows, { baseDir, style, replace: a.replace, template: a.template }),
        }),
        !!a.dry_run,
        a.dry_run && missing.length ? (d) => fakeMedia(d, missing) : undefined,
      ),
    );
  },
  import_cues: async (a) => {
    needText(a, 'import_cues');
    const p0 = S().project;
    const rows = cueRows(parseCsv(a._text), p0.settings.fps);
    if (!rows.length) throw new Error(`${a.path}: no rows (the first line must be the column names)`);
    const baseDir = dirOf(a.path);
    const files: string[] = Array.isArray(a._files) ? a._files : [];
    const missing = await existing(missingFiles(p0, rows.map((r) => cueFile(r, files) ?? '').filter(Boolean), baseDir));
    if (missing.length && !a.dry_run) await importPaths(missing);
    const opts = { baseDir, files, replace: a.replace, template: a.template, duck: !!a.duck };
    // ducking reads the narration's waveform, which is computed in the background after import
    if (!a.dry_run && (a.duck || rows.some((r) => r.duck))) await waitForWaveforms('Narration', 60_000);
    // level_vs_narration_db: measure the narration as placed and each cue's sound at 0 dB
    const rel: Record<string, number> = {};
    const levelNotes: string[] = [];
    if (!a.dry_run && rows.some((r) => r.level != null)) {
      const p = S().project;
      const narr = await soloLoudness(p, narrationClips(p));
      if (narr == null) levelNotes.push('No narration on A3 to measure against: level_vs_narration_db was used as plain gain. Place the narration first, then import the cues again.');
      else {
        const plan = structuredClone(p);
        const placed = applyCues(plan, rows, opts).placed;
        for (const r of rows) {
          if (r.level == null) continue;
          const row = placed.find((x: any) => x.id === r.id);
          let clips: Clip[] = [];
          if (row?.clips?.length && typeof row.clips[0] === 'string') clips = plan.clips.filter((c) => row.clips.includes(c.id));
          else if (r.type === 'clip_audio' && r.tin != null) {
            const t = roleTrack(plan, 'clip_audio');
            clips = plan.clips.filter((c) => c.trackId === t.id && c.kind === 'audio' && c.start < (r.tout ?? Infinity) && clipEnd(c) > r.tin!);
          }
          const own = await soloLoudness(plan, clips, { zero: true, a: r.tin, b: r.tout });
          if (own != null) rel[r.id] = Math.round((narr - own) * 10) / 10;
          else levelNotes.push(`${r.id}: could not measure its loudness (silent?), level used as plain gain`);
        }
        levelNotes.push(`Narration measured at ${Math.round(narr * 10) / 10} LUFS`);
      }
    }
    let toSnap: { clip: string; grid: string }[] = [];
    let toPhrase: { clip: string; end: number }[] = [];
    const out: any = runMutation(
      `Claude: Import Cues (${rows.length} rows)`,
      (d) => {
        const r = applyCues(d, rows, { ...opts, rel });
        toSnap = r.to_snap;
        toPhrase = r.to_phrase;
        const { to_snap, to_phrase, ...rest } = r;
        return {
          ...(a.dry_run && missing.length ? { would_import: missing } : {}),
          ...rest,
          ...(levelNotes.length ? { levels: levelNotes } : {}),
          ...(a.dry_run && rows.some((x) => x.level != null) ? { levels: ['Dry run: level_vs_narration_db is measured against the narration when the import runs'] } : {}),
          ...(to_snap.length ? { snapped_to_grid: to_snap } : {}),
        };
      },
      !!a.dry_run,
      a.dry_run && missing.length ? (d) => fakeMedia(d, missing) : undefined,
    );
    // start the cues with a "snap" column on their next downbeat / phrase (slips the music, the cue keeps its place)
    if (!a.dry_run && toSnap.length) {
      const slips: { clip: string; in: number }[] = [];
      const notes: string[] = [];
      for (const t of toSnap) {
        try {
          const p = S().project;
          const c = getClip(p, t.clip);
          const g = await clipGrid(p, c);
          const k = gridKind(t.grid);
          const s = nextGridPoint(g.source[GRID_KEY[k]], c.in);
          if (s != null && s - c.in < 8) slips.push({ clip: c.id, in: s });
          else notes.push(`${c.id}: no ${k} within 8 s of its in point`);
        } catch (e: any) {
          notes.push(`${t.clip}: ${e.message}`);
        }
      }
      if (slips.length)
        runMutation('Claude: Cues on the Beat', (d) => {
          for (const x of slips) {
            const c = getClip(d, x.clip);
            c.in = x.in;
            const max = mediaOf(d, c)?.duration;
            if (max && c.in + c.duration * c.speed > max) c.duration = Math.max(1 / d.settings.fps, (max - c.in) / c.speed);
          }
          return {};
        });
      out.snapped = slips.map((x) => ({ clip: x.clip, source_in: r3(x.in) }));
      if (notes.length) out.snap_notes = notes;
    }
    // exit cut_on_phrase: end the cue on the music's last phrase boundary (else downbeat) before timeline_out
    if (!a.dry_run && toPhrase.length) {
      const cuts: { clip: string; end: number }[] = [];
      const notes: string[] = [];
      for (const t of toPhrase) {
        try {
          const p = S().project;
          const c = getClip(p, t.clip);
          const g = await clipGrid(p, c);
          const end = clipEnd(c);
          const pickIn = (list: number[]) => [...list].reverse().find((x) => x <= end + 0.25 && x >= end - 4 && x > c.start + 0.5);
          const at = pickIn(g.phrases) ?? pickIn(g.downbeats);
          if (at != null) cuts.push({ clip: c.id, end: at });
          else notes.push(`${c.id}: no phrase or downbeat in the last 4 s`);
        } catch (e: any) {
          notes.push(`${t.clip}: ${e.message}`);
        }
      }
      if (cuts.length)
        runMutation('Claude: Cues on the Phrase', (d) => {
          for (const x of cuts) {
            const c = getClip(d, x.clip);
            trimEnd(d, c, x.end);
            c.fadeOut = Math.min(0.05, c.duration);
          }
          return {};
        });
      out.cut_on_phrase = cuts.map((x) => ({ clip: x.clip, ends_at: r3(x.end) }));
      if (notes.length) out.phrase_notes = notes;
    }
    return txt(out);
  },
  check_edl: async (a) => {
    needText(a, 'check_edl');
    const p = S().project;
    return txt(checkEdl(p, edlRows(parseCsv(a._text), p.settings.fps), a.tolerance_frames ?? 1));
  },
  get_timeline: async (a) => txt(timelineListing(S().project, a)),
  beat_grid: async (a) => {
    const p = S().project;
    const clips = a.clip_id ? [getClip(p, a.clip_id)] : musicClips(p, a.track);
    if (!clips.length) throw new Error('No music clips to analyse');
    const grids: any[] = [];
    for (const c of clips) {
      const { source, ...g } = await clipGrid(p, c);
      grids.push(a.detail === 'summary' ? { ...g, beats: g.beats.length, downbeats: g.downbeats.slice(0, 64), phrases: g.phrases } : g);
    }
    let markers: number | undefined;
    if (a.markers && a.markers !== 'none') {
      const k = gridKind(a.markers);
      const times = grids.flatMap((g: any) => (Array.isArray(g[GRID_KEY[k]]) ? g[GRID_KEY[k]] : []));
      runMutation(`Claude: ${k} markers`, (d) => {
        d.markers = d.markers.filter((m) => m.kind !== 'beat');
        for (const t of times) d.markers.push({ id: nid(d, 'k'), time: t, name: k, color: '#4895ef', kind: 'beat' });
        return {};
      });
      markers = times.length;
    }
    return txt({ grids, ...(markers != null ? { markers_added: markers } : {}), note: 'Times are timeline seconds. Beat tracking is automatic: check the downbeats by ear on tracks with a soft intro.' });
  },
  snap_to_beat: async (a) => {
    const p = S().project;
    const c = getClip(p, a.clip_id);
    const k = gridKind(a.grid);
    const onMusic = musicClips(p, a.track).some((m) => m.id === c.id);
    if (onMusic && a.target != null) {
      // move this music clip so one of its downbeats lands on `target`
      const g: any = await clipGrid(p, c);
      const list: number[] = g[GRID_KEY[k]];
      if (!list.length) throw new Error(`No ${k}s found in ${c.id}`);
      const near = list.reduce((x, y) => (Math.abs(y - a.target) < Math.abs(x - a.target) ? y : x));
      const delta = a.target - near;
      return txt(runMutation('Claude: Music on the Beat', (d) => ({ grid: k, moved_by: r3(delta), ...MUT.move_clip.run(d, { clip_id: c.id, start: c.start + delta }, {}) }), !!a.dry_run));
    }
    const sources = a.music_clip_id ? [getClip(p, a.music_clip_id)] : musicClips(p, a.track);
    const times: number[] = [];
    for (const m of sources) times.push(...((await clipGrid(p, m)) as any)[GRID_KEY[k]]);
    if (!times.length) throw new Error('No music clips with a beat to snap to (pass music_clip_id or track)');
    const edge = a.edge === 'end' ? clipEnd(c) : c.start;
    const near = times.reduce((x, y) => (Math.abs(y - edge) < Math.abs(x - edge) ? y : x));
    const max = a.max_shift ?? 0.75;
    if (Math.abs(near - edge) > max) throw new Error(`The nearest ${k} is ${r3(near)} s, ${r3(Math.abs(near - edge))} s away (max_shift ${max})`);
    const mode = a.mode ?? 'move';
    return txt(
      runMutation(
        `Claude: Snap to ${k}`,
        (d) => {
          const cc = getClip(d, c.id);
          if (mode === 'move') return { grid: k, at: near, ...MUT.move_clip.run(d, { clip_id: cc.id, start: cc.start + (near - edge) }, {}) };
          if (mode !== 'roll') throw new Error('mode: move or roll');
          // roll the cut: this clip's edge and its neighbour's move together
          const fps = d.settings.fps;
          const nb = a.edge === 'end' ? nextAdjacent(d, cc, fps) : prevAdjacent(d, cc, fps);
          if (!nb) throw new Error(`${cc.id} has no clip right next to it on that side to roll against`);
          const later = a.edge === 'end' ? nb : cc;
          const earlier = a.edge === 'end' ? cc : nb;
          if (near > later.start) {
            MUT.trim_clip.run(d, { clip_id: later.id, new_start: near }, {});
            MUT.trim_clip.run(d, { clip_id: earlier.id, new_end: near }, {});
          } else {
            MUT.trim_clip.run(d, { clip_id: earlier.id, new_end: near }, {});
            MUT.trim_clip.run(d, { clip_id: later.id, new_start: near }, {});
          }
          return { grid: k, cut_at: r3(near) };
        },
        !!a.dry_run,
      ),
    );
  },
  _project_json: async () => txt(JSON.stringify(stripForFile(S().project))),
  _restore_project: async (a) => {
    const snap: Project = a.project;
    const cur = new Map(S().project.media.map((m) => [m.id, m]));
    commit(
      `Claude: Restore "${a.label ?? 'snapshot'}"`,
      (d) => {
        const keep = { path: d.path, name: d.name };
        Object.assign(d, structuredClone(snap), keep);
        d.media = d.media.map((m) => {
          const c = cur.get(m.id);
          return c && c.path === m.path ? { ...m, peaks: c.peaks, sprite: c.sprite, thumb: c.thumb, url: c.url, audioUrl: c.audioUrl, status: c.status } : m;
        });
      },
      { by: 'claude' },
    );
    applyStashedMedia();
    return txt({ restored: a.label ?? true, clips: S().project.clips.length, duration: r3(sequenceDuration(S().project)) });
  },
  _build_short: async (a) => {
    const d = buildShort(S().project, { start: a.start, end: a.end, layout: a.layout, captions: a.captions, title: a.title, style: docStyle(a) });
    await window.icut.saveProject(a.path, shortFile(d, a.path));
    return txt({ saved: a.path, size: `${d.settings.width}x${d.settings.height}`, duration: r3(sequenceDuration(d)), clips: d.clips.length, captions: d.clips.filter((c) => c.meta?.role === 'caption').length });
  },
};

export async function runTool(name: string, a: any): Promise<CallToolResult> {
  const s = S();
  if (DOC_ASYNC[name]) return DOC_ASYNC[name](a);
  if (name === 'duck' && !a.remove) await waitForWaveforms(a.key_track, 30_000);
  if (name === 'duck_audio') for (const t of a.key_tracks?.length ? a.key_tracks : ['Narration']) await waitForWaveforms(t, 30_000);
  if (MUT[name]) {
    // a file path where a bin item is expected: import it first (a dry run uses a stand-in instead)
    const key = name === 'add_clip' ? 'path' : name === 'add_panel' || name === 'ambience_fill' ? 'src' : null;
    let fake: string[] = [];
    if (key && a[key] && !findMedia(s.project, a[key])) {
      if (a.dry_run) fake = [a[key]];
      else {
        const [m] = await importPaths([a[key]]);
        if (!m) throw new Error(`Could not import ${a[key]}`);
        a = { ...a, [key]: m.id };
      }
    }
    return txt(
      runMutation(
        MUT[name].label(a),
        (d, after) => {
          let args = a;
          if (key && a[key]) {
            const m = findMedia(d, a[key]);
            if (name === 'add_clip' && m) args = { ...a, media_id: m.id };
          }
          return MUT[name].run(d, args, after);
        },
        !!a.dry_run && name !== 'remove_silence',
        fake.length ? (d) => fakeMedia(d, fake) : undefined,
      ),
    );
  }
  switch (name) {
    case 'get_project_state':
      return txt(a.detail === 'summary' ? describeProject(s.project, { playhead: s.playhead, selection: s.selection }) : fullJson(s.project));
    case 'batch': {
      const ops: { tool: string; args: any }[] = a.operations || [];
      if (a._style !== undefined) docStyle(a);
      for (const op of ops) if (!MUT[op.tool]) throw new Error(`"${op.tool}" cannot be used inside batch. Allowed: ${Object.keys(MUT).join(', ')}`);
      const label = `Claude: ${ops.length} edits`;
      return txt(
        runMutation(
          label,
          (d, after) =>
            ops.map((op, i) => {
              try {
                return { step: i + 1, tool: op.tool, ...MUT[op.tool].run(d, op.args || {}, after) };
              } catch (e: any) {
                throw new Error(`Step ${i + 1} (${op.tool}) failed: ${e.message}. No changes were applied.`);
              }
            }),
          !!a.dry_run,
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
      const { data, times, saved } = await contactSheet(a);
      return { content: [{ type: 'image', data, mimeType: 'image/jpeg' }, { type: 'text', text: `${times.length} frames at ${a.media_id ? 'source' : 'timeline'} times: ${times.map((t) => t.toFixed(2)).join(', ')}${saved ? `\nSaved as ${saved}` : ''}` }] };
    }
    case 'analyze_loudness':
      // the timeline mix (a media item is measured by the engine with FFmpeg)
      if (a.media_id && !a.sequence) throw new Error('Measuring a single file needs the IngrainedCut helper. Without media_id (or with sequence: true) this measures the timeline mix.');
      return txt({ ...(await timelineLoudness(s.project, a)), ...(s.project.settings.loudness ? { export_normalizes_to: s.project.settings.loudness } : {}) });
    case 'detect_silence':
      if ((a.media_id || a.clip_id) && !a.sequence) throw new Error('Silence in a single file needs the IngrainedCut helper. Without media_id / clip_id (or with sequence: true) this looks at the timeline mix.');
      return txt(await timelineSilences(s.project, a));
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
      const seq = S().project.settings;
      if (a.preset) {
        const P: Record<string, any> = {
          final_1080p: { format: 'mp4-h264', height: 1080, quality: 18 },
          final_4k: { format: 'mp4-h264', height: 2160, quality: 18 },
          proxy_720p: { format: 'mp4-h264', height: 720, quality: 26 },
          short_9x16: { format: 'mp4-h264', height: 1920, quality: 18 },
        };
        const pr = P[a.preset];
        if (!pr) throw new Error(`preset: ${Object.keys(P).join(', ')}`);
        if (a.preset === 'short_9x16' && !(seq.height > seq.width)) throw new Error('This sequence is not vertical. Build the Short with make_short, open that project, then export it with preset short_9x16.');
        if (a.preset !== 'short_9x16' && seq.height > seq.width) pr.height = undefined;
        a = { ...pr, ...a, format: a.format ?? pr.format, height: a.height ?? pr.height, quality: a.quality ?? pr.quality };
        if (!a.path) {
          const proj = S().project.path;
          if (!proj || isBrowserEngine()) throw new Error('Pass path (the project has no folder to put the export in)');
          const dir = dirOf(proj);
          a.path = `${dir}${dir.includes('\\') ? '\\' : '/'}exports${dir.includes('\\') ? '\\' : '/'}${S().project.name} (${a.preset}).mp4`;
        }
      }
      if (!a.path) throw new Error('Pass path (or a preset, which names the file next to the project)');
      const r = await runExport({
        path: a.path,
        format: a.format,
        quality: a.quality,
        range: a.range,
        loudness: a.normalize === false ? null : (a.loudness_target ?? a.target_lufs) != null ? { lufs: a.loudness_target ?? a.target_lufs, truePeak: a.true_peak ?? -1 } : undefined,
        scale: a.height ? a.height / seq.height : a.scale,
        fps: a.fps,
        bitrate: a.bitrate_mbps ? a.bitrate_mbps * 1e6 : undefined,
        encoder: a.encoder,
        proresProfile: a.prores_profile,
        dnxhrProfile: a.dnxhr_profile,
        audioBitrate: a.audio_kbps,
        sampleRate: a.sample_rate,
        bitDepth: a.bit_depth,
      });
      return txt({ exported: r.path, size_mb: r3(r.size / 1e6), render_seconds: r3(r.seconds), encoder: r.engine, ...(r.loudness ? { loudness: r.loudness } : {}) });
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
