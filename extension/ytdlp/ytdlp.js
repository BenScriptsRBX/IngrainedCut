// yt-dlp for the IngrainedCut website, run inside the extension. The website puts this page in a hidden frame
// (it is web-accessible to the website only) and asks it to download links; the files come back to the page in
// chunks. yt-dlp runs in Pyodide (Python compiled to WebAssembly, bundled in ytdlp/pyodide/), its HTTP requests go
// through this page's fetch, which the extension's host permissions let reach any site, and YouTube's JS challenges
// run in solver.html, a sandboxed page with no extension access.
import { loadPyodide } from './pyodide/pyodide.mjs';

const manifest = chrome.runtime.getManifest();
// the website's origins: the pages the content script runs on
const ALLOWED = new Set((manifest.content_scripts?.[0]?.matches ?? []).map((m) => new URL(m.replace(/\*$/, '')).origin));
const parentOrigin = (() => {
  try {
    return new URL(document.referrer).origin;
  } catch {
    return '';
  }
})();
const send = (msg, transfer) => ALLOWED.has(parentOrigin) && parent.postMessage({ __icut: 'ytdlp', ...msg }, parentOrigin, transfer ?? []);

// ---------- yt-dlp itself: the bundled wheels, or a newer yt-dlp from PyPI (checked weekly, hashes verified) ----------
const BUNDLED = fetch('wheels/wheels.json').then((r) => r.json()); // [{ name, version, file }]
const WEEK = 7 * 24 * 3600 * 1000;
const CACHE = 'icut-ytdlp-wheels';
const vt = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0);
const newer = (a, b) => {
  const x = vt(a), y = vt(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};
const sha256 = async (buf) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');

async function pypiWheel(name, version) {
  const j = await (await fetch(`https://pypi.org/pypi/${name}/${version ? version + '/' : ''}json`)).json();
  const w = j.urls.find((u) => u.packagetype === 'bdist_wheel' && /py3-none-any\.whl$/.test(u.filename));
  if (!w) throw new Error(`no wheel for ${name}`);
  return { name, version: j.info.version, file: w.filename, url: w.url, sha256: w.digests.sha256, requires: j.info.requires_dist ?? [] };
}

/** Once a week: fetch a newer yt-dlp (and the solver version it asks for) for the next start. */
async function checkForUpdate(current) {
  const { ytdlpChecked = 0 } = await chrome.storage.local.get('ytdlpChecked');
  if (Date.now() - ytdlpChecked < WEEK) return;
  await chrome.storage.local.set({ ytdlpChecked: Date.now() });
  const y = await pypiWheel('yt-dlp');
  if (!newer(y.version, current)) return;
  const ejsReq = y.requires.map((r) => /^yt-dlp-ejs==([\d.]+)/.exec(r)).find(Boolean);
  const wheels = [y, ...(ejsReq ? [await pypiWheel('yt-dlp-ejs', ejsReq[1])] : [])];
  const cache = await caches.open(CACHE);
  for (const w of wheels) {
    const buf = await (await fetch(w.url)).arrayBuffer();
    if ((await sha256(buf)) !== w.sha256) throw new Error(`${w.file}: hash mismatch`);
    await cache.put(w.file, new Response(buf));
  }
  await chrome.storage.local.set({ ytdlpUpdate: { version: y.version, files: wheels.map((w) => w.file) } });
}

async function wheelFiles() {
  const bundled = await BUNDLED;
  const base = bundled.find((w) => w.name === 'yt-dlp').version;
  const { ytdlpUpdate, ytdlpBroken } = await chrome.storage.local.get(['ytdlpUpdate', 'ytdlpBroken']);
  if (ytdlpUpdate && newer(ytdlpUpdate.version, base) && ytdlpBroken !== ytdlpUpdate.version) {
    try {
      const cache = await caches.open(CACHE);
      const bufs = [];
      for (const f of ytdlpUpdate.files) bufs.push(await (await cache.match(f)).arrayBuffer());
      // an update without its own solver keeps the bundled one
      if (!ytdlpUpdate.files.some((f) => f.startsWith('yt_dlp_ejs'))) bufs.push(await (await fetch('wheels/' + bundled.find((w) => w.name === 'yt-dlp-ejs').file)).arrayBuffer());
      return { version: ytdlpUpdate.version, bufs, updated: true };
    } catch {}
  }
  return { version: base, bufs: await Promise.all(bundled.map(async (w) => (await fetch('wheels/' + w.file)).arrayBuffer())), updated: false };
}

let pyP = null;
function python() {
  return (pyP ??= (async () => {
    const py = await loadPyodide({ indexURL: chrome.runtime.getURL('ytdlp/pyodide/') });
    py.registerJsModule('icut_host', host);
    const load = async (w) => {
      for (const buf of w.bufs) py.unpackArchive(buf, 'zip', { extractDir: '/lib/python3.14/site-packages' });
      py.FS.writeFile('/home/pyodide/icut_ytdlp.py', await (await fetch('icut_ytdlp.py')).text());
      py.runPython('import sys\nif "/home/pyodide" not in sys.path: sys.path.insert(0, "/home/pyodide")\nimport icut_ytdlp');
    };
    let w = await wheelFiles();
    try {
      await load(w);
    } catch (e) {
      if (!w.updated) throw e;
      // the downloaded update doesn't load: remember that and start over with the bundled yt-dlp
      await chrome.storage.local.set({ ytdlpBroken: w.version });
      pyP = null;
      return python();
    }
    const mod = py.pyimport('icut_ytdlp');
    checkForUpdate(w.version).catch(() => {});
    return { py, mod, version: String(mod.version()) };
  })().catch((e) => {
    pyP = null;
    throw e;
  }));
}

// ---------- what Python calls ----------
const jobs = new Map(); // job id -> { cancelled, onProgress }
let current = null; // the job running now (Python runs one at a time)
const FORBIDDEN = ['user-agent', 'referer', 'origin', 'cookie'];
let tabId = null;
chrome.tabs?.getCurrent?.((t) => (tabId = t?.id ?? null));
const RULE_ID = () => 1 + ((tabId ?? 0) % 100000);

/** Headers a page can't set itself (User-Agent, Referer, Origin, Cookie): set for this frame's requests with a session rule. */
async function headerRule(headers) {
  const set = Object.entries(headers).filter(([k]) => FORBIDDEN.includes(k.toLowerCase()));
  const requestHeaders = set.map(([header, value]) => ({ header, operation: 'set', value: String(value) }));
  if (!set.some(([k]) => k.toLowerCase() === 'origin')) requestHeaders.push({ header: 'origin', operation: 'remove' });
  const condition = { initiatorDomains: [chrome.runtime.id], resourceTypes: ['xmlhttprequest', 'other'], ...(tabId != null ? { tabIds: [tabId] } : { excludedTabIds: [chrome.tabs?.TAB_ID_NONE ?? -1] }) };
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID()], addRules: [{ id: RULE_ID(), priority: 1, action: { type: 'modifyHeaders', requestHeaders }, condition }] });
}

