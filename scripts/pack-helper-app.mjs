// pack-helper-app.mjs — builds the IngrainedCut helper for Windows as a tray app with a one-click installer
// (electron/helperApp.mjs), so the website's AI works without a terminal command or Node.js.
//   node scripts/pack-helper-app.mjs [outDir]        (default: ../IngrainedCut-helper-app next to this repo)
// Output: <outDir>/release/IngrainedCut-Helper-Setup.exe (fixed name, so the website can link to the latest release).
// It carries FFmpeg; Codex still installs on first use (it needs Node.js); Claude and Cursor aren't part of it.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '..', 'IngrainedCut-helper-app'));
const STAGE = path.join(OUT, 'stage');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
const sh = (cmd, cwd = ROOT) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env } });

console.log('building the editor…');
sh('npx vite build');

console.log('staging', STAGE);
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const dir of ['dist', 'electron', 'server', 'mcp', 'build']) fs.cpSync(path.join(ROOT, dir), path.join(STAGE, dir), { recursive: true });
for (const f of ['package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md']) fs.copyFileSync(path.join(ROOT, f), path.join(STAGE, f));
// the AI SDKs that are large or not ours to redistribute stay out: Claude isn't offered by this helper, and Codex
// installs itself from npm the first time someone picks it
const deps = { ...pkg.dependencies };
delete deps['@anthropic-ai/claude-agent-sdk'];
delete deps['@openai/codex-sdk'];
const stagePkg = {
  name: 'ingrainedcut-helper',
  productName: 'IngrainedCut Helper',
  version: pkg.version,
  description: 'Runs AI editing for the IngrainedCut website on this computer',
  license: pkg.license,
  type: 'module',
  main: 'electron/helperApp.mjs',
  dependencies: deps,
};
fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify(stagePkg, null, 2));
fs.rmSync(path.join(STAGE, 'package-lock.json'), { force: true });

console.log('installing runtime packages…');
sh('npm install --omit=dev --no-audit --no-fund', STAGE);

const config = {
  appId: 'com.ingrainedcut.helper',
  productName: 'IngrainedCut Helper',
  directories: { output: path.join(OUT, 'release'), app: STAGE },
  electronVersion,
  asar: false, // FFmpeg and the MCP server are started as real files
  files: ['**/*'],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: path.join(STAGE, 'build', 'icon.png') },
  nsis: {
    oneClick: true,
    perMachine: false,
    createDesktopShortcut: false,
    createStartMenuShortcut: true,
    shortcutName: 'IngrainedCut Helper',
    runAfterFinish: true,
    artifactName: 'IngrainedCut-Helper-Setup.exe',
  },
};
const cfgFile = path.join(OUT, 'builder.json');
fs.writeFileSync(cfgFile, JSON.stringify(config, null, 2));
console.log('packaging…');
sh(`npx -y electron-builder@26.0.12 --win nsis --x64 --config "${cfgFile}" --publish never`, OUT);
console.log('done:', path.join(OUT, 'release', 'IngrainedCut-Helper-Setup.exe'));
