// Right-click menus for every part of the editor. Clips, bin items and markers open their own menus; this handles the
// rest: text fields, selected text, chat messages, track headers, lanes, the ruler, both monitors, the bin and the chat.
import type { MenuItem } from './ContextMenu';
import { openContextMenu } from './ContextMenu';
import { S, setS, commit, undo, redo, toast } from '../store';
import {
  addAdjustmentLayer, addColorMatte, addMarker, addTextAt, exportFrame, importDialog, paste, selectAll, setInOut, sourceToTimeline,
} from '../actions';
import { clipEnd, clipsOnTrack, closeGaps, ensureTrack, rippleDeleteRange, trackLabel, tracksOf } from '../ops';
import { engine } from '../engine';
import { useChat, setDraft, newChat } from '../chatStore';
import { isWeb } from '../webBridge';
import { timeAtClientX, zoomToFit } from './Timeline';
import { addEditAllTracks } from '../cutTools';

const copyText = (text: string) => navigator.clipboard.writeText(text).then(() => toast('Copied', 'success', 1200)).catch(() => toast('Could not copy', 'error'));

/** Cut / copy / paste for text boxes (the desktop app has no built-in menu for them). */
function textFieldMenu(el: HTMLInputElement | HTMLTextAreaElement): MenuItem[] {
  const ro = el.readOnly || el.disabled;
  let hasSel = false;
  try {
    hasSel = el.selectionStart != null && el.selectionStart !== el.selectionEnd;
  } catch {}
  const run = (cmd: string) => () => {
    el.focus();
    document.execCommand(cmd);
  };
  return [
    { label: 'Undo', shortcut: 'Ctrl+Z', disabled: ro, action: run('undo') },
    { label: 'Redo', shortcut: 'Ctrl+Y', disabled: ro, action: run('redo') },
    { divider: true },
    { label: 'Cut', shortcut: 'Ctrl+X', disabled: ro || !hasSel, action: run('cut') },
    { label: 'Copy', shortcut: 'Ctrl+C', disabled: !hasSel, action: run('copy') },
    {
      label: 'Paste',
      shortcut: 'Ctrl+V',
      disabled: ro,
      action: async () => {
        el.focus();
        const text = await navigator.clipboard.readText().catch(() => null);
        // insertText keeps the field's own undo history and fires React's onChange
        if (text != null) document.execCommand('insertText', false, text);
        else document.execCommand('paste');
      },
    },
    { divider: true },
    {
      label: 'Select All',
      shortcut: 'Ctrl+A',
      action: () => {
        el.focus();
        el.select();
      },
    },
  ];
}

function editItems(): MenuItem[] {
  const s = S();
  return [
    { label: `Undo ${s.past[s.past.length - 1]?.label ?? ''}`.trim(), shortcut: 'Ctrl+Z', disabled: !s.past.length, action: () => undo() },
    { label: `Redo ${s.future[0]?.label ?? ''}`.trim(), shortcut: 'Ctrl+Shift+Z', disabled: !s.future.length, action: () => redo() },
  ];
}

function generalMenu(): MenuItem[] {
  const s = S();
  return [
    ...editItems(),
    { divider: true },
    { label: 'Paste', shortcut: 'Ctrl+V', disabled: !s.clipboard.length, action: () => paste(false) },
    { label: 'Select All Clips', shortcut: 'Ctrl+A', action: selectAll },
    { divider: true },
    { label: 'Import…', shortcut: 'Ctrl+I', action: importDialog },
    { label: 'Export Media…', shortcut: 'Ctrl+M', action: () => setS({ dialog: 'export' }) },
    { divider: true },
    { label: 'Settings…', action: () => setS({ dialog: 'settings' }) },
  ];
}

const EPS = 1e-6;

