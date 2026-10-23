#!/usr/bin/env node
// The IngrainedCut helper. Runs the engine (FFmpeg, export, AI agents, HyperFrames, MCP) on this computer for
//  - the IngrainedCut website: the editor at https://<site>/editor connects here (allowed origins: server/site.json), and
//  - local mode: it also serves the editor itself at http://localhost:<port> behind a private link.
//   npx ingrainedcut                 start the helper (the website's editor connects to it; nothing is opened)
//   npx ingrainedcut --open          …and open your projects page
//   npx ingrainedcut --local         serve the editor here too, and open its private link
//   npx ingrainedcut --connect claude   add IngrainedCut to Claude Code (or codex / cursor), then start the helper
//   node server/web.mjs [project.icut] [--port 5310] [--open | --no-open] [--local] [--connect <app> [--no-helper]]
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createCore, ROOT } from '../electron/core.mjs';
import { openMedia } from '../electron/mediaServe.mjs';
import { documentsDir } from '../electron/paths.mjs';
import { claudeSdk, claudeSdkInstalled } from '../electron/runtimePackages.mjs';
import { ensureFfmpeg } from '../electron/media.mjs';
import { connectMcpClient } from '../electron/mcpClients.mjs';
import { openFiles, saveFile, revealInFolder, openUrl } from './dialogs.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const DIST = path.join(ROOT, 'dist');
const STATE_FILE = path.join(os.homedir(), '.ingrainedcut', 'web.json');
const TOKEN = crypto.randomBytes(24).toString('hex'); // local-mode entry link / cookie
const MEDIA_TOKEN = crypto.randomBytes(24).toString('hex'); // handed to verified editors over the WebSocket
const COOKIE = 'icut_session';
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'site.json'), 'utf8'));
const SITE_ORIGINS = new Set([...SITE.origins, ...(process.env.ICUT_SITE_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)]);
const LOCAL_EDITOR = fs.existsSync(path.join(DIST, 'index.html'));

const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

const port = Number(opt('--port', process.env.ICUT_PORT || 5310));
const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
const localOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));

function cookieOk(req) {
  const c = req.headers.cookie || '';
  return c.split(/;\s*/).some((kv) => kv === `${COOKIE}=${TOKEN}`);
}

