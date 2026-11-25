// pack-extension.mjs — builds the IngrainedCut Chrome extension (extension/) for release.
//   node scripts/pack-extension.mjs [outDir]          (default: ../IngrainedCut-extension next to this repo)
//   node scripts/pack-extension.mjs [outDir] --dev    a test build: also runs on http://localhost:3000 (the website's dev
//                                                     server) and signs in / sends ChatGPT requests to a stand-in
//                                                     OpenAI server on 127.0.0.1:7777. Never publish it.
// Output:
//   <outDir>/IngrainedCut-Chrome-Extension/            the unpacked extension (Load unpacked)
//   <outDir>/IngrainedCut-Chrome-Extension.zip         that folder zipped, for people to download from the release
//   <outDir>/IngrainedCut-Chrome-Extension-store.zip   the files at the zip's root, to upload to the Chrome Web Store.
//                                                     Without the video downloader (ytdlp/): the store doesn't allow
//                                                     extensions that download YouTube videos.
// The downloader runs yt-dlp in Pyodide: this copies Pyodide's core files from node_modules and the yt-dlp wheels
// pinned in extension/ytdlp/wheels/wheels.json (downloaded once into node_modules/.cache, SHA-256 checked).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dev = args.includes('--dev');
const OUT = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(ROOT, '..', dev ? 'IngrainedCut-extension-dev' : 'IngrainedCut-extension'));
const NAME = 'IngrainedCut-Chrome-Extension';
const DIR = path.join(OUT, NAME);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const MOCK = 'http://127.0.0.1:7777';
const OPENAI_HOSTS = ['http://127.0.0.1:1455/*', 'https://auth.openai.com/*', 'https://api.openai.com/*', ...(dev ? [`${MOCK}/*`] : [])];

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'extension'), DIR, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(DIR, 'LICENSE'));

const manifestFile = path.join(DIR, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
manifest.version = pkg.version;
if (dev) {
  manifest.name = 'IngrainedCut (test build)';
  manifest.content_scripts[0].matches.push('http://localhost:3000/*');
  for (const r of manifest.web_accessible_resources ?? []) r.matches.push('http://localhost:3000/*');
  fs.writeFileSync(path.join(DIR, 'config.js'), `// test build: a stand-in OpenAI server\nexport const CONFIG = { auth: '${MOCK}', apiBase: '${MOCK}/v1' };\n`);
}
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

// ---- the downloader's runtime: Pyodide and the yt-dlp wheels ----
const YT = path.join(DIR, 'ytdlp');
const PYODIDE = path.join(ROOT, 'node_modules', 'pyodide');
fs.rmSync(path.join(YT, 'pyodide'), { recursive: true, force: true });
fs.mkdirSync(path.join(YT, 'pyodide'));
for (const f of ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) fs.copyFileSync(path.join(PYODIDE, f), path.join(YT, 'pyodide', f));
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'icut-ytdlp');
fs.mkdirSync(CACHE, { recursive: true });
for (const w of JSON.parse(fs.readFileSync(path.join(YT, 'wheels', 'wheels.json'), 'utf8'))) {
  const cached = path.join(CACHE, w.file);
  const ok = (buf) => crypto.createHash('sha256').update(buf).digest('hex') === w.sha256;
  if (!fs.existsSync(cached) || !ok(fs.readFileSync(cached))) {
    const buf = Buffer.from(await (await fetch(w.url)).arrayBuffer());
    if (!ok(buf)) throw new Error(`${w.file}: SHA-256 doesn't match wheels.json`);
    fs.writeFileSync(cached, buf);
  }
  fs.copyFileSync(cached, path.join(YT, 'wheels', w.file));
}

// ---- the store build: the same extension without the downloader and its permissions ----
const STORE = path.join(OUT, NAME + '-store');
fs.rmSync(STORE, { recursive: true, force: true });
fs.cpSync(DIR, STORE, { recursive: true });
fs.rmSync(path.join(STORE, 'ytdlp'), { recursive: true, force: true });
const storeManifest = { ...manifest, description: 'Edit videos on ingrainedcut.com with ChatGPT on your own ChatGPT plan. Nothing else to install.' };
storeManifest.permissions = manifest.permissions.filter((p) => !p.startsWith('declarativeNetRequest'));
storeManifest.host_permissions = OPENAI_HOSTS;
for (const k of ['web_accessible_resources', 'sandbox', 'content_security_policy']) delete storeManifest[k];
fs.writeFileSync(path.join(STORE, 'manifest.json'), JSON.stringify(storeManifest, null, 2) + '\n');

// zips with Windows' tar (bsdtar), macOS's or Linux's zip otherwise
function zip(file, cwd, entries) {
  fs.rmSync(file, { force: true });
  // (Windows' own tar.exe by full path: Git's GNU tar can't write zips)
  if (process.platform === 'win32') execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-cf', file, ...entries], { cwd, stdio: 'inherit' });
  else execFileSync('zip', ['-qr', file, ...entries], { cwd, stdio: 'inherit' });
}
zip(path.join(OUT, `${NAME}.zip`), OUT, [NAME]);
zip(path.join(OUT, `${NAME}-store.zip`), STORE, fs.readdirSync(STORE));
fs.rmSync(STORE, { recursive: true, force: true });
console.log(`${dev ? 'test build' : 'extension'} ${pkg.version}:`, DIR);