/** The empty stretch of a track around time t (null when t is over a clip). */
function gapAt(trackId: string, t: number): { start: number; end: number | null } | null {
  const clips = clipsOnTrack(S().project, trackId);
  if (clips.some((c) => t >= c.start - EPS && t < clipEnd(c) - EPS)) return null;
  const before = clips.filter((c) => clipEnd(c) <= t + EPS);
  const after = clips.find((c) => c.start >= t - EPS);
  return { start: before.length ? Math.max(...before.map(clipEnd)) : 0, end: after ? after.start : null };
}

function laneMenu(trackId: string, t: number): MenuItem[] {
  const s = S();
  const p = s.project;
  const track = p.tracks.find((x) => x.id === trackId);
  if (!track) return generalMenu();
  const gap = gapAt(trackId, t);
  // ripple-deleting a gap only keeps everything in sync when no other track has media in that stretch
  const gapClear = !!gap && gap.end != null && gap.end - gap.start > EPS && !p.clips.some((c) => c.start < gap.end! - EPS && clipEnd(c) > gap.start + EPS);
  const at = (fn: () => void) => () => {
    engine.seek(t);
    fn();
  };
  return [
    ...(gap && gap.end != null
      ? [
          {
            label: gapClear ? 'Ripple Delete Gap' : 'Ripple Delete Gap (other tracks have clips here)',
            disabled: !gapClear,
            action: () => commit('Ripple Delete Gap', (d) => rippleDeleteRange(d, gap.start, gap.end!)),
          },
          { divider: true },
        ]
      : []),
    { label: 'Move Playhead Here', action: () => engine.seek(t) },
    { label: 'Add Edit to All Tracks Here', action: at(addEditAllTracks) },
    { label: 'Remove Silence…', action: () => setS({ dialog: 'silence' }) },
    { label: 'Paste Here', disabled: !s.clipboard.length, action: at(() => paste(false)) },
    { label: 'Paste Insert Here', disabled: !s.clipboard.length, action: at(() => paste(true)) },
    { divider: true },
    { label: 'Add Text Here', action: () => addTextAt(t) },
    { label: 'Add Marker Here', action: () => addMarker(t) },
    { label: 'Add Color Matte at Playhead', action: () => addColorMatte() },
    { label: 'Add Adjustment Layer at Playhead', action: addAdjustmentLayer },
    { divider: true },
    { label: `Select All on ${trackLabel(p, track)}`, action: () => setS({ selection: clipsOnTrack(p, trackId).map((c) => c.id) }) },
    { label: 'Select Clips Forward from Here', action: () => setS({ selection: clipsOnTrack(p, trackId).filter((c) => clipEnd(c) > t + EPS).map((c) => c.id) }) },
    { label: 'Close Gaps', action: () => commit('Close Gaps', (d) => closeGaps(d)) },
    { divider: true },
    { label: 'Zoom to Sequence', shortcut: '\\', action: zoomToFit },
    ...editItems(),
  ];
}

