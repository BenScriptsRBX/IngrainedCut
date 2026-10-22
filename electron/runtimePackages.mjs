// Packages the npx helper fetches after it has started, instead of npx installing them up front (which made the first
// `npx` run take over a minute): the Claude Agent SDK — without the copy of Claude Code it bundles, since the chat runs
// on the user's own Claude Code — and FFmpeg for computers that don't have it (media.mjs). A checkout of this repo
// (desktop app, development) already has them in node_modules.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { userDataDir } from './paths.mjs';

const isWin = process.platform === 'win32';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

/** Where a group of on-demand packages is installed (one folder each, so their installs don't touch each other). */
export const runtimeDir = (group) => path.join(userDataDir(), 'runtime', group);

/** A package's folder: in one of `dirs` (where the helper installs it), else in node_modules above this file. */
export function findPackage(name, ...dirs) {
  for (const start of [...dirs, HERE]) {
    for (let d = start; ; d = path.dirname(d)) {
      const dir = path.join(d, 'node_modules', ...name.split('/'));
      if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
      if (path.dirname(d) === d) break;
    }
  }
  return null;
}

/** The version to install: pinned by web/scripts/pack-helper.mjs in the helper's package.json, else its range there. */
export function versionOf(name) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return pkg.icutRuntime?.[name] ?? pkg.dependencies?.[name] ?? pkg.optionalDependencies?.[name] ?? 'latest';
  } catch {
    return 'latest';
  }
}

/** `npm install` into `dir`, streaming npm's output lines to onLine. */
export function npmInstall(dir, specs, { args = [], onLine = () => {} } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const pkg = path.join(dir, 'package.json');
  if (!fs.existsSync(pkg)) fs.writeFileSync(pkg, JSON.stringify({ name: 'ingrainedcut-' + path.basename(dir), private: true }, null, 2));
  return new Promise((resolve) => {
    const proc = spawn(isWin ? 'npm.cmd' : 'npm', ['install', ...specs, '--no-audit', '--no-fund', '--loglevel', 'http', ...args], { cwd: dir, windowsHide: true, shell: isWin });
    let out = '';
    const take = (d) => {
      out += d.toString();
      for (const line of d.toString().split(/\r?\n/)) if (line.trim()) onLine(line.trim().slice(0, 200));
    };
    proc.stdout.on('data', take);
    proc.stderr.on('data', take);
    proc.on('error', (e) => resolve({ ok: false, out: e.message }));
    proc.on('close', (code) => resolve({ ok: code === 0, out: out.slice(-2000) }));
  });
}

/** Import an ES module package from its folder. */
export function importPackage(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const e = pkg.exports?.['.'];
  const entry = typeof e === 'string' ? e : (e?.import ?? e?.default ?? pkg.module ?? pkg.main ?? 'index.js');
  return import(pathToFileURL(path.join(dir, entry)).href);
}

// ---------- Claude Agent SDK ----------
const CLAUDE_SDK = '@anthropic-ai/claude-agent-sdk';
let claudeSdkLoad = null;

export const claudeSdkInstalled = () => !!findPackage(CLAUDE_SDK, runtimeDir('claude'));

/** The Claude Agent SDK module, downloaded (~5 MB) the first time it's needed. */
export function claudeSdk() {
  claudeSdkLoad ??= (async () => {
    if (!claudeSdkInstalled()) {
      // its optional dependencies are the bundled Claude Code (~280 MB); IngrainedCut runs the user's own instead
      const r = await npmInstall(runtimeDir('claude'), [`${CLAUDE_SDK}@${versionOf(CLAUDE_SDK)}`], { args: ['--omit=optional'] });
      if (!claudeSdkInstalled()) throw new Error(`Couldn't download the Claude Agent SDK (is this computer online?)\n${r.out.slice(-400)}`);
    }
    return importPackage(findPackage(CLAUDE_SDK, runtimeDir('claude')));
  })().catch((e) => {
    claudeSdkLoad = null;
    throw e;
  });
  return claudeSdkLoad;
}
