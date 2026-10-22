// Finds the Claude Code the user already has, so the chat runs on their own install, with their own sign-in (or API
// key), skills and settings. IngrainedCut never signs anyone in to Claude itself.
// Looks for, in order: ICUT_CLAUDE_PATH, `claude` on PATH (native installer or npm), the copy that ships inside the
// Claude desktop app, and older local installs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const isWin = process.platform === 'win32';
const exe = isWin ? 'claude.exe' : 'claude';

/** Newest-version-first comparison of folder names like "2.1.304". */
const byVersionDesc = (a, b) => b.localeCompare(a, undefined, { numeric: true });

function onPath() {
  const r = spawnSync(isWin ? 'where' : 'which', ['claude'], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return null;
  const hits = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const native = hits.find((h) => /\.exe$/i.test(h)) ?? hits.find((h) => !/\.(cmd|ps1|bat)$/i.test(h));
  if (native && fs.existsSync(native)) return native;
  // npm's claude.cmd shim: run the package itself (its native binary, or cli.js with Node)
  for (const shim of hits) {
    const pkg = path.join(path.dirname(shim), 'node_modules', '@anthropic-ai', 'claude-code');
    for (const c of [path.join(pkg, 'bin', exe), path.join(pkg, 'cli.js')]) if (fs.existsSync(c)) return c;
  }
  return null;
}

/** The Claude desktop app keeps Claude Code under <app data>/Claude…/claude-code/<version>/…/claude(.exe). */
function inDesktopApp() {
  const bases = isWin
    ? [process.env.LOCALAPPDATA, process.env.APPDATA]
    : process.platform === 'darwin'
      ? [path.join(os.homedir(), 'Library', 'Application Support')]
      : [path.join(os.homedir(), '.config')];
  const found = [];
  const list = (d) => {
    try {
      return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  };
  const scan = (dir, depth) => {
    if (depth < 0) return;
    for (const name of list(dir)) {
      const full = path.join(dir, name);
      if (name === 'claude-code') {
        for (const ver of list(full).sort(byVersionDesc)) {
          const vdir = path.join(full, ver);
          const direct = path.join(vdir, exe);
          if (fs.existsSync(direct)) found.push({ ver, file: direct });
          for (const sub of list(vdir)) if (fs.existsSync(path.join(vdir, sub, exe))) found.push({ ver, file: path.join(vdir, sub, exe) });
        }
      } else scan(full, depth - 1);
    }
  };
  for (const b of bases.filter(Boolean)) for (const top of list(b)) if (/^claude/i.test(top)) scan(path.join(b, top), 2);
  found.sort((a, b) => byVersionDesc(a.ver, b.ver) || fs.statSync(b.file).mtimeMs - fs.statSync(a.file).mtimeMs);
  return found[0]?.file ?? null;
}

function localInstalls() {
  for (const c of [path.join(os.homedir(), '.local', 'bin', exe), path.join(os.homedir(), '.claude', 'local', exe), path.join(os.homedir(), '.claude', 'local', 'claude')]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * The user's Claude Code, or null when it isn't installed. `source` says where it was found; `.js` paths are run
 * with Node.
 * @returns {{ path: string, source: 'override' | 'path' | 'desktop-app' | 'local' } | null}
 */
export function findClaudeCode() {
  const o = process.env.ICUT_CLAUDE_PATH;
  if (o && fs.existsSync(o)) return { path: o, source: 'override' };
  const p = onPath();
  if (p) return { path: p, source: 'path' };
  const d = inDesktopApp();
  if (d) return { path: d, source: 'desktop-app' };
  const l = localInstalls();
  if (l) return { path: l, source: 'local' };
  return null;
}

export const CLAUDE_CODE_INSTALL = isWin
  ? 'irm https://claude.ai/install.ps1 | iex'
  : 'curl -fsSL https://claude.ai/install.sh | bash';