function trackMenu(trackId: string): MenuItem[] {
  const p = S().project;
  const track = p.tracks.find((x) => x.id === trackId);
  if (!track) return generalMenu();
  const label = trackLabel(p, track);
  const set = (patch: Partial<typeof track>, lbl: string) => () => commit(lbl, (d) => Object.assign(d.tracks.find((x) => x.id === trackId)!, patch));
  const clips = clipsOnTrack(p, trackId);
  const last = tracksOf(p, track.kind).length <= 1;
  return [
    {
      label: 'Rename Track…',
      action: () => {
        const name = window.prompt('Track name', track.name || label);
        if (name != null) commit('Rename Track', (d) => void (d.tracks.find((x) => x.id === trackId)!.name = name.trim() || undefined));
      },
    },
    { label: track.locked ? 'Unlock Track' : 'Lock Track', action: set({ locked: !track.locked }, 'Lock Track') },
    ...(track.kind === 'video'
      ? [{ label: track.hidden ? 'Show Track Output' : 'Hide Track Output', action: set({ hidden: !track.hidden }, 'Toggle Track Output') }]
      : [
          { label: track.muted ? 'Unmute Track' : 'Mute Track', action: set({ muted: !track.muted }, 'Mute Track') },
          { label: track.solo ? 'Unsolo Track' : 'Solo Track', action: set({ solo: !track.solo }, 'Solo Track') },
        ]),
    { label: 'Target This Track', action: () => setS(track.kind === 'video' ? { targetVideo: trackId } : { targetAudio: trackId }) },
    { label: `Select All on ${label}`, disabled: !clips.length, action: () => setS({ selection: clips.map((c) => c.id) }) },
    { divider: true },
    { label: 'Add Video Track', action: () => commit('Add Track', (d) => void ensureTrack(d, 'video', tracksOf(d, 'video').length)) },
    { label: 'Add Audio Track', action: () => commit('Add Track', (d) => void ensureTrack(d, 'audio', tracksOf(d, 'audio').length)) },
    {
      label: last ? `Delete Track (the last ${track.kind} track stays)` : 'Delete Track',
      disabled: last || track.locked,
      action: () => {
        if (clips.length && !window.confirm(`Delete ${label} and its ${clips.length} clip${clips.length === 1 ? '' : 's'}?`)) return;
        commit('Delete Track', (d) => {
          d.clips = d.clips.filter((c) => c.trackId !== trackId);
          d.tracks = d.tracks.filter((x) => x.id !== trackId);
        });
      },
    },
  ];
}

function rulerMenu(t: number): MenuItem[] {
  const p = S().project;
  const at = (fn: () => void) => () => {
    engine.seek(t);
    fn();
  };
  return [
    { label: 'Move Playhead Here', action: () => engine.seek(t) },
    { label: 'Add Marker Here', shortcut: 'M', action: () => addMarker(t) },
    { divider: true },
    { label: 'Mark In Here', shortcut: 'I', action: at(() => setInOut('in')) },
    { label: 'Mark Out Here', shortcut: 'O', action: at(() => setInOut('out')) },
    {
      label: 'Clear In and Out',
      disabled: p.inPoint == null && p.outPoint == null,
      action: () => commit('Clear In/Out', (d) => ((d.inPoint = null), (d.outPoint = null))),
    },
    { label: 'Clear All Markers', disabled: !p.markers.length, action: () => commit('Clear Markers', (d) => void (d.markers = [])) },
    { divider: true },
    { label: 'Zoom to Sequence', shortcut: '\\', action: zoomToFit },
  ];
}

function programMenu(): MenuItem[] {
  const s = S();
  return [
    { label: 'Export Frame', shortcut: 'Ctrl+Shift+E', action: exportFrame },
    { label: 'Add Marker', shortcut: 'M', action: () => addMarker() },
    { label: 'Mark In', shortcut: 'I', action: () => setInOut('in') },
    { label: 'Mark Out', shortcut: 'O', action: () => setInOut('out') },
    { divider: true },
    {
      label: 'Playback Resolution',
      submenu: [1, 0.5, 0.25].map((v) => ({ label: v === 1 ? 'Full' : `1/${1 / v}`, checked: s.previewScale === v, action: () => setS({ previewScale: v }) })),
    },
    { label: 'Safe Margins', checked: s.showSafe, action: () => setS({ showSafe: !s.showSafe }) },
    { divider: true },
    { label: 'Ask the AI about this frame', action: () => (useChat.setState({ attachFrame: true }), setDraft('About the current frame: ')) },
  ];
}

function sourceMenu(): MenuItem[] {
  const s = S();
  const src = s.source;
  const m = s.project.media.find((x) => x.id === src.mediaId);
  if (!m) return [{ label: 'Import…', shortcut: 'Ctrl+I', action: importDialog }];
  return [
    { label: 'Insert into Sequence', shortcut: ',', action: () => sourceToTimeline('insert') },
    { label: 'Overwrite into Sequence', shortcut: '.', action: () => sourceToTimeline('overwrite') },
    { divider: true },
    { label: 'Mark In', action: () => setS({ source: { ...src, in: src.time } }) },
    { label: 'Mark Out', action: () => setS({ source: { ...src, out: src.time } }) },
    { label: 'Clear In and Out', disabled: src.in == null && src.out == null, action: () => setS({ source: { ...src, in: null, out: null } }) },
    { divider: true },
    { label: 'Reveal in Project', action: () => setS({ selectedMediaId: m.id, bottomTab: 'project' }) },
  ];
}

