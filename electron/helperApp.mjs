// IngrainedCut Helper for Windows: the website's helper (server/web.mjs) as a small tray app with a normal installer,
// so editing with AI on the website needs no terminal command and no Node.js. It starts with Windows and runs in the
// background; the tray icon opens the website, toggles start-at-login, or quits. Packaged by scripts/pack-helper-app.mjs.
import { app, Tray, Menu, shell, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'site.json'), 'utf8'));
const SITE_URL = SITE.openUrl;
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let tray = null;

if (!app.requestSingleInstanceLock()) {
  // already running: opening it again just opens the website
  app.quit();
} else {
  app.on('second-instance', () => shell.openExternal(SITE_URL));
  // the helper reads its options from the command line; the app always runs it in the background
  process.env.ICUT_HELPER_APP = '1';
  process.argv = [process.argv[0], 'ingrainedcut-helper', '--no-open'];
  app.on('window-all-closed', () => {}); // no windows: keep running

  app.whenReady().then(async () => {
    const stateFile = path.join(app.getPath('userData'), 'helper-app.json');
    let state = {};
    try {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch {}
    const firstRun = !state.started;
    if (firstRun) app.setLoginItemSettings({ openAtLogin: true });

    try {
      await import(pathToFileURL(path.join(ROOT, 'server', 'web.mjs')).href);
    } catch (e) {
      console.error('helper failed to start', e);
    }

    const icon = nativeImage.createFromPath(path.join(ROOT, 'build', 'icon.png')).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip(`IngrainedCut helper ${pkg.version} — running`);
    const menu = () =>
      Menu.buildFromTemplate([
        { label: `IngrainedCut helper ${pkg.version} is running`, enabled: false },
        { label: 'Open IngrainedCut', click: () => shell.openExternal(SITE_URL) },
        { type: 'separator' },
        {
          label: 'Start when Windows starts',
          type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          click: (item) => {
            app.setLoginItemSettings({ openAtLogin: item.checked });
            tray.setContextMenu(menu());
          },
        },
        { type: 'separator' },
        { label: 'Quit the helper', click: () => app.exit(0) },
      ]);
    tray.setContextMenu(menu());
    tray.on('click', () => tray.popUpContextMenu());

    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ ...state, started: true }));
    // right after installing: take the user to the website, where the editor connects by itself
    if (firstRun) shell.openExternal(SITE_URL);
  });
}
