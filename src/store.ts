import { create } from 'zustand';
import type { Clip, MediaItem, Project, ToolId } from './types';
import { newProject } from './ops';

export interface HistoryEntry {
  project: Project;
  label: string;
  by: 'user' | 'claude';
}

export type Dialog = null | 'export' | 'settings' | 'shortcuts' | 'sequence' | 'mcp' | 'speed' | 'about' | 'sync' | 'silence';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error' | 'success';
}

export interface EditorState {
  project: Project;
  past: HistoryEntry[];
  future: HistoryEntry[];
  lastLabel: string;
  dirty: boolean;
  selection: string[];
  selectedMediaId: string | null;
  playhead: number;
  playing: boolean;
  tool: ToolId;
  zoom: number;
  snapping: boolean;
  linkedSelection: boolean;
  previewScale: number;
  showSafe: boolean;
  source: { mediaId: string | null; in: number | null; out: number | null; time: number };
  leftTab: 'source' | 'effectControls' | 'color' | 'mixer' | 'info';
  bottomTab: 'project' | 'effects' | 'history';
  workspace: string;
  showChat: boolean;
  dialog: Dialog;
  flash: Record<string, number>;
  clipboard: Clip[];
  exportJob: null | { progress: number; phase: string; path: string };
  toasts: Toast[];
  targetVideo: string;
  targetAudio: string;
  gestureBase: Project | null;
  /** Website mode: the account project this editor is bound to. */
  cloud: { id: string; status: 'saved' | 'saving' | 'pending' | 'error' } | null;
}

export const useEditor = create<EditorState>()(() => ({
  project: newProject(),
  past: [],
  future: [],
  lastLabel: '',
  dirty: false,
  selection: [],
  selectedMediaId: null,
  playhead: 0,
  playing: false,
  tool: 'select',
  zoom: 60,
  snapping: true,
  linkedSelection: true,
  previewScale: 1,
  showSafe: false,
  source: { mediaId: null, in: null, out: null, time: 0 },
  leftTab: 'effectControls',
  bottomTab: 'project',
  workspace: 'Editing',
  showChat: true,
  dialog: null,
  flash: {},
  clipboard: [],
  exportJob: null,
  toasts: [],
  targetVideo: 'v1',
  targetAudio: 'a1',
  gestureBase: null,
  cloud: null,
}));

export const S = () => useEditor.getState();
export const setS = (patch: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)) => useEditor.setState(patch as any);

const HISTORY_LIMIT = 300;
const ASSET_KEYS: (keyof MediaItem)[] = ['thumb', 'sprite', 'peaks', 'audioUrl', 'status'];

function carryAssets(target: Project, from: Project) {
  for (const m of target.media) {
    const cur = from.media.find((x) => x.id === m.id);
    if (cur) for (const k of ASSET_KEYS) (m as any)[k] = (cur as any)[k];
  }
}

/** Apply an edit as one undoable step. fn mutates a draft; throwing aborts the edit. */
export function commit<T>(label: string, fn: (draft: Project) => T, opts: { by?: 'user' | 'claude'; flash?: string[] } = {}): T {
  const s = S();
  const draft = structuredClone(s.project);
  const result = fn(draft);
  const flash = { ...s.flash };
  const now = Date.now();
  for (const id of opts.flash ?? []) flash[id] = now;
  setS({
    project: draft,
    past: [...s.past, { project: s.project, label, by: opts.by ?? 'user' }].slice(-HISTORY_LIMIT),
    future: [],
    lastLabel: label,
    dirty: true,
    flash,
    selection: s.selection.filter((id) => draft.clips.some((c) => c.id === id)),
  });
  return result;
}

/** Live edits during a drag: each call recomputes from the gesture's starting state. */
export function beginGesture() {
  setS({ gestureBase: S().project });
}
export function gesture(fn: (draft: Project) => void) {
  const base = S().gestureBase;
  if (!base) return;
  const draft = structuredClone(base);
  try {
    fn(draft);
  } catch {
    return;
  }
  carryAssets(draft, S().project);
  setS({ project: draft });
}
export function endGesture(label: string) {
  const s = S();
  if (!s.gestureBase) return;
  if (s.gestureBase !== s.project && JSON.stringify(s.gestureBase.clips) !== JSON.stringify(s.project.clips)) {
    setS({
      past: [...s.past, { project: s.gestureBase, label, by: 'user' as const }].slice(-HISTORY_LIMIT),
      future: [],
      lastLabel: label,
      dirty: true,
      gestureBase: null,
    });
  } else setS({ gestureBase: null });
}
export function cancelGesture() {
  const s = S();
  if (s.gestureBase) setS({ project: s.gestureBase, gestureBase: null });
}

export function undo(steps = 1) {
  let n = 0;
  for (let i = 0; i < steps; i++) {
    const s = S();
    const prev = s.past[s.past.length - 1];
    if (!prev) break;
    const restored = structuredClone(prev.project);
    carryAssets(restored, s.project);
    setS({
      project: restored,
      past: s.past.slice(0, -1),
      future: [{ project: s.project, label: prev.label, by: prev.by }, ...s.future],
      dirty: true,
      lastLabel: 'Undo ' + prev.label,
    });
    n++;
  }
  return n;
}

export function redo(steps = 1) {
  let n = 0;
  for (let i = 0; i < steps; i++) {
    const s = S();
    const next = s.future[0];
    if (!next) break;
    const restored = structuredClone(next.project);
    carryAssets(restored, s.project);
    setS({
      project: restored,
      future: s.future.slice(1),
      past: [...s.past, { project: s.project, label: next.label, by: next.by }],
      dirty: true,
      lastLabel: 'Redo ' + next.label,
    });
    n++;
  }
  return n;
}

/** Jump back to a history index (History panel). */
export function revertTo(index: number) {
  const s = S();
  const steps = s.past.length - index;
  if (steps > 0) undo(steps);
}

// asset updates that arrive before their media item is committed (cached thumbnails are instant)
const stashedMedia = new Map<string, Partial<MediaItem>>();

export function applyStashedMedia() {
  for (const [id, patch] of [...stashedMedia]) {
    if (S().project.media.some((m) => m.id === id)) {
      stashedMedia.delete(id);
      updateMedia(id, patch);
    }
  }
}

/** Non-undoable media metadata update (thumbnails, peaks...). */
export function updateMedia(id: string, patch: Partial<MediaItem>) {
  const s = S();
  if (!s.project.media.some((m) => m.id === id)) {
    stashedMedia.set(id, { ...stashedMedia.get(id), ...patch });
    return;
  }
  const apply = (p: Project) => ({ ...p, media: p.media.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  setS({ project: apply(s.project), gestureBase: s.gestureBase ? apply(s.gestureBase) : null });
}

let toastSeq = 0;
export function toast(message: string, kind: Toast['kind'] = 'info', ms = 3500) {
  const id = ++toastSeq;
  setS((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
  setTimeout(() => setS((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

export function loadProjectState(p: Project) {
  setS({ project: p, past: [], future: [], dirty: false, selection: [], playhead: 0, selectedMediaId: null, source: { mediaId: null, in: null, out: null, time: 0 } });
}

export function stripForFile(p: Project): Project {
  const c = structuredClone(p);
  for (const m of c.media) {
    delete m.peaks;
  }
  return c;
}
