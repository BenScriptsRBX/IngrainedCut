// Autosave: snapshots of the open project in the app's data folder (never in the user's own project files), so a crash,
// a close without saving or a save over the wrong file can be undone from the start page.
//   autosave/<key>/<time>-auto.icut      the project as it was being edited (every ~20 s while there are unsaved changes)
//   autosave/<key>/<time>-replaced.icut  a project file as it was just before Save wrote over it
//   autosave/<key>/meta.json             the project's own file path and name
// <key> is a hash of the project's file path, or a per-session id for a project that was never saved.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { userDataDir } from './paths.mjs';

const KEEP = 12; // snapshots of each kind kept per project
const MAX_PROJECTS = 40;

const root = () => path.join(userDataDir(), 'autosave');

export function keyFor(projectPath) {
  return projectPath ? 'p-' + crypto.createHash('sha1').update(path.resolve(projectPath).toLowerCase()).digest('hex').slice(0, 12) : null;
}

export const hasContent = (d) => (d?.clips?.length ?? 0) + (d?.media?.length ?? 0) > 0;

const snapshotFiles = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.icut')).sort().reverse();

/** Writes one snapshot. Empty projects are never kept (an empty autosave can't help anyone). */
export function writeSnapshot(key, data, kind = 'auto') {
  if (!key || !hasContent(data)) return null;
  const dir = path.join(root(), key);
  fs.mkdirSync(dir, { recursive: true });
  const { _autosaveKey, ...clean } = data;
  const file = path.join(dir, `${Date.now()}-${kind}.icut`);
  fs.writeFileSync(file, JSON.stringify(clean));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ path: clean.path ?? null, name: clean.name ?? 'Untitled Project' }));
  const all = snapshotFiles(dir);
  for (const k of ['-auto', '-replaced']) for (const f of all.filter((x) => x.includes(k)).slice(KEEP)) fs.rmSync(path.join(dir, f), { force: true });
  pruneProjects();
  return file;
}

function pruneProjects() {
  const dirs = fs
    .readdirSync(root(), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ d: path.join(root(), d.name), t: fs.statSync(path.join(root(), d.name)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const x of dirs.slice(MAX_PROJECTS)) fs.rmSync(x.d, { recursive: true, force: true });
}

/** Clip and media counts and length of a project file (null when it can't be read). */
export function summarize(file) {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    const end = Math.max(0, ...(d.clips ?? []).map((c) => (c.start ?? 0) + (c.duration ?? 0)));
    return { name: d.name ?? path.basename(file, '.icut'), clips: d.clips?.length ?? 0, media: d.media?.length ?? 0, duration: end };
  } catch {
    return null;
  }
}

/** Every project with autosaves, newest first, each with its snapshots (newest first). */
export function listAutosaves(limit = 20) {
  if (!fs.existsSync(root())) return [];
  const out = [];
  for (const d of fs.readdirSync(root(), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = path.join(root(), d.name);
    let meta = { path: null, name: 'Untitled Project' };
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    } catch {}
    const files = snapshotFiles(dir);
    if (!files.length) continue;
    out.push({ key: d.name, ...meta, latest: Number(files[0].split('-')[0]), files, dir });
  }
  out.sort((a, b) => b.latest - a.latest);
  return out.slice(0, limit).map(({ files, dir, ...p }) => ({
    ...p,
    fileExists: !!p.path && fs.existsSync(p.path),
    fileTime: p.path && fs.existsSync(p.path) ? fs.statSync(p.path).mtimeMs : null,
    fileClips: p.path && fs.existsSync(p.path) ? (summarize(p.path)?.clips ?? null) : null,
    versions: files.map((f) => ({ file: path.join(dir, f), time: Number(f.split('-')[0]), kind: f.includes('-replaced') ? 'replaced' : 'auto', ...summarize(path.join(dir, f)) })),
  }));
}

/** Only files inside the autosave folder can be opened as autosaves. */
export function isAutosaveFile(file) {
  const rel = path.relative(root(), path.resolve(file));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel) && file.endsWith('.icut');
}
