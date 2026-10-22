import type { Clip } from '../types';
import type { MenuItem } from './ContextMenu';
import { S, setS, commit, undo, redo } from '../store';
import {
  addAdjustmentLayer, addColorMatte, addDefaultTransition, addMarker, addTextAt, applyTransition, copySelection, cutSelection, deleteSelection,
  exportFrame, goToEdit, importDialog, liftExtract, newProjectAction, openProject, paste, saveProject, selectAll, setInOut, splitAtPlayhead,
  toggleEnable, toggleLink, withLinks, rippleTrimToPlayhead,
} from '../actions';
import { closeGaps, ensureTrack, tracksOf } from '../ops';
import { engine } from '../engine';
import { setDraft } from '../chatStore';
import { isSite } from '../webBridge';
import { zoomTimeline, zoomToFit } from './Timeline';
import { LOOKS } from '../grade';
import { applyLook, autoColor, copyGrade, hasCopiedGrade, pasteGrade, resetGrade } from '../colorActions';
import { addEditAllTracks, sceneEditDetection, splitAtMarkers } from '../cutTools';

/** How many separate clip groups (linked clips count once) are selected — Synchronize needs two. */
const selectedGroups = () => new Set(S().project.clips.filter((c) => S().selection.includes(c.id)).map((c) => c.linkId || c.id)).size;

function colorItems(ids: string[], first?: string): MenuItem[] {
  const id = first ?? ids[0];
  return [
    { label: 'Auto Color', disabled: !id, action: () => autoColor(id) },
    { label: 'Copy Grade', disabled: !id, action: () => copyGrade(id) },
    { label: 'Paste Grade', disabled: !ids.length || !hasCopiedGrade(), action: () => pasteGrade(ids) },
    {
      label: 'Look',
      disabled: !ids.length,
      submenu: [{ label: 'None', action: () => applyLook(ids, null) }, { divider: true }, ...LOOKS.map((l) => ({ label: l.name, action: () => applyLook(ids, l.id) }))],
    },
    { label: 'Reset Grade', disabled: !ids.length, action: () => resetGrade(ids) },
    { label: 'Open Color Grading', action: () => setS({ leftTab: 'color' }) },
  ];
}

const LABELS = [
  ['Violet', '#7b62c9'], ['Iris', '#5468c4'], ['Caribbean', '#2b9478'], ['Lavender', '#9a68c9'], ['Cerulean', '#2c8fc9'], ['Forest', '#4f8a3a'],
  ['Rose', '#c0538f'], ['Mango', '#d08a2e'], ['Purple', '#8d4cbf'], ['Blue', '#3d5fd1'], ['Teal', '#2aa5a5'], ['Magenta', '#c33bb5'], ['Tan', '#b59a6e'], ['Brown', '#8a5a3c'], ['Yellow', '#c9b23a'],
];

