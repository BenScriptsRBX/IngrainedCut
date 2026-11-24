// IngrainedCut Helper for Windows: the website's helper (server/web.mjs) as a small tray app with a normal installer,
// so editing with AI on the website needs no terminal command and no Node.js. The website starts it when needed
// through an ingrainedcut:// link (Connect in the editor; the browser asks once to open it), and it quits by itself after
// a while with no editor connected. "Start when Windows starts" in the tray menu keeps it running instead.
// Packaged by scripts/pack-helper-app.mjs.
import { app, Tray, Menu, shell, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'site.json'), 'utf8'));
const SITE_URL = SITE.openUrl;
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const PROTOCOL = 'ingrainedcut';
const IDLE_QUIT_MS = 30 * 60_000; // with no editor connected this long (and not set to start with Windows): quit

const byLink = (argv) => argv.some((a) => String(a).toLowerCase().startsWith(`${PROTOCOL}:`));
let tray = null;

if (!app.requestSingleInstanceLock()) {
  // already running: the running copy handles it (second-instance below)
  app.quit();
} else {
  const launchedByLink = byLink(process.argv);
  // opened again from the Start menu: open the website; started by the website's link: it's already running
  app.on('second-instance', (_e, argv) => {
    if (!byLink(argv)) shell.openExternal(SITE_URL);
  });
  // the helper reads its options from the command line; the app always runs it in the background
  process.env.ICUT_HELPER_APP = '1';
  process.argv = [process.argv[0], 'ingrainedcut-helper', '--no-open'];
  app.on('window-all-closed', () => {}); // no windows: keep running

  app.whenReady().then(async () => {
    // ingrainedcut:// opens this app (the installer registers it too; this keeps it pointing at this copy)
    app.setAsDefaultProtocolClient(PROTOCOL);
    const stateFile = path.join(app.getPath('userData'), 'helper-app.json');
    let state = {};
    try {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch {}
    const firstRun = !state.started;

    let helper = null;
    try {
      helper = await import(pathToFileURL(path.join(ROOT, 'server', 'web.mjs')).href);
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

    // started for editing: quit again once no editor has been connected for a while (unless it starts with Windows)
    let idleSince = Date.now();
    setInterval(() => {
      const connected = (helper?.connectedEditors?.() ?? 0) > 0;
      if (connected) idleSince = Date.now();
      else if (!app.getLoginItemSettings().openAtLogin && Date.now() - idleSince > IDLE_QUIT_MS) app.exit(0);
    }, 60_000);

    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ ...state, started: true }));
    // right after installing (not when the website started it): take the user to the website
    if (firstRun && !launchedByLink) shell.openExternal(SITE_URL);
  });
}