/** CORS for the website: echo the Origin only if it is one of ours; also answer Private Network Access checks. */
function cors(req) {
  const o = req.headers.origin;
  if (!o || !SITE_ORIGINS.has(o)) return {};
  return {
    'Access-Control-Allow-Origin': o,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600',
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

const LOCKED_PAGE = `<!doctype html><meta charset="utf-8"><title>IngrainedCut helper</title>
<body style="background:#161616;color:#ddd;font:15px Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0">
<div style="max-width:480px;text-align:center;line-height:1.6"><h2>The IngrainedCut helper is running</h2>
Open your projects on the IngrainedCut website — the editor there connects to this helper automatically.<br>
For the locally served editor, use the private link printed in the helper's terminal.</div></body>`;

const server = http.createServer(async (req, res) => {
  if (!allowedHosts.has(req.headers.host)) return send(res, 403, 'Forbidden host');
  const url = new URL(req.url, `http://${req.headers.host}`);
  const c = cors(req);

  if (req.method === 'OPTIONS') {
    res.writeHead(Object.keys(c).length ? 204 : 403, c);
    return res.end();
  }
  // presence check used by the website (projects page, editor)
  if (url.pathname === '/hello') return send(res, 200, JSON.stringify({ app: 'ingrainedcut-helper', version: pkg.version }), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...c });

  // local mode entry link: /?t=<token> sets a same-site cookie
  if (url.searchParams.get('t') === TOKEN) {
    res.writeHead(302, { 'Set-Cookie': `${COOKIE}=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`, Location: '/' + (url.searchParams.get('open') ? `?open=${encodeURIComponent(url.searchParams.get('open'))}` : '') });
    return res.end();
  }
  const authorized = cookieOk(req) || url.searchParams.get('k') === MEDIA_TOKEN;

  if (url.pathname.startsWith('/media/')) {
    if (!authorized) return send(res, 401, 'Unauthorized', c);
    const r = openMedia(decodeURIComponent(url.pathname.slice(7)), req.headers.range);
    res.writeHead(r.status, { ...r.headers, ...c });
    if (r.stream) r.stream.pipe(res);
    else res.end();
    return;
  }

  // files dropped into the browser have no path: copy them into Documents/IngrainedCut/Imported
  if (url.pathname === '/upload' && req.method === 'POST') {
    if (!authorized) return send(res, 401, 'Unauthorized', c);
    const dir = path.join(documentsDir(), 'IngrainedCut', 'Imported');
    fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(url.searchParams.get('name') || 'file').replace(/[<>:"/\\|?*]/g, '_');
    let dest = path.join(dir, base);
    for (let i = 1; fs.existsSync(dest); i++) dest = path.join(dir, `${path.parse(base).name} (${i})${path.parse(base).ext}`);
    const out = fs.createWriteStream(dest);
    req.pipe(out);
    out.on('finish', () => send(res, 200, JSON.stringify({ path: dest }), { 'Content-Type': 'application/json', ...c }));
    out.on('error', (e) => send(res, 500, e.message, c));
    return;
  }

  if (!cookieOk(req) || !LOCAL_EDITOR) return send(res, 401, LOCKED_PAGE, { 'Content-Type': 'text/html; charset=utf-8' });
  let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) return send(res, 403, 'Forbidden');
  if (url.pathname === '/' || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': STATIC_TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

// ---------- WebSocket: the same channels the Electron preload exposes ----------
const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 * 1024 });
const clients = new Set();
let editor = null; // the tab that executes the AI's tool calls (most recently active)
const handlers = new Map();
const listeners = new Map();
const pathOf = (req) => new URL(req.url, 'http://x').pathname;

server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin || '';
  // the website's editor (allowed origin) or the locally served editor (same origin + cookie)
  const ok = pathOf(req) === '/ws' && allowedHosts.has(req.headers.host) && (SITE_ORIGINS.has(origin) || (localOrigins.has(origin) && cookieOk(req)));
  if (!ok) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

function emit(ch, payload) {
  const msg = JSON.stringify({ t: 'ev', ch, payload });
  if (ch === 'tool:invoke') return editor?.readyState === 1 && editor.send(msg);
  for (const c of clients) if (c.readyState === 1) c.send(msg);
}

const reviveBins = (v, bins) => {
  if (v && typeof v === 'object') {
    if (typeof v.__bin === 'number') return bins[v.__bin];
    for (const k of Object.keys(v)) v[k] = reviveBins(v[k], bins);
  }
  return v;
};

wss.on('connection', (ws) => {
  clients.add(ws);
  editor = ws;
  ws.send(JSON.stringify({ t: 'hello', mediaToken: MEDIA_TOKEN, version: pkg.version }));
  let pending = null; // message waiting for its binary frames
  const dispatch = async (msg) => {
    editor = ws;
    if (msg.t === 'send') return listeners.get(msg.ch)?.(msg.args?.[0]);
    if (msg.t !== 'invoke') return;
    const fn = handlers.get(msg.ch);
    try {
      if (!fn) throw new Error(`No handler for ${msg.ch}`);
      const value = await fn(...(msg.args || []));
      ws.send(JSON.stringify({ t: 'res', id: msg.id, ok: true, value: value === undefined ? null : value }));
    } catch (e) {
      ws.send(JSON.stringify({ t: 'res', id: msg.id, ok: false, error: e?.message || String(e) }));
    }
  };
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      if (!pending) return;
      pending.bins.push(data);
      if (pending.bins.length === pending.msg.bins) {
        const { msg, bins } = pending;
        pending = null;
        reviveBins(msg.args, bins);
        dispatch(msg);
      }
      return;
    }
    const msg = JSON.parse(data.toString());
    if (msg.bins) pending = { msg, bins: [] };
    else dispatch(msg);
  });
  ws.on('close', () => {
    clients.delete(ws);
    if (editor === ws) editor = [...clients].pop() ?? null;
  });
});

/**
 * Outside agents (Claude Code, Codex, Cursor) start the MCP server from a fixed place, so the `mcp add` command they were
 * given keeps working when the helper updates (npx keeps each version in its own cache folder): the bundled server is
 * copied to ~/.ingrainedcut/mcp-server on every start. A checkout of the repo uses mcp/server.mjs where it is.
 */
function installMcpServer() {
  if (!fs.existsSync(path.join(ROOT, 'lib'))) return undefined;
  const dest = path.join(os.homedir(), '.ingrainedcut', 'mcp-server');
  try {
    fs.rmSync(dest, { recursive: true, force: true });
    for (const d of ['mcp', 'lib']) fs.cpSync(path.join(ROOT, d), path.join(dest, d), { recursive: true });
    return path.join(dest, 'mcp', 'server.mjs');
  } catch (e) {
    console.error('  Could not install the MCP server for outside agents:', e.message);
    return undefined;
  }
}

const mcpServerPath = installMcpServer() ?? path.join(ROOT, 'mcp', 'server.mjs');

