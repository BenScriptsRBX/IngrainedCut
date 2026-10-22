// User-facing commands shared by menus, keyboard shortcuts, panels and Claude tools.
import type { Clip, MediaItem, Project, TransitionType } from './types';
import { S, setS, commit, toast, loadProjectState, stripForFile, updateMedia, applyStashedMedia } from './store';
import {
  clearRegion, clipAt, clipEnd, deleteClips, editPoints, ensureTrack, expandLinked, getClip, insertSpace, makeClip, newProject,
  nid, placeMedia, rippleDeleteRange, splitWithLinks, razor, tracksOf, trackLabel, DEFAULT_TEXT, assertUnlocked, trimStart,
} from './ops';
import { engine } from './engine';
import { snapFrame } from './time';
import { isBrowserEngine, storeDroppedFiles } from './webBridge';
import { cloudSave } from './cloud';

const rid = () => Math.random().toString(36).slice(2, 6);

export async function importPaths(paths: string[], extra: Partial<MediaItem> = {}): Promise<MediaItem[]> {
  const s = S();
  const existing = paths.map((p) => s.project.media.find((m) => m.path.toLowerCase() === p.toLowerCase())).filter(Boolean) as MediaItem[];
  const fresh = paths.filter((p) => !s.project.media.some((m) => m.path.toLowerCase() === p.toLowerCase()));
  if (!fresh.length) return existing;
  const items = fresh.map((p) => ({ id: 'm' + rid(), path: p }));
  const res = await window.icut.importMedia(items);
  const ok = res.filter((r) => r.ok);
  for (const r of res.filter((r) => !r.ok)) toast(`Could not import ${items.find((i) => i.id === r.id)?.path.split(/[\\/]/).pop()}: ${r.error?.slice(0, 160)}`, 'error', 7000);
  if (!ok.length) return existing;
  const added: MediaItem[] = ok.map((r) => ({ ...r.info, ...extra, name: extra.name || r.info.name, id: r.id, status: 'loading' }));
  commit(`Import ${added.length} item${added.length > 1 ? 's' : ''}`, (d) => {
    d.media.push(...added);
  });
  applyStashedMedia();
  if (!S().selectedMediaId) setS({ selectedMediaId: added[0].id });
  return [...existing, ...added];
}

/**
 * Real paths for dropped files. The desktop app reads them directly; a browser never exposes paths, so the
 * web version copies dropped files into Documents/IngrainedCut/Imported (Import… / Ctrl+I avoids the copy).
 */
export async function filesToPaths(files: File[]): Promise<string[]> {
  const out: string[] = [];
  const copy: File[] = [];
  for (const f of files) {
    const p = window.icut.pathForFile(f);
    if (p) out.push(p);
    else copy.push(f);
  }
  if (copy.length) {
    toast(
      isBrowserEngine()
        ? `Adding ${copy.length} file${copy.length > 1 ? 's' : ''} to this browser's storage…`
        : `Copying ${copy.length} dropped file${copy.length > 1 ? 's' : ''} into Documents/IngrainedCut/Imported… (File → Import uses files in place, without copying)`,
      'info',
      6000,
    );
    out.push(...(await storeDroppedFiles(copy, (m) => toast(m, 'info'))));
  }
  return out;
}

export async function importDialog() {
  const paths = await window.icut.openMediaDialog();
  if (paths.length) await importPaths(paths);
}

export function confirmDiscard() {
  return !S().dirty || window.confirm('Discard unsaved changes to the current project?');
}

export function newProjectAction() {
  if (!confirmDiscard()) return;
  loadProjectState(newProject());
  engine.seek(0);
}

export async function openProject(path?: string) {
  if (!confirmDiscard()) return;
  const p = path || (await window.icut.openProjectDialog());
  if (!p) return;
  const { data, missing } = await window.icut.loadProject(p);
  const proj = data as Project;
  proj.path = p;
  for (const m of proj.media) m.status = missing.includes(m.path) ? 'missing' : 'loading';
  loadProjectState(proj);
  engine.seek(0);
  for (const m of proj.media) if (m.status !== 'missing') window.icut.refreshAssets({ id: m.id, path: m.path, info: m });
  if (missing.length) toast(`${missing.length} media file(s) are missing`, 'error', 6000);
}