export function clipMenu(c: Clip): MenuItem[] {
  const s = S();
  const sel = s.selection.length ? s.selection : [c.id];
  return [
    { label: 'Cut', shortcut: 'Ctrl+X', action: cutSelection },
    { label: 'Copy', shortcut: 'Ctrl+C', action: copySelection },
    { label: 'Clear', shortcut: 'Delete', action: () => deleteSelection(false) },
    { label: 'Ripple Delete', shortcut: 'Shift+Del', action: () => deleteSelection(true) },
    { divider: true },
    { label: 'Add Edit at Playhead', shortcut: 'Ctrl+K', action: splitAtPlayhead, disabled: !(s.playhead > c.start && s.playhead < c.start + c.duration) },
    { label: 'Enable', checked: c.enabled, shortcut: 'Shift+E', action: toggleEnable },
    { label: c.linkId ? 'Unlink' : 'Link', action: toggleLink },
    { divider: true },
    { label: 'Speed/Duration…', shortcut: 'Ctrl+R', action: () => setS({ dialog: 'speed' }) },
    { label: 'Synchronize…', disabled: selectedGroups() < 2, action: () => setS({ dialog: 'sync' }) },
    { label: 'Scene Edit Detection', disabled: c.kind !== 'video', action: () => sceneEditDetection() },
    { label: 'Remove Silence…', action: () => setS({ dialog: 'silence' }) },
    ...(c.kind !== 'audio' ? [{ label: 'Color', submenu: colorItems(sel.filter((id) => s.project.clips.find((x) => x.id === id)?.kind !== 'audio'), c.id) }] : []),
    {
      label: 'Transitions',
      submenu: [
        { label: 'Cross Dissolve (in)', action: () => applyTransition(sel, 'in', 'cross-dissolve', 1) },
        { label: 'Dip to Black (in)', action: () => applyTransition(sel, 'in', 'dip-to-black', 1) },
        { label: 'Fade to Black (out)', action: () => applyTransition(sel, 'out', 'dip-to-black', 1) },
        { label: 'Cross Dissolve (both ends)', action: () => applyTransition(sel, 'both', 'cross-dissolve', 1) },
        { divider: true },
        { label: 'Remove Transitions', action: () => commit('Remove Transitions', (d) => d.clips.forEach((x) => sel.includes(x.id) && ((x.transitionIn = null), (x.transitionOut = null)))) },
      ],
    },
    {
      label: 'Label',
      submenu: LABELS.map(([name, color]) => ({ label: name, color, action: () => commit('Label', (d) => d.clips.forEach((x) => withLinks(sel).includes(x.id) && (x.label = color))) })).concat([
        { label: 'Default', color: 'transparent', action: () => commit('Label', (d) => d.clips.forEach((x) => withLinks(sel).includes(x.id) && (x.label = undefined))) },
      ] as any),
    },
    {
      label: 'Rename…',
      action: () => {
        const name = window.prompt('Clip name', c.name);
        if (name) commit('Rename Clip', (d) => void (d.clips.find((x) => x.id === c.id)!.name = name));
      },
    },
    { divider: true },
    { label: 'Reveal in Project', disabled: !c.mediaId, action: () => setS({ selectedMediaId: c.mediaId!, bottomTab: 'project' }) },
    { label: 'Open in Source Monitor', disabled: !c.mediaId, action: () => setS({ source: { mediaId: c.mediaId!, in: c.in, out: c.in + c.duration * c.speed, time: c.in }, leftTab: 'source' }) },
    { divider: true },
    { label: '✦ Ask Claude about this clip', action: () => setDraft(`About clip ${sel.join(', ')}: `) },
  ];
}