const cancelledError = () => new Error('cancelled');
const host = {
  async fetch(url, method, headers, body, timeout) {
    if (current?.cancelled) throw cancelledError();
    const h = {};
    for (const [k, v] of Object.entries(headers ?? {})) if (!FORBIDDEN.includes(k.toLowerCase())) h[k] = v;
    await headerRule(headers ?? {});
    const ctl = new AbortController();
    const job = current;
    job?.aborts.add(ctl);
    const timer = setTimeout(() => ctl.abort(new Error('timed out')), (Number(timeout) || 30) * 1000);
    let r;
    try {
      r = await fetch(url, { method, headers: h, body: body ?? undefined, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow', cache: 'no-store', signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
    const encoded = r.headers.has('content-encoding'); // fetch already decoded it
    const reader = r.body?.getReader();
    return {
      status: r.status,
      url: r.url || url,
      headers: [...r.headers].filter(([k]) => k !== 'content-encoding' && !(encoded && k === 'content-length')),
      async read() {
        if (job?.cancelled) throw cancelledError();
        if (!reader) return undefined;
        const x = await reader.read();
        if (x.done) {
          job?.aborts.delete(ctl);
          return undefined;
        }
        return x.value;
      },
      cancel() {
        job?.aborts.delete(ctl);
        reader?.cancel().catch(() => {});
      },
    };
  },
  solve,
  progress(job, json) {
    const j = jobs.get(job);
    if (!j) return true;
    j.onProgress(JSON.parse(json));
    return !!j.cancelled;
  },
};

/** Run a challenge script in a fresh sandboxed frame; resolves with what it printed. */
function solve(script) {
  return new Promise((resolve, reject) => {
    const f = document.createElement('iframe');
    f.src = 'solver.html';
    f.style.display = 'none';
    const done = (fn, v) => {
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      f.remove();
      fn(v);
    };
    const timer = setTimeout(() => done(reject, new Error('the challenge solver timed out')), 60_000);
    const onMsg = (e) => {
      if (e.source !== f.contentWindow) return;
      if (e.data?.ready) return f.contentWindow.postMessage({ script }, '*');
      if (e.data?.error) done(reject, new Error(e.data.error));
      else done(resolve, String(e.data?.out ?? ''));
    };
    window.addEventListener('message', onMsg);
    document.body.appendChild(f);
  });
}

// ---------- jobs from the website ----------
const CHUNK = 4 << 20;
let queue = Promise.resolve();

async function runJob(id, url, options) {
  const job = { cancelled: false, aborts: new Set(), onProgress: (p) => send({ id, t: 'progress', ...p }) };
  jobs.set(id, job);
  try {
    send({ id, t: 'progress', line: 'Starting yt-dlp…', progress: 0 });
    const { py, mod } = await python();
    if (job.cancelled) throw cancelledError();
    current = job;
    const res = JSON.parse(await mod.download.callPromising(id, String(url), JSON.stringify(options ?? {})));
    current = null;
    // hand the files over in chunks, then free them
    for (const [i, f] of res.files.entries()) {
      send({ id, t: 'file', fid: i, kind: f.kind, ext: f.ext, size: f.size, vcodec: f.vcodec, acodec: f.acodec });
      const stream = py.FS.open(f.path, 'r');
      try {
        for (let pos = 0; pos < f.size; pos += CHUNK) {
          if (job.cancelled) throw cancelledError();
          const buf = new Uint8Array(Math.min(CHUNK, f.size - pos));
          py.FS.read(stream, buf, 0, buf.length, pos);
          send({ id, t: 'chunk', fid: i, data: buf.buffer }, [buf.buffer]);
        }
      } finally {
        py.FS.close(stream);
        py.FS.unlink(f.path);
      }
      send({ id, t: 'file-end', fid: i });
    }
    send({ id, t: 'done', result: { title: res.title, id: res.id, duration: res.duration, extractor: res.extractor, warnings: res.warnings, files: res.files.map(({ kind, ext, size }) => ({ kind, ext, size })) } });
  } catch (e) {
    current = null;
    send({ id, t: 'error', message: job.cancelled ? 'cancelled' : friendly(e) });
  } finally {
    jobs.delete(id);
    try {
      const { py } = await python();
      py.runPython(`import shutil; shutil.rmtree('/dl/${String(id).replace(/[^\w-]/g, '')}', ignore_errors=True)`);
    } catch {}
  }
}

/** yt-dlp's last error line, in plain words where we know them. */
function friendly(e) {
  const raw = String(e?.message ?? e);
  const line = (raw.match(/(?:DownloadError|ExtractorError|Exception): ([^\n]+)\s*$/m) ?? raw.match(/ERROR: ([^\n]+)/))?.[1] ?? raw.split('\n').filter(Boolean).pop() ?? raw;
  const msg = line.replace(/^ERROR:\s*/, '').trim();
  if (/Sign in to confirm (you.re not a bot|your age)/i.test(msg)) return 'YouTube asked to sign in before showing this video (age or bot check), so it can\'t be downloaded here. Try the IngrainedCut helper, or another video.';
  if (/Private video|This video is private/i.test(msg)) return 'That video is private.';
  if (/Unsupported URL/i.test(msg)) return 'yt-dlp doesn\'t know how to download from that link.';
  if (/Video unavailable|not available/i.test(msg)) return 'That video isn\'t available.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'The site couldn\'t be reached. Check the link and your connection.';
  return msg.slice(0, 400);
}

window.addEventListener('message', (e) => {
  if (e.source !== parent || !ALLOWED.has(e.origin) || e.origin !== parentOrigin) return;
  const m = e.data;
  if (!m || m.__icut !== 'ytdlp') return;
  if (m.cmd === 'download') {
    queue = queue.then(() => runJob(m.id, m.url, m.options));
  } else if (m.cmd === 'cancel') {
    const j = jobs.get(m.id);
    if (j) {
      j.cancelled = true;
      for (const c of j.aborts) c.abort(cancelledError());
    }
  } else if (m.cmd === 'warm') {
    python().then(
      (p) => send({ t: 'warm', version: p.version }),
      (err) => send({ t: 'warm', error: String(err?.message ?? err) }),
    );
  }
});

send({ t: 'ready', extension: manifest.version });