export async function saveProject(saveAs = false, path?: string): Promise<string | null> {
  const s = S();
  // website mode: Save goes to the account; "Save As" still writes a copy to this computer
  if (s.cloud && !saveAs && !path) {
    const ok = await cloudSave();
    toast(ok ? 'Saved to your account' : 'Could not save — check your connection', ok ? 'success' : 'error');
    return ok ? s.cloud.id : null;
  }
  let target = path || (!saveAs && s.project.path) || null;
  if (!target) {
    target = await window.icut.saveDialog({
      title: 'Save Project',
      defaultPath: (s.project.name === 'Untitled Project' ? 'My Edit' : s.project.name) + '.icut',
      filters: [{ name: 'IngrainedCut Project', extensions: ['icut'] }],
    });
  }
  if (!target) return null;
  const name = target.split(/[\\/]/).pop()!.replace(/\.icut$/i, '');
  const data = stripForFile({ ...s.project, path: target, name });
  await window.icut.saveProject(target, data);
  setS({ project: { ...S().project, path: target, name }, dirty: false });
  toast('Project saved', 'success');
  return target;
}

export function selectedClips(): Clip[] {
  const s = S();
  return s.project.clips.filter((c) => s.selection.includes(c.id));
}

export function withLinks(ids: string[]) {
  const s = S();
  return s.linkedSelection ? expandLinked(s.project, ids) : ids;
}

export function splitAtPlayhead() {
  const s = S();
  const t = snapFrame(s.playhead, s.project.settings.fps);
  try {
    if (s.selection.length) commit('Add Edit', (d) => splitWithLinks(d, s.selection, t));
    else commit('Add Edit to All Tracks', (d) => razor(d, t));
  } catch (e: any) {
    toast(e.message, 'error');
  }
}

export function deleteSelection(ripple: boolean) {
  const s = S();
  if (!s.selection.length) return;
  const ids = withLinks(s.selection);
  try {
    commit(ripple ? 'Ripple Delete' : 'Clear', (d) => deleteClips(d, ids, ripple));
    setS({ selection: [] });
  } catch (e: any) {
    toast(e.message, 'error');
  }
}

export function copySelection() {
  const s = S();
  const clips = s.project.clips.filter((c) => withLinks(s.selection).includes(c.id));
  if (clips.length) setS({ clipboard: structuredClone(clips) });
}

export function cutSelection() {
  copySelection();
  deleteSelection(false);
}

export function paste(insert = false) {
  const s = S();
  if (!s.clipboard.length) return;
  const t0 = Math.min(...s.clipboard.map((c) => c.start));
  const span = Math.max(...s.clipboard.map(clipEnd)) - t0;
  const at = s.playhead;
  const created: string[] = [];
  commit(insert ? 'Paste Insert' : 'Paste', (d) => {
    const tracks = [...new Set(s.clipboard.map((c) => c.trackId))].filter((id) => d.tracks.some((t) => t.id === id));
    if (insert) insertSpace(d, tracks, at, span);
    else for (const tid of tracks) clearRegion(d, tid, at, at + span);
    const links = new Map<string, string>();
    for (const c of s.clipboard) {
      if (!d.tracks.some((t) => t.id === c.trackId)) continue;
      const n = structuredClone(c);
      n.id = nid(d, 'c');
      n.start = at + (c.start - t0);
      if (c.linkId) {
        if (!links.has(c.linkId)) links.set(c.linkId, nid(d, 'L'));
        n.linkId = links.get(c.linkId)!;
      }
      d.clips.push(n);
      created.push(n.id);
    }
  });
  setS({ selection: created });
  engine.seek(at + span);
}

/** Top-most video track that is free over [t, t+dur), creating a new one if needed. */
export function freeVideoTrack(d: Project, t: number, dur: number) {
  const vids = tracksOf(d, 'video');
  for (let i = vids.length - 1; i >= 0; i--) {
    const tr = vids[i];
    if (tr.locked) continue;
    const busy = d.clips.some((c) => c.trackId === tr.id && c.start < t + dur - 1e-6 && clipEnd(c) > t + 1e-6);
    if (!busy) {
      // prefer the lowest free track above all occupied ones
      const above = vids.slice(i + 1).some((x) => d.clips.some((c) => c.trackId === x.id && c.start < t + dur && clipEnd(c) > t));
      if (!above) {
        let j = i;
        while (j > 0 && !vids[j - 1].locked && !d.clips.some((c) => c.trackId === vids[j - 1].id && c.start < t + dur - 1e-6 && clipEnd(c) > t + 1e-6)) j--;
        return vids[j];
      }
    }
  }
  return ensureTrack(d, 'video', vids.length);
}

export function addTextAt(t?: number, text = 'Your Title') {
  const s = S();
  const at = t ?? s.playhead;
  let id = '';
  commit('New Text', (d) => {
    const tr = freeVideoTrack(d, at, 5);
    const c = makeClip(d, { kind: 'text', trackId: tr.id, start: at, duration: 5, name: text, text: { ...DEFAULT_TEXT, content: text } });
    d.clips.push(c);
    id = c.id;
  });
  setS({ selection: [id], leftTab: 'effectControls' });
}

