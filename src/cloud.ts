// Website mode: the editor is bound to a project in the user's account (/editor/?project=<id>).
// It loads the timeline from the website API and autosaves changes back. Media stays on the computer.
import type { MediaItem, Project } from './types';
import { S, setS, useEditor, loadProjectState, stripForFile, toast, updateMedia } from './store';
import { newProject } from './ops';
import { engine } from './engine';
import { engineMode, mediaSrc, uploadUrl } from './webBridge';
import { cacheUrl, isBrowserPath, readFile, storeFiles } from './browserEngine';

export const cloudProjectId = new URLSearchParams(location.search).get('project');

function toLogin() {
  location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
}

export async function loadCloudProject(): Promise<'ok' | 'notfound'> {
  const id = cloudProjectId!;
  const r = await fetch(`/api/projects/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
  if (r.status === 401) {
    toLogin();
    return 'ok';
  }
  if (r.status === 404) return 'notfound';
  if (!r.ok) throw new Error(`Could not load the project (HTTP ${r.status})`);
  const row = await r.json();
  const p: Project = row.data ? row.data : newProject();
  p.name = row.name;
  p.path = null;
  // each clip can have a copy on disk (helper) and one in this browser: use the one this session can read
  const switched = await pickCopies(p);
  const moved = engineMode() === 'helper' ? await moveBrowserMedia(p) : 0;
  for (const m of p.media) m.status = (await window.icut.exists(m.path)) ? 'loading' : 'missing';
  loadProjectState(p);
  setS({ cloud: { id, status: 'saved' } });
  engine.seek(0);
  for (const m of p.media) if (m.status !== 'missing') window.icut.refreshAssets({ id: m.id, path: m.path, info: m });
  const missing = p.media.filter((m) => m.status === 'missing').length;
  if (missing) {
    const msg =
      engineMode() === 'browser'
        ? `${missing} media file${missing === 1 ? " isn't" : "s aren't"} in this browser yet. Use “Locate files…” in the Project panel, or start the helper.`
        : `${missing} media file${missing === 1 ? " isn't" : "s aren't"} on this computer. They show as offline.`;
    toast(msg, 'error', 9000);
  }
  document.title = `${p.name} — IngrainedCut`;
  startAutosave();
  if (moved || switched) cloudSave();
  if (engineMode() === 'helper') startBrowserCopies();
  return 'ok';
}

const mediaUrlOf = (path: string) => 'icut://media/' + encodeURIComponent(path);

/** Point a media item at another copy of the same file, remembering the one it used. */
function useCopy(m: MediaItem, path: string) {
  m.copies = { ...(m.copies ?? {}), [isBrowserPath(m.path) ? 'browser' : 'disk']: m.path };
  m.path = path;
  m.url = mediaUrlOf(path);
  // thumbnails and waveform audio are rebuilt for the copy in use
  delete m.thumb;
  delete m.sprite;
  delete m.audioUrl;
}

async function pickCopies(p: Project) {
  let n = 0;
  for (const m of p.media) {
    const want = engineMode() === 'browser' ? (!isBrowserPath(m.path) ? m.copies?.browser : undefined) : isBrowserPath(m.path) ? m.copies?.disk : undefined;
    if (want && (await window.icut.exists(want))) {
      useCopy(m, want);
      n++;
    }
  }
  return n;
}

// ---- with the helper: keep a copy of each clip in this browser, so the project also opens without it ----
let copying = false;
const failed = new Set<string>();

async function freeBrowserSpace() {
  try {
    const e = await navigator.storage.estimate();
    return (e.quota ?? 0) - (e.usage ?? 0);
  } catch {
    return 0;
  }
}

async function copyNext(): Promise<boolean> {
  const m = S().project.media.find((x) => !isBrowserPath(x.path) && x.status === 'ready' && !x.copies?.browser && !failed.has(x.id));
  if (!m) return false;
  // leave a good margin of the browser's free storage
  if ((m.size ?? 0) > (await freeBrowserSpace()) * 0.8) {
    failed.add(m.id);
    return true;
  }
  try {
    const path = await cacheUrl(mediaSrc(m.url), m.path.split(/[\\/]/).pop() || m.name);
    const cur = S().project.media.find((x) => x.id === m.id);
    if (cur) updateMedia(m.id, { copies: { ...(cur.copies ?? {}), browser: path } });
  } catch (e) {
    console.warn('browser copy failed', m.name, e);
    failed.add(m.id);
  }
  return true;
}

async function runCopies() {
  if (copying) return;
  copying = true;
  try {
    navigator.storage.persist?.().catch(() => {});
    while (await copyNext()) {}
  } finally {
    copying = false;
  }
}

function startBrowserCopies() {
  setTimeout(runCopies, 2500);
  // new imports (or media finishing processing) get a copy too
  useEditor.subscribe((s, prev) => {
    if (s.project.media !== prev.project.media && s.project.media.some((x) => !isBrowserPath(x.path) && x.status === 'ready' && !x.copies?.browser && !failed.has(x.id))) {
      setTimeout(runCopies, 1500);
    }
  });
}

// ---- without the helper: find files that never got a browser copy ----
const base = (p: string) => p.split(/[\\/]/).pop()!.toLowerCase();

/** Match picked files to offline media (by file name, and size when known), copy them into this browser and relink. */
export async function locateMedia(files: File[]) {
  const offline = S().project.media.filter((m) => m.status === 'missing');
  let found = 0;
  for (const m of offline) {
    const names = [m.path, m.copies?.disk, m.name].filter(Boolean).map((x) => base(x!));
    const f = files.find((file) => names.includes(file.name.toLowerCase()) && (!m.size || file.size === m.size)) ?? files.find((file) => names.includes(file.name.toLowerCase()));
    if (!f) continue;
    const [path] = await storeFiles([f]);
    const disk = isBrowserPath(m.path) ? m.copies?.disk : m.path;
    updateMedia(m.id, { path, url: mediaUrlOf(path), copies: { ...(m.copies ?? {}), ...(disk ? { disk } : {}), browser: path }, status: 'loading', thumb: undefined, sprite: undefined, audioUrl: undefined });
    window.icut.refreshAssets({ id: m.id, path, info: { ...m, path } });
    found++;
  }
  const left = offline.length - found;
  toast(found ? `Found ${found} file${found === 1 ? '' : 's'}${left ? ` — ${left} still offline` : ''}` : 'None of those files match the offline media (same name needed)', found ? 'success' : 'error', 6000);
}

/**
 * The helper works on files on disk. Media that was imported while editing in the browser (kept in browser storage)
 * is copied to Documents/IngrainedCut/Imported through the helper, so transcription, export and the AI tools can read it.
 */
async function moveBrowserMedia(p: Project): Promise<number> {
  const list = p.media.filter((m) => isBrowserPath(m.path));
  let moved = 0;
  for (const m of list) {
    try {
      toast(`Copying ${m.name} from browser storage to your computer…`, 'info');
      const r = await fetch(uploadUrl(m.path.split('/').pop()!), { method: 'POST', body: await readFile(m.path) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { path } = await r.json();
      useCopy(m, path); // the browser copy stays, for sessions without the helper
      moved++;
    } catch (e: any) {
      toast(`Could not copy ${m.name} to your computer: ${e.message}`, 'error');
    }
  }
  return moved;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<boolean> | null = null;

export async function cloudSave(): Promise<boolean> {
  const c = S().cloud;
  if (!c) return false;
  clearTimeout(timer);
  if (inFlight) await inFlight;
  const snapshot = S().project;
  setS({ cloud: { ...c, status: 'saving' } });
  inFlight = (async () => {
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(c.id)}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: stripForFile(snapshot) }),
      });
      if (r.status === 401) {
        toLogin();
        return false;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const unchanged = S().project === snapshot;
      setS({ cloud: { ...c, status: unchanged ? 'saved' : 'pending' }, ...(unchanged ? { dirty: false } : {}) });
      if (!unchanged) schedule();
      return true;
    } catch (e) {
      setS({ cloud: { ...c, status: 'error' } });
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(cloudSave, 1500);
}

function startAutosave() {
  useEditor.subscribe((s, prev) => {
    if (!s.cloud || s.project === prev.project || s.gestureBase) return;
    if (s.cloud.status !== 'pending' && s.cloud.status !== 'saving') setS({ cloud: { ...s.cloud, status: 'pending' } });
    schedule();
  });
  // finish a drag before saving it
  useEditor.subscribe((s, prev) => {
    if (prev.gestureBase && !s.gestureBase && s.cloud) schedule();
  });
}
