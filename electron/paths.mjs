// App folders, shared by the Electron app and the local web server (same settings and media cache).
import os from 'node:os';
import path from 'node:path';

let override = null;

/** Electron passes app.getPath values; the web server uses the same defaults Electron would. */
export function setPaths(p) {
  override = p;
}

export function userDataDir() {
  if (override?.userData) return override.userData;
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'IngrainedCut');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'IngrainedCut');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'IngrainedCut');
}

export function documentsDir() {
  return override?.documents ?? path.join(os.homedir(), 'Documents');
}