export function addColorMatte(color = '#1e1e64') {
  const s = S();
  let id = '';
  commit('New Color Matte', (d) => {
    const tr = freeVideoTrack(d, s.playhead, 5);
    const c = makeClip(d, { kind: 'color', trackId: tr.id, start: s.playhead, duration: 5, name: 'Color Matte', color });
    d.clips.push(c);
    id = c.id;
  });
  setS({ selection: [id] });
}

export function addAdjustmentLayer() {
  const s = S();
  let id = '';
  commit('New Adjustment Layer', (d) => {
    const tr = freeVideoTrack(d, s.playhead, 5);
    const c = makeClip(d, { kind: 'adjustment', trackId: tr.id, start: s.playhead, duration: 5, name: 'Adjustment Layer' });
    d.clips.push(c);
    id = c.id;
  });
  setS({ selection: [id], leftTab: 'effectControls' });
}

export function addMarker(t?: number, name = '') {
  const s = S();
  const at = t ?? s.playhead;
  commit('Add Marker', (d) => {
    d.markers.push({ id: nid(d, 'k'), time: at, name: name || `Marker ${d.markers.length + 1}`, color: '#3bb26b' });
  });
}

export function nudgeSelection(frames: number) {
  const s = S();
  if (!s.selection.length) return;
  const ids = new Set(withLinks(s.selection));
  const dt = frames / s.project.settings.fps;
  commit('Nudge', (d) => {
    for (const c of d.clips) if (ids.has(c.id)) c.start = Math.max(0, c.start + dt);
  });
}

export function toggleEnable() {
  const s = S();
  if (!s.selection.length) return;
  const ids = new Set(withLinks(s.selection));
  commit('Enable/Disable', (d) => {
    const on = !d.clips.find((c) => ids.has(c.id))!.enabled;
    for (const c of d.clips) if (ids.has(c.id)) c.enabled = on;
  });
}

export function toggleLink() {
  const s = S();
  if (!s.selection.length) return;
  commit('Link/Unlink', (d) => {
    const sel = d.clips.filter((c) => s.selection.includes(c.id));
    if (sel.some((c) => c.linkId)) for (const c of d.clips.filter((x) => sel.some((y) => y.linkId && y.linkId === x.linkId))) c.linkId = null;
    else {
      const L = nid(d, 'L');
      for (const c of sel) c.linkId = L;
    }
  });
}

export function applyTransition(ids: string[], edge: 'in' | 'out' | 'both', type: TransitionType = 'cross-dissolve', duration = 1) {
  commit('Apply Transition', (d) => {
    for (const id of ids) {
      const c = getClip(d, id);
      const dur = Math.min(duration, c.duration);
      if (edge === 'in' || edge === 'both') c.transitionIn = { type, duration: dur };
      if (edge === 'out' || edge === 'both') c.transitionOut = { type, duration: dur };
    }
  });
}

export function addDefaultTransition() {
  const s = S();
  if (s.selection.length) return applyTransition(s.selection, 'in');
  // at the edit point nearest the playhead on the target video track
  const p = s.project;
  const t = s.playhead;
  const c = p.clips.filter((x) => x.trackId === s.targetVideo).sort((a, b) => Math.abs(a.start - t) - Math.abs(b.start - t))[0];
  if (c) applyTransition([c.id], 'in');
  else toast('Select a clip to add a transition', 'info');
}

export function rippleTrimToPlayhead(side: 'start' | 'end') {
  const s = S();
  const t = s.playhead;
  const p = s.project;
  const clips = p.tracks.filter((tr) => !tr.locked).map((tr) => clipAt(p, tr.id, t)).filter(Boolean) as Clip[];
  if (!clips.length) return;
  if (side === 'start') {
    const from = Math.min(...clips.map((c) => c.start));
    if (t - from < 1e-3) return;
    commit('Ripple Trim Previous', (d) => rippleDeleteRange(d, from, t));
    engine.seek(from);
  } else {
    const to = Math.max(...clips.map(clipEnd));
    if (to - t < 1e-3) return;
    commit('Ripple Trim Next', (d) => rippleDeleteRange(d, t, to));
  }
}

export function liftExtract(extract: boolean) {
  const p = S().project;
  if (p.inPoint == null || p.outPoint == null || p.outPoint <= p.inPoint) return toast('Set In and Out points first (I / O)', 'info');
  const a = p.inPoint;
  const b = p.outPoint;
  commit(extract ? 'Extract' : 'Lift', (d) => {
    if (extract) {
      rippleDeleteRange(d, a, b);
      d.outPoint = null;
    } else for (const tr of d.tracks) if (!tr.locked) clearRegion(d, tr.id, a, b);
  });
}