// `--connect claude|codex|cursor`: add IngrainedCut to that app (so it can edit the open timeline on the user's own plan),
// then carry on as the helper, unless one is already running or `--no-helper` was given (the desktop app is open)
const CONNECT_APPS = { claude: 'Claude Code', 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor' };
if (argv.includes('--connect')) {
  const connectTo = String(opt('--connect', '')).toLowerCase();
  const app = CONNECT_APPS[connectTo];
  if (!app) {
    console.error('\n  Use --connect claude, --connect codex or --connect cursor.\n');
    process.exit(1);
  }
  const r = await connectMcpClient(connectTo === 'claude-code' ? 'claude' : connectTo, mcpServerPath);
  if (!r.ok) {
    console.error(`\n  Couldn't connect IngrainedCut to ${app}: ${r.out.trim().slice(-400)}\n`);
    process.exit(1);
  }
  console.log(`\n  ✓ IngrainedCut is connected to ${app}.`);
  console.log(`    Open a new ${app} session and ask it to edit your IngrainedCut timeline (keep your project open in the editor).`);
  const running = await fetch(`http://127.0.0.1:${port}/hello`, { signal: AbortSignal.timeout(1500) }).then((x) => x.ok, () => false);
  if (flag('--no-helper') || running) {
    if (running) console.log('    The IngrainedCut helper is already running.');
    console.log('');
    process.exit(0);
  }
}

const startupProject = argv.find((a) => /\.icut$/i.test(a) && fs.existsSync(a)) ?? null;

const core = createCore({
  handle: (ch, fn) => handlers.set(ch, fn),
  on: (ch, fn) => listeners.set(ch, fn),
  emit,
  hasEditor: () => !!editor && editor.readyState === 1,
  version: pkg.version,
  startupProject,
  mcpServerPath,
  dialogs: {
    openMedia: () =>
      openFiles({
        title: 'Import Media',
        multi: true,
        filters: [
          { name: 'Media', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      }),
    save: (o) => saveFile({ title: o?.title, defaultPath: o?.defaultPath, filters: o?.filters }),
    openProject: async () => (await openFiles({ title: 'Open Project', filters: [{ name: 'IngrainedCut Project', extensions: ['icut'] }] }))[0] ?? null,
    chooseFile: async (o) => (await openFiles({ title: o?.title, filters: o?.filters }))[0] ?? null,
  },
  shell: { reveal: revealInFolder, openExternal: openUrl },
  // no window handle on the server: the browser tab screenshots itself (screenshot_editor tool)
});

server.once('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${port} is already in use — is another IngrainedCut helper running? Close it, or start with --port <n>.\n`);
    process.exit(1);
  }
  throw e;
});
server.listen(port, '127.0.0.1', () => {
  const local = `http://localhost:${port}/?t=${TOKEN}`;
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ port, url: local, pid: process.pid }));
  const site = SITE.openUrl && !SITE.openUrl.includes('YOUR-DOMAIN') ? SITE.openUrl : null;
  console.log(`\n  IngrainedCut helper v${pkg.version} is running on this computer (port ${port}).`);
  if (site) console.log(`  Open your projects: ${site}`);
  if (LOCAL_EDITOR) console.log(`  Local editor (private link): ${local}`);
  console.log(`\n  Keep this window open while you edit — an open editor tab connects by itself. Ctrl+C to stop.\n`);
  prefetch();
  // only open a tab when asked (--open), or in local mode where the private link is the way in
  if (flag('--no-open')) return;
  if (flag('--local') || !site) {
    if (LOCAL_EDITOR) openUrl(local);
  } else if (flag('--open')) openUrl(site);
});

/** First run: fetch the Claude Agent SDK and (without one on this computer) FFmpeg while the editor is already usable. */
function prefetch() {
  const jobs = [];
  if (!claudeSdkInstalled()) jobs.push(['the Claude Agent SDK', claudeSdk()]);
  const ff = ensureFfmpeg();
  if (ff) jobs.push(['FFmpeg', ff.then((ok) => ok || Promise.reject(new Error('install FFmpeg yourself, or try again later')))]);
  if (!jobs.length) return;
  console.log(`  First run: downloading ${jobs.map((j) => j[0]).join(' and ')} in the background…`);
  for (const [name, p] of jobs) p.then(() => console.log(`  ✓ ${name} is ready.`), (e) => console.log(`  ✗ Couldn't download ${name}: ${e?.message?.split('\n')[0] || e}`));
}

const stop = () => {
  core.shutdown();
  try {
    const cur = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (cur.pid === process.pid) fs.rmSync(STATE_FILE, { force: true });
  } catch {}
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
