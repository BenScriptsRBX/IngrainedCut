// IngrainedCut desktop app: an Electron window around the shared engine (core.mjs).
import { app, BrowserWindow, ipcMain, dialog, protocol, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { setPaths } from './paths.mjs';
import { openMedia } from './mediaServe.mjs';
import { createCore, ROOT } from './core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

setPaths({ userData: app.getPath('userData'), documents: app.getPath('documents') });

protocol.registerSchemesAsPrivileged([
  { scheme: 'icut', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } },
]);

let win = null;
let core = null;

function registerMediaProtocol() {
  protocol.handle('icut', async (req) => {
    const u = new URL(req.url);
    const r = openMedia(decodeURIComponent(u.pathname.slice(1)), req.headers.get('range'));
    const headers = { ...r.headers, 'Access-Control-Allow-Origin': '*' };
    return new Response(r.stream ? Readable.toWeb(r.stream) : r.status === 404 ? 'not found' : null, { status: r.status, headers });
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#161616',
    title: 'IngrainedCut',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a1a1a', symbolColor: '#bdbdbd', height: 34 },
    icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.setMenu(null);
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) win.loadURL(dev);
  else win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  win.on('close', (e) => {
    if (!core?.isDirty()) return;
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Quit without saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes.',
      detail: 'Quit IngrainedCut anyway?',
    });
    if (r === 1) e.preventDefault();
  });
  win.on('closed', () => (win = null));
}

const MEDIA_FILTERS = [
  { name: 'Media', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
  { name: 'All Files', extensions: ['*'] },
];

app.whenReady().then(() => {
  registerMediaProtocol();
  createWindow();
  core = createCore({
    handle: (ch, fn) => ipcMain.handle(ch, (_e, ...args) => fn(...args)),
    on: (ch, fn) => ipcMain.on(ch, (_e, payload) => fn(payload)),
    emit: (ch, payload) => win?.webContents.send(ch, payload),
    hasEditor: () => !!win,
    version: app.getVersion(),
    startupProject: process.argv.find((a) => /\.icut$/i.test(a) && fs.existsSync(a)) ?? null,
    dialogs: {
      openMedia: async () => {
        const r = await dialog.showOpenDialog(win, { title: 'Import Media', properties: ['openFile', 'multiSelections'], filters: MEDIA_FILTERS });
        return r.canceled ? [] : r.filePaths;
      },
      save: async (opts) => {
        const r = await dialog.showSaveDialog(win, opts);
        return r.canceled ? null : r.filePath;
      },
      openProject: async () => {
        const r = await dialog.showOpenDialog(win, { title: 'Open Project', properties: ['openFile'], filters: [{ name: 'IngrainedCut Project', extensions: ['icut'] }] });
        return r.canceled ? null : r.filePaths[0];
      },
      chooseFile: async (opts) => {
        const r = await dialog.showOpenDialog(win, { properties: ['openFile'], ...opts });
        return r.canceled ? null : r.filePaths[0];
      },
    },
    shell: { reveal: (p) => shell.showItemInFolder(p), openExternal: (url) => shell.openExternal(url) },
    screenshot: async () => {
      if (!win) return null;
      let img = await win.webContents.capturePage();
      if (img.getSize().width > 1600) img = img.resize({ width: 1600, quality: 'good' });
      return img.toJPEG(82).toString('base64');
    },
    window: { devtools: () => win?.webContents.toggleDevTools(), reload: () => win?.webContents.reload() },
  });
});

app.on('window-all-closed', () => {
  core?.shutdown();
  app.quit();
});
app.on('before-quit', () => core?.shutdown());
