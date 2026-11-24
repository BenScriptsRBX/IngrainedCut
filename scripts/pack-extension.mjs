// pack-extension.mjs — builds the IngrainedCut Chrome extension (extension/) for release.
//   node scripts/pack-extension.mjs [outDir]          (default: ../IngrainedCut-extension next to this repo)
//   node scripts/pack-extension.mjs [outDir] --dev    a test build: also runs on http://localhost:3000 (the website's dev
//                                                     server) and signs in / sends ChatGPT requests to a stand-in
//                                                     OpenAI server on 127.0.0.1:7777. Never publish it.
// Output:
//   <outDir>/IngrainedCut-Chrome-Extension/            the unpacked extension (Load unpacked)
//   <outDir>/IngrainedCut-Chrome-Extension.zip         that folder zipped, for people to download from the release
//   <outDir>/IngrainedCut-Chrome-Extension-store.zip   the files at the zip's root, to upload to the Chrome Web Store
import { execFileSync } from 'node:child_process';
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
  manifest.host_permissions.push(`${MOCK}/*`);
  fs.writeFileSync(path.join(DIR, 'config.js'), `// test build: a stand-in OpenAI server\nexport const CONFIG = { auth: '${MOCK}', apiBase: '${MOCK}/v1' };\n`);
}
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

// zips with Windows' tar (bsdtar), macOS's or Linux's zip otherwise
function zip(file, cwd, entries) {
  fs.rmSync(file, { force: true });
  // (Windows' own tar.exe by full path: Git's GNU tar can't write zips)
  if (process.platform === 'win32') execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-cf', file, ...entries], { cwd, stdio: 'inherit' });
  else execFileSync('zip', ['-qr', file, ...entries], { cwd, stdio: 'inherit' });
}
zip(path.join(OUT, `${NAME}.zip`), OUT, [NAME]);
zip(path.join(OUT, `${NAME}-store.zip`), DIR, fs.readdirSync(DIR));
console.log(`${dev ? 'test build' : 'extension'} ${pkg.version}:`, DIR);
