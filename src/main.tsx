import { isWeb, isSite } from './webBridge'; // must run first: provides window.icut in the browser
import { SiteGate } from './components/SiteGate';
import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { useEditor, updateMedia, toast, stripForFile, getAutosaveKey, setS } from './store';
import { installShortcuts } from './shortcuts';
import { installToolBridge, runTool } from './claudeTools';
import { installContextMenus } from './components/contextMenus';
import { installChatBridge, useChat, switchProjectChat, setChatProjectPath } from './chatStore';
import { openProject, saveProject } from './actions';

installShortcuts();
installToolBridge();
installChatBridge();

window.icut.onMediaUpdate(({ id, patch }) => updateMedia(id, patch));
window.icut.onToast(({ message }) => toast(message));

// keep the main process (Claude's main-side tools, external MCP) in sync with the project
let syncTimer: ReturnType<typeof setTimeout> | undefined;
// (the autosave id rides along so the main process can autosave a project that was never saved)
const sync = () => window.icut.syncProject({ ...stripForFile(useEditor.getState().project), _autosaveKey: getAutosaveKey() });
sync();
useEditor.subscribe((s, prev) => {
  if (s.project !== prev.project) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, 120);
  }
  if (s.dirty !== prev.dirty) window.icut.setDirty(s.dirty);
  // one chat per project: another project opened → its chat; this project saved to a new file → the chat follows it
  if (s.loadSeq !== prev.loadSeq) switchProjectChat(s.project.path ?? null, getAutosaveKey());
  else if (s.project.path !== prev.project.path) setChatProjectPath(s.project.path ?? null);
  if (s.project.name !== prev.project.name || s.dirty !== prev.dirty) document.title = `${s.project.name}${s.dirty ? ' *' : ''} — IngrainedCut`;
});

// closing the window → "Save": save (asking where, for a new project), then let the window close
window.icut.onSaveAndClose(async () => {
  const saved = await saveProject().catch(() => null);
  window.icut.closeAfterSave(!!saved);
});

installContextMenus();
window.addEventListener('dragover', (e) => e.preventDefault());
if (isWeb) {
  document.body.classList.add('web');
  if (isSite) document.body.classList.add('site');
  // closing the tab with unsaved changes: the browser shows its own "Leave site?" prompt
  window.addEventListener('beforeunload', (e) => {
    if (useEditor.getState().dirty) e.preventDefault();
  });
}
window.addEventListener('drop', (e) => e.preventDefault());

createRoot(document.getElementById('root')!).render(
  isSite ? (
    <SiteGate>
      <App />
    </SiteGate>
  ) : (
    <App />
  ),
);

// open a project passed on the command line (e.g. `IngrainedCut "My Edit.icut"`); otherwise start on the start page
if (!isSite) {
  setS({ startPage: true });
  window.icut.appInfo().then((i) => {
    if (i.startupProject) openProject(i.startupProject);
  });
}

// debugging handle (DevTools console): __icut.S().project etc.
(window as any).__icut = { S: () => useEditor.getState(), tool: runTool, chat: useChat };
