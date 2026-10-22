// Packs the IngrainedCut helper into web/public/helper/ingrainedcut-<version>.tgz, so anyone can run it with
// `npx -y <site>/helper/ingrainedcut-<version>.tgz` without it being published to npm. The version is in the file name
// because npx caches what it installed per URL.
// The package has no dependencies, so npx only downloads this one file: the helper and the MCP server are bundled with
// their libraries, and the heavy parts (the Claude Agent SDK, FFmpeg) are fetched by the helper after it starts
// (electron/runtimePackages.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(web, '..');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const rootPkg = readJson(path.join(root, 'package.json'));
const fromRoot = async (spec) => import(pathToFileURL(path.join(root, 'node_modules', ...spec.split('/'))).href);

// the helper also serves the editor itself in `--local` mode, from dist/
const { build } = await fromRoot('vite/dist/node/index.js');
await build({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'warn' });

const stage = path.join(web, '.helper-build');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// Every bundled file sits one folder below the package root (server/, mcp/, lib/), like the sources in electron/,
// so the paths they work out from import.meta.url stay the same.
const rolldown = await fromRoot('rolldown/dist/index.mjs');
const RUNTIME = ['@anthropic-ai/claude-agent-sdk', 'ffmpeg-static', '@ffprobe-installer/ffprobe', '@openai/codex-sdk'];
await rolldown.build({
  input: { 'server/web': path.join(root, 'server', 'web.mjs'), 'mcp/server': path.join(root, 'mcp', 'server.mjs') },
  platform: 'node',
  external: [...RUNTIME, 'electron', 'bufferutil', 'utf-8-validate'],
  logLevel: 'warn',
  output: { dir: stage, format: 'esm', entryFileNames: '[name].mjs', chunkFileNames: 'lib/[name]-[hash].mjs', minify: false },
});

for (const f of ['server/site.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) fs.cpSync(path.join(root, f), path.join(stage, f));
fs.cpSync(path.join(root, 'dist'), path.join(stage, 'dist'), { recursive: true });

// the versions the helper downloads later, pinned to the ones this build was tested with
const icutRuntime = Object.fromEntries(RUNTIME.slice(0, 3).map((n) => [n, readJson(path.join(root, 'node_modules', ...n.split('/'), 'package.json')).version]));
const { name, productName, version, description, license, bin, engines, repository, homepage } = rootPkg;
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name, productName, version, description, type: 'module', license, bin, engines, repository, homepage, icutRuntime }, null, 2) + '\n');

const out = path.join(web, 'public', 'helper');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
execSync(`npm pack --pack-destination "${out}" --ignore-scripts --silent`, { cwd: stage, stdio: ['ignore', 'pipe', 'inherit'] });
const file = `ingrainedcut-${version}.tgz`;
if (!fs.existsSync(path.join(out, file))) throw new Error(`npm pack did not produce ${file}`);
fs.writeFileSync(path.join(web, 'lib', 'helper.json'), JSON.stringify({ version, file: `/helper/${file}` }, null, 2) + '\n');
console.log(`[pack-helper] ${file} (${(fs.statSync(path.join(out, file)).size / 1024).toFixed(0)} KB) in web/public/helper`);
