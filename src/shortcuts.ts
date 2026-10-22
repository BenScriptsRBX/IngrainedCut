import { isWeb, isSite } from './webBridge';
import { S, setS, undo, redo, commit } from './store';
import { engine } from './engine';
import {
  addDefaultTransition, addMarker, addTextAt, copySelection, cutSelection, deleteSelection, exportFrame, goToEdit, importDialog, liftExtract,
  newProjectAction, nudgeSelection, openProject, paste, rippleTrimToPlayhead, saveProject, selectAll, setInOut, sourceToTimeline, splitAtPlayhead,
  stepFrames, toggleEnable, toggleLink,
} from './actions';
import { razor, sequenceDuration } from './ops';
import { zoomTimeline, zoomToFit } from './components/Timeline';
import { gotoMarker } from './components/menus';
import type { ToolId } from './types';

const TOOLS: Record<string, ToolId> = { v: 'select', a: 'trackfwd', b: 'ripple', n: 'rolling', r: 'rate', c: 'razor', y: 'slip', u: 'slide', h: 'hand', t: 'type' };

export function installShortcuts() {
  const onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    if (S().dialog) return;
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    const run = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    if (e.key === 'F12' && !isWeb) return run(() => window.icut.devtools());
    if (ctrl) {
      if (k === 'z' && !e.shiftKey) return run(() => undo());
      if ((k === 'z' && e.shiftKey) || k === 'y') return run(() => redo());
      if (k === 'x' && e.shiftKey) return run(() => commit('Clear In/Out', (d) => ((d.inPoint = null), (d.outPoint = null))));
      if (k === 'x') return run(cutSelection);
      if (k === 'c') return run(copySelection);
      if (k === 'v') return run(() => paste(e.shiftKey));
      if (k === 'k' && e.shiftKey) return run(() => commit('Add Edit to All Tracks', (d) => razor(d, S().playhead)));
      if (k === 'k') return run(splitAtPlayhead);
      if (k === 'd') return run(addDefaultTransition);
      if (k === 's') return run(() => saveProject(e.shiftKey));
      if (k === 'o') return run(() => (isSite ? (location.href = '/projects') : openProject()));
      if (k === 'i') return run(importDialog);
      if (k === 'm' && e.shiftKey) return run(() => gotoMarker(-1));
      if (k === 'm') return run(() => setS({ dialog: 'export' }));
      if (k === 'n' && e.altKey) return run(() => (isSite ? (location.href = '/projects') : newProjectAction()));
      if (k === 'a' && e.shiftKey) return run(() => setS({ selection: [] }));
      if (k === 'a') return run(selectAll);
      if (k === 'r') return run(() => S().selection.length && setS({ dialog: 'speed' }));
      if (k === 'l') return run(toggleLink);
      if (k === 't') return run(() => addTextAt());
      if (k === 'j') return run(() => setS({ showChat: !S().showChat }));
      if (k === 'e' && e.shiftKey) return run(exportFrame);
      return;
    }
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return run(() => nudgeSelection(e.key === 'ArrowLeft' ? (e.shiftKey ? -5 : -1) : e.shiftKey ? 5 : 1));
    switch (e.key) {
      case ' ':
        return run(() => engine.toggle());
      case 'ArrowLeft':
        return run(() => stepFrames(e.shiftKey ? -5 : -1));
      case 'ArrowRight':
        return run(() => stepFrames(e.shiftKey ? 5 : 1));
      case 'ArrowUp':
        return run(() => goToEdit(-1));
      case 'ArrowDown':
        return run(() => goToEdit(1));
      case 'Home':
        return run(() => engine.seek(0));
      case 'End':
        return run(() => engine.seek(sequenceDuration(S().project)));
      case 'Delete':
      case 'Backspace':
        return run(() => deleteSelection(e.shiftKey));
      case 'Escape':
        return run(() => setS({ selection: [] }));
      case '=':
      case '+':
        return run(() => zoomTimeline(1.5));
      case '-':
        return run(() => zoomTimeline(1 / 1.5));
      case '\\':
        return run(zoomToFit);
      case ';':
        return run(() => liftExtract(false));
      case "'":
        return run(() => liftExtract(true));
      case ',':
        return run(() => sourceToTimeline('insert'));
      case '.':
        return run(() => sourceToTimeline('overwrite'));
      case '/':
        return run(() => (document.querySelector('.chat-input textarea') as HTMLTextAreaElement | null)?.focus());
    }
    if (e.shiftKey && k === 'e') return run(toggleEnable);
    if (e.shiftKey && k === 'm') return run(() => gotoMarker(1));
    switch (k) {
      case 'j':
        return run(() => engine.shuttle(-1));
      case 'k':
        return run(() => engine.pause());
      case 'l':
        return run(() => engine.shuttle(1));
      case 'i':
        return run(() => setInOut('in', e.altKey));
      case 'o':
        return run(() => setInOut('out', e.altKey));
      case 'm':
        return run(() => addMarker());
      case 'q':
        return run(() => rippleTrimToPlayhead('start'));
      case 'w':
        return run(() => rippleTrimToPlayhead('end'));
      case 's':
        return run(() => setS({ snapping: !S().snapping }));
    }
    if (TOOLS[k]) return run(() => setS({ tool: TOOLS[k] }));
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