export function placeMediaAt(mediaId: string, trackId: string | null, t: number, mode: 'overwrite' | 'insert' = 'overwrite', srcIn?: number, srcOut?: number) {
  const s = S();
  const m = s.project.media.find((x) => x.id === mediaId);
  if (!m) return [];
  let created: Clip[] = [];
  try {
    commit(mode === 'insert' ? 'Insert' : 'Overwrite', (d) => {
      const tr = trackId ? d.tracks.find((x) => x.id === trackId) : null;
      const video = tr?.kind === 'video' ? tr.id : m.type === 'audio' ? undefined : s.targetVideo;
      let audio = tr?.kind === 'audio' ? tr.id : undefined;
      if (m.type === 'audio' && !audio) audio = s.targetAudio;
      if (tr?.kind === 'audio' && m.type !== 'audio' && m.hasVideo) {
        // dropped a video file on an audio track: video goes to the matching video track
        created = placeMedia(d, m, { videoTrackId: ensureTrack(d, 'video', tracksOf(d, 'audio').indexOf(tr)).id, audioTrackId: tr.id, start: t, srcIn, srcOut, mode });
      } else created = placeMedia(d, m, { videoTrackId: video, audioTrackId: audio, start: t, srcIn, srcOut, mode });
    });
  } catch (e: any) {
    toast(e.message, 'error');
  }
  setS({ selection: created.map((c) => c.id) });
  return created;
}

export function sourceToTimeline(mode: 'overwrite' | 'insert') {
  const s = S();
  const src = s.source;
  if (!src.mediaId) return toast('Open a clip in the Source Monitor first (double-click media)', 'info');
  const m = s.project.media.find((x) => x.id === src.mediaId)!;
  const a = src.in ?? 0;
  const b = src.out ?? (m.type === 'image' ? a + 5 : m.duration);
  const created = placeMediaAt(m.id, null, s.playhead, mode, a, m.type === 'image' ? undefined : b);
  if (created.length) engine.seek(Math.max(...created.map(clipEnd)));
}

export function goToEdit(dir: 1 | -1) {
  const s = S();
  const pts = editPoints(s.project);
  const t = s.playhead;
  const target = dir > 0 ? pts.find((x) => x > t + 1e-3) : [...pts].reverse().find((x) => x < t - 1e-3);
  if (target != null) engine.seek(target);
}

export function stepFrames(n: number) {
  const s = S();
  const fps = s.project.settings.fps;
  engine.seek(snapFrame(s.playhead, fps) + n / fps);
}

export function setInOut(which: 'in' | 'out', clear = false) {
  const t = S().playhead;
  commit(clear ? `Clear ${which === 'in' ? 'In' : 'Out'}` : `Mark ${which === 'in' ? 'In' : 'Out'}`, (d) => {
    if (which === 'in') d.inPoint = clear ? null : t;
    else d.outPoint = clear ? null : t;
  });
}

export function selectAll() {
  setS({ selection: S().project.clips.map((c) => c.id) });
}

export function exportFrame() {
  const comp = engine.comp;
  if (!comp) return;
  comp.canvas.toBlob(async (blob) => {
    if (!blob) return;
    const s = S();
    const p = await window.icut.saveDialog({ title: 'Export Frame', defaultPath: `${s.project.settings.name} frame.png`, filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (!p) return;
    await window.icut.writePng(p, await blob.arrayBuffer());
    toast('Frame exported', 'success');
  }, 'image/png');
}

export function trimSelectionStartTo(t: number) {
  const s = S();
  commit('Trim', (d) => {
    for (const id of withLinks(s.selection)) {
      const c = getClip(d, id);
      assertUnlocked(d, c.trackId);
      trimStart(d, c, t);
    }
  });
}

export { trackLabel };

export function revealMedia(id: string) {
  const m = S().project.media.find((x) => x.id === id);
  if (m) window.icut.reveal(m.path);
}

export function removeMedia(ids: string[]) {
  const s = S();
  const used = s.project.clips.filter((c) => c.mediaId && ids.includes(c.mediaId));
  if (used.length && !window.confirm(`${used.length} clip(s) in the sequence use this media. Remove them too?`)) return;
  commit('Remove Media', (d) => {
    d.clips = d.clips.filter((c) => !c.mediaId || !ids.includes(c.mediaId));
    d.media = d.media.filter((m) => !ids.includes(m.id));
  });
  setS({ selectedMediaId: null });
}

export { updateMedia };
