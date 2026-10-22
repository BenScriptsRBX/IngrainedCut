import { userDataDir } from './paths.mjs';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  apiKey: '',
  model: 'claude-opus-5-5',
  effort: 'medium',
  whisperModel: '',
  autoApproveAll: false,
  recentProjects: [],
};

let cache = null;

function file() {
  return path.join(userDataDir(), 'settings.json');
}

export function getSettings() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function saveSettings(patch) {
  cache = { ...getSettings(), ...patch };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  return cache;
}

export function addRecentProject(p) {
  const list = [p, ...getSettings().recentProjects.filter((x) => x !== p)].slice(0, 10);
  saveSettings({ recentProjects: list });
}