function binMenu(): MenuItem[] {
  return [
    { label: 'Import…', shortcut: 'Ctrl+I', action: importDialog },
    { divider: true },
    { label: 'New Text Layer', shortcut: 'Ctrl+T', action: () => addTextAt() },
    { label: 'New Color Matte', action: () => addColorMatte() },
    { label: 'New Adjustment Layer', action: addAdjustmentLayer },
  ];
}

function chatMenu(target: HTMLElement): MenuItem[] {
  const id = (target.closest('[data-chat-id]') as HTMLElement | null)?.dataset.chatId;
  const item = id ? useChat.getState().items.find((i) => i.id === id) : undefined;
  const base: MenuItem[] = [
    { label: 'New Conversation', action: newChat },
    { label: 'Hide Panel', shortcut: 'Ctrl+J', action: () => setS({ showChat: false }) },
  ];
  if (!item) return base;
  if (item.kind === 'user') {
    return [
      { label: 'Copy Message', action: () => copyText(item.text) },
      { label: 'Edit and Resend', action: () => setDraft(item.text) },
      { divider: true },
      ...base,
    ];
  }
  if (item.kind === 'assistant') return [{ label: 'Copy Reply', action: () => copyText(item.text) }, { divider: true }, ...base];
  if (item.kind === 'tool') {
    return [
      { label: 'Copy Tool Input', action: () => copyText(JSON.stringify(item.input, null, 2)) },
      { label: 'Copy Result', disabled: !item.result, action: () => copyText(item.result ?? '') },
      { divider: true },
      ...base,
    ];
  }
  return base;
}

function menuFor(e: MouseEvent): MenuItem[] | null {
  const el = e.target as HTMLElement;
  const field = el.closest('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
  if (field) return textFieldMenu(field);

  let items: MenuItem[];
  if (el.closest('.chat')) items = chatMenu(el);
  else if (el.closest('.tl-th')) {
    const id = (el.closest('.tl-row')?.querySelector('[data-track]') as HTMLElement | null)?.dataset.track;
    items = id ? trackMenu(id) : generalMenu();
  } else if (el.closest('.tl-lane')) items = laneMenu((el.closest('.tl-lane') as HTMLElement).dataset.track!, timeAtClientX(e.clientX));
  else if (el.closest('.tl-ruler, .tl-ruler-row')) items = rulerMenu(timeAtClientX(e.clientX));
  else if (el.closest('.monitor.program')) items = programMenu();
  else if (el.closest('.monitor.source')) items = sourceMenu();
  else if (el.closest('.project-panel')) items = binMenu();
  else if (el.closest('.menubar, .ctx-menu, .modal')) return null;
  else items = generalMenu();

  // selected text anywhere (chat replies, tool output, dialogs) can be copied
  const sel = window.getSelection();
  const text = sel?.toString() ?? '';
  if (text.trim() && sel?.anchorNode && el.contains(sel.anchorNode)) items = [{ label: 'Copy', shortcut: 'Ctrl+C', action: () => copyText(text) }, { divider: true }, ...items];
  return items;
}

export function installContextMenus() {
  window.addEventListener('contextmenu', (e) => {
    // clips, bin items and markers already showed their own menu
    if (e.defaultPrevented) return;
    // in the browser, text boxes keep the browser's own menu (spelling suggestions and all)
    if (isWeb && (e.target as HTMLElement).closest('input, textarea')) return;
    e.preventDefault();
    const items = menuFor(e);
    if (items?.length) openContextMenu(e.clientX, e.clientY, items);
  });
}