export function menubar(): { label: string; items: MenuItem[] }[] {
  const s = S();
  return [
    {
      label: 'File',
      items: [
        ...(isSite
          ? [
              { label: 'All Projects', action: () => (location.href = '/projects') },
              { label: 'Save', shortcut: 'Ctrl+S', action: () => saveProject() },
              { label: 'Save a Copy to This Computer…', shortcut: 'Ctrl+Shift+S', action: () => saveProject(true) },
            ]
          : [
              { label: 'New Project', shortcut: 'Ctrl+Alt+N', action: newProjectAction },
              { label: 'Open Project…', shortcut: 'Ctrl+O', action: () => openProject() },
              { label: 'Save', shortcut: 'Ctrl+S', action: () => saveProject() },
              { label: 'Save As…', shortcut: 'Ctrl+Shift+S', action: () => saveProject(true) },
            ]),
        { divider: true },
        { label: 'Import…', shortcut: 'Ctrl+I', action: importDialog },
        { divider: true },
        { label: 'Export Media…', shortcut: 'Ctrl+M', action: () => setS({ dialog: 'export' }) },
        { label: 'Export Frame', shortcut: 'Ctrl+Shift+E', action: exportFrame },
        { divider: true },
        { label: 'Settings…', action: () => setS({ dialog: 'settings' }) },
        ...(isSite ? [] : [{ label: 'Exit', action: () => window.close() }]),
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: `Undo ${s.past[s.past.length - 1]?.label ?? ''}`, shortcut: 'Ctrl+Z', disabled: !s.past.length, action: () => undo() },
        { label: `Redo ${s.future[0]?.label ?? ''}`, shortcut: 'Ctrl+Shift+Z', disabled: !s.future.length, action: () => redo() },
        { divider: true },
        { label: 'Cut', shortcut: 'Ctrl+X', action: cutSelection },
        { label: 'Copy', shortcut: 'Ctrl+C', action: copySelection },
        { label: 'Paste', shortcut: 'Ctrl+V', action: () => paste(false) },
        { label: 'Paste Insert', shortcut: 'Ctrl+Shift+V', action: () => paste(true) },
        { label: 'Clear', shortcut: 'Delete', action: () => deleteSelection(false) },
        { label: 'Ripple Delete', shortcut: 'Shift+Delete', action: () => deleteSelection(true) },
        { divider: true },
        { label: 'Select All', shortcut: 'Ctrl+A', action: selectAll },
        { label: 'Deselect All', shortcut: 'Ctrl+Shift+A', action: () => setS({ selection: [] }) },
        { divider: true },
        { label: 'Keyboard Shortcuts', action: () => setS({ dialog: 'shortcuts' }) },
      ],
    },
    {
      label: 'Clip',
      items: [
        { label: 'Speed/Duration…', shortcut: 'Ctrl+R', action: () => setS({ dialog: 'speed' }), disabled: !s.selection.length },
        { label: 'Enable', shortcut: 'Shift+E', action: toggleEnable, disabled: !s.selection.length },
        { label: 'Link / Unlink', shortcut: 'Ctrl+L', action: toggleLink, disabled: !s.selection.length },
        { divider: true },
        { label: 'Synchronize…', disabled: selectedGroups() < 2, action: () => setS({ dialog: 'sync' }) },
        { label: 'Scene Edit Detection', disabled: !s.selection.length, action: () => sceneEditDetection() },
        { divider: true },
        { label: 'Color', submenu: colorItems(s.project.clips.filter((c) => s.selection.includes(c.id) && c.kind !== 'audio').map((c) => c.id)) },
        { divider: true },
        { label: 'Apply Default Transition', shortcut: 'Ctrl+D', action: addDefaultTransition },
        { label: 'Ripple Trim Previous Edit to Playhead', shortcut: 'Q', action: () => rippleTrimToPlayhead('start') },
        { label: 'Ripple Trim Next Edit to Playhead', shortcut: 'W', action: () => rippleTrimToPlayhead('end') },
      ],
    },
    {
      label: 'Sequence',
      items: [
        { label: 'Sequence Settings…', action: () => setS({ dialog: 'sequence' }) },
        { divider: true },
        { label: 'Add Edit', shortcut: 'Ctrl+K', action: splitAtPlayhead },
        { label: 'Add Edit to All Tracks', shortcut: 'Ctrl+Shift+K', action: addEditAllTracks },
        { label: 'Split at Markers', disabled: !s.project.markers.length, action: splitAtMarkers },
        { label: 'Remove Silence…', action: () => setS({ dialog: 'silence' }) },
        { label: 'Lift', shortcut: ';', action: () => liftExtract(false) },
        { label: 'Extract', shortcut: "'", action: () => liftExtract(true) },
        { label: 'Close Gaps', action: () => commit('Close Gaps', (d) => closeGaps(d)) },
        { divider: true },
        { label: 'Mark In', shortcut: 'I', action: () => setInOut('in') },
        { label: 'Mark Out', shortcut: 'O', action: () => setInOut('out') },
        { label: 'Clear In and Out', shortcut: 'Ctrl+Shift+X', action: () => commit('Clear In/Out', (d) => ((d.inPoint = null), (d.outPoint = null))) },
        { label: 'Go to Next Edit Point', shortcut: 'Down', action: () => goToEdit(1) },
        { label: 'Go to Previous Edit Point', shortcut: 'Up', action: () => goToEdit(-1) },
        { divider: true },
        { label: 'Add Video Track', action: () => commit('Add Track', (d) => void ensureTrack(d, 'video', tracksOf(d, 'video').length)) },
        { label: 'Add Audio Track', action: () => commit('Add Track', (d) => void ensureTrack(d, 'audio', tracksOf(d, 'audio').length)) },
        { divider: true },
        { label: 'Snap in Timeline', checked: s.snapping, shortcut: 'S', action: () => setS({ snapping: !s.snapping }) },
        { label: 'Linked Selection', checked: s.linkedSelection, action: () => setS({ linkedSelection: !s.linkedSelection }) },
      ],
    },
    {
      label: 'Markers',
      items: [
        { label: 'Add Marker', shortcut: 'M', action: () => addMarker() },
        { label: 'Go to Next Marker', shortcut: 'Shift+M', action: () => gotoMarker(1) },
        { label: 'Go to Previous Marker', shortcut: 'Ctrl+Shift+M', action: () => gotoMarker(-1) },
        { label: 'Clear All Markers', action: () => commit('Clear Markers', (d) => void (d.markers = [])) },
      ],
    },
    {
      label: 'Graphics',
      items: [
        { label: 'New Layer: Text', shortcut: 'Ctrl+T', action: () => addTextAt() },
        { label: 'New Layer: Color Matte', action: () => addColorMatte() },
        { label: 'New Layer: Adjustment Layer', action: addAdjustmentLayer },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Playback Resolution: Full', checked: s.previewScale === 1, action: () => setS({ previewScale: 1 }) },
        { label: 'Playback Resolution: 1/2', checked: s.previewScale === 0.5, action: () => setS({ previewScale: 0.5 }) },
        { label: 'Playback Resolution: 1/4', checked: s.previewScale === 0.25, action: () => setS({ previewScale: 0.25 }) },
        { divider: true },
        { label: 'Safe Margins', checked: s.showSafe, action: () => setS({ showSafe: !s.showSafe }) },
        { divider: true },
        { label: 'Zoom In Timeline', shortcut: '=', action: () => zoomTimeline(1.5) },
        { label: 'Zoom Out Timeline', shortcut: '-', action: () => zoomTimeline(1 / 1.5) },
        { label: 'Zoom to Sequence', shortcut: '\\', action: zoomToFit },
      ],
    },
    {
      label: 'Window',
      items: [
        { label: 'Claude Assistant', checked: s.showChat, shortcut: 'Ctrl+J', action: () => setS({ showChat: !s.showChat }) },
        { label: 'Source Monitor', action: () => setS({ leftTab: 'source' }) },
        { label: 'Effect Controls', action: () => setS({ leftTab: 'effectControls' }) },
        { label: 'Color Grading', action: () => setS({ leftTab: 'color' }) },
        { label: 'Audio Track Mixer', action: () => setS({ leftTab: 'mixer' }) },
        { label: 'Project', action: () => setS({ bottomTab: 'project' }) },
        { label: 'Effects', action: () => setS({ bottomTab: 'effects' }) },
        { label: 'History', action: () => setS({ bottomTab: 'history' }) },
        { divider: true },
        { label: 'Reload Window', action: () => window.icut.reload() },
        { label: 'Developer Tools', shortcut: 'F12', action: () => window.icut.devtools() },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Connect Claude Code (MCP)…', action: () => setS({ dialog: 'mcp' }) },
        { label: 'Keyboard Shortcuts', action: () => setS({ dialog: 'shortcuts' }) },
        { label: 'About IngrainedCut', action: () => setS({ dialog: 'about' }) },
      ],
    },
  ];
}

export function gotoMarker(dir: 1 | -1) {
  const s = S();
  const ts = s.project.markers.map((m) => m.time).sort((a, b) => a - b);
  const t = dir > 0 ? ts.find((x) => x > s.playhead + 1e-3) : [...ts].reverse().find((x) => x < s.playhead - 1e-3);
  if (t != null) engine.seek(t);
}
