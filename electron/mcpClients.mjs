// The helper's `--connect claude|codex|cursor` (server/web.mjs), for people who use IngrainedCut from their own Claude
// Code, Codex or Cursor (on their own plan): adds IngrainedCut's MCP server to that app's user settings, the same entry
// its own `mcp add` would write, so it works without `claude` or `codex` on the PATH.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { findClaudeCode } from './claudeCode.mjs';

const NAME = 'ingrainedcut';
const isWin = process.platform === 'win32';
const electron = !!process.versions.electron;

/** How the apps start the server: with this same Node (or Electron, running as Node), by absolute path. */
function launch(serverPath) {
  return { command: process.execPath, args: [serverPath], env: electron ? { ELECTRON_RUN_AS_NODE: '1' } : undefined };
}

const onPath = (bin) => spawnSync(isWin ? 'where' : 'which', [bin], { windowsHide: true }).status === 0;
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
const sameLaunch = (e, l) => !!e && e.command === l.command && e.args?.[0] === l.args[0];

// ---------- Claude Code: through its own CLI (it owns ~/.claude.json), in user scope ----------
const claudeJson = () => path.join(process.env.CLAUDE_CONFIG_DIR || os.homedir(), '.claude.json');

function runClaude(cc, args) {
  return new Promise((resolve) => {
    const [cmd, argv, env] = cc.path.endsWith('.js') ? [process.execPath, [cc.path, ...args], { ...process.env, ELECTRON_RUN_AS_NODE: '1' }] : [cc.path, args, process.env];
    const p = spawn(cmd, argv, { windowsHide: true, env });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('error', (e) => resolve({ ok: false, out: e.message }));
    p.on('close', (code) => resolve({ ok: code === 0, out }));
  });
}

async function connectClaude(l) {
  const cc = findClaudeCode();
  if (!cc) return { ok: false, out: 'Claude Code isn’t installed on this computer.' };
  if (readJson(claudeJson())?.mcpServers?.[NAME]) await runClaude(cc, ['mcp', 'remove', '--scope', 'user', NAME]);
  const env = Object.entries(l.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  return runClaude(cc, ['mcp', 'add', '--scope', 'user', ...env, NAME, '--', l.command, ...l.args]);
}

// ---------- Codex: ~/.codex/config.toml (the Codex CLI, app and IDE extension all read it) ----------
const codexToml = () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
const OUR_TABLE = new RegExp(`^\\[mcp_servers\\.${NAME}(\\.[^\\]]+)?\\]\\s*$`);

/** The config without our [mcp_servers.ingrainedcut] table (and its sub-tables), plus that table's own text. */
function splitToml(text) {
  const keep = [];
  const ours = [];
  let inOurs = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) inOurs = OUR_TABLE.test(line.trim());
    (inOurs ? ours : keep).push(line);
  }
  return { rest: keep.join('\n').replace(/\n+$/, ''), ours: ours.join('\n') };
}

function codexEntry() {
  let text;
  try {
    text = fs.readFileSync(codexToml(), 'utf8');
  } catch {
    return null;
  }
  const { ours } = splitToml(text);
  if (!ours) return null;
  // values are written by connectCodex below as JSON-compatible TOML strings
  const val = (k) => ours.match(new RegExp(`^${k}\\s*=\\s*(.+)$`, 'm'))?.[1];
  try {
    return { command: JSON.parse(val('command')), args: JSON.parse(val('args')) };
  } catch {
    return { command: '', args: [] };
  }
}

function connectCodex(l) {
  const file = codexToml();
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {}
  // JSON strings are valid TOML basic strings, so paths with backslashes or quotes stay intact
  const table = [`[mcp_servers.${NAME}]`, `command = ${JSON.stringify(l.command)}`, `args = ${JSON.stringify(l.args)}`];
  if (l.env) table.push(`env = { ${Object.entries(l.env).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')} }`);
  const { rest } = splitToml(text);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, (rest ? rest + '\n\n' : '') + table.join('\n') + '\n');
  return { ok: true, out: `Added to ${file}` };
}

// ---------- Cursor: ~/.cursor/mcp.json (the Cursor app and cursor-agent both read it) ----------
const cursorJson = () => path.join(os.homedir(), '.cursor', 'mcp.json');

function connectCursor(l) {
  const file = cursorJson();
  if (fs.existsSync(file) && !readJson(file)) return { ok: false, out: `${file} isn’t valid JSON, so it was left alone. Fix it, or add IngrainedCut by hand.` };
  const cfg = readJson(file) ?? {};
  cfg.mcpServers = { ...(cfg.mcpServers ?? {}), [NAME]: { command: l.command, args: l.args, ...(l.env ? { env: l.env } : {}) } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return { ok: true, out: `Added to ${file}` };
}

// ---------- shared ----------
/** For each app: is it on this computer, is IngrainedCut added, and does that entry start this server. */
export function mcpClientStatus(serverPath) {
  const l = launch(serverPath);
  const status = (installed, entry) => ({ installed, connected: !!entry, current: sameLaunch(entry, l) });
  return {
    claude: status(!!findClaudeCode(), readJson(claudeJson())?.mcpServers?.[NAME]),
    codex: status(onPath('codex') || fs.existsSync(path.dirname(codexToml())), codexEntry()),
    cursor: status(onPath('cursor') || onPath('cursor-agent') || fs.existsSync(path.dirname(cursorJson())), readJson(cursorJson())?.mcpServers?.[NAME]),
  };
}

export async function connectMcpClient(client, serverPath) {
  const l = launch(serverPath);
  try {
    if (client === 'claude') return await connectClaude(l);
    if (client === 'codex') return connectCodex(l);
    if (client === 'cursor') return connectCursor(l);
  } catch (e) {
    return { ok: false, out: e.message };
  }
  return { ok: false, out: `Unknown app ${client}` };
}
