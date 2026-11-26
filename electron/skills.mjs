// Skills that ship with IngrainedCut (skills/<name>/SKILL.md plus any files next to it). They are installed for the
// agents IngrainedCut works with, so a Claude Code / Codex / Cursor session picks them up on its own:
//   ~/.claude/skills/<name>/   Claude Code (the in-app Claude chat loads the user's skills too; Cursor reads it as well)
//   ~/.agents/skills/<name>/   Codex (and other agents that read the shared .agents folder)
// Installing is cheap and safe to call often: a skill is only written when the bundled copy is new or changed
// (content hashes; edits to an installed copy of the current version are left alone), an installed copy the user
// edited is kept as <file>.bak before a newer bundled version replaces it, and skills
// IngrainedCut did not install are never touched or deleted. What was installed is recorded in
// ~/.ingrainedcut/installed-skills.json. Any MCP client can also read them with list_skills / get_skill.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');

/** Where each agent looks for user skills. */
export function skillTargets(home = os.homedir()) {
  return [
    { agent: 'Claude Code', dir: path.join(home, '.claude', 'skills') },
    { agent: 'Codex', dir: path.join(home, '.agents', 'skills') },
  ];
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Every file of a skill folder, relative paths with forward slashes, sorted. */
function filesOf(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.endsWith('.bak')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return out.sort();
}

/** { file: sha256 } for the given files of `dir` (missing files are left out). */
function fileHashes(dir, files) {
  const h = {};
  for (const f of files) {
    const p = path.join(dir, ...f.split('/'));
    if (fs.existsSync(p)) h[f] = sha(fs.readFileSync(p));
  }
  return h;
}
const treeHash = (hashes) => sha(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)).map(([f, h]) => `${f}\0${h}`).join('\n'));

/** name and description from a SKILL.md front matter */
export function frontMatter(md) {
  const m = md.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

/** The skills bundled with this build. */
export function bundledSkills(root = SKILLS_DIR) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, 'SKILL.md')))
    .map((e) => {
      const dir = path.join(root, e.name);
      const fm = frontMatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
      return { name: fm.name || e.name, folder: e.name, description: fm.description || '', dir };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listSkills(root = SKILLS_DIR) {
  return bundledSkills(root).map(({ name, description }) => ({ name, description }));
}

export function getSkill(name, root = SKILLS_DIR) {
  const key = String(name ?? '').trim().toLowerCase();
  const s = bundledSkills(root).find((x) => x.name.toLowerCase() === key || x.folder.toLowerCase() === key);
  if (!s) throw new Error(`No bundled skill "${name}". Skills: ${bundledSkills(root).map((x) => x.name).join(', ') || 'none'}`);
  const files = filesOf(s.dir).filter((f) => f !== 'SKILL.md');
  return { name: s.name, description: s.description, text: fs.readFileSync(path.join(s.dir, 'SKILL.md'), 'utf8'), ...(files.length ? { other_files: files } : {}) };
}

/**
 * Copy every bundled skill to each agent's skills folder when it is new or changed there.
 * @param {{ home?: string, root?: string, log?: (msg: string) => void }} [o]
 * @returns {{ skill: string, agent: string, dir: string, action: 'installed'|'updated'|'unchanged'|'kept_user_edits', backups?: string[] }[]}
 */
export function installBundledSkills(o = {}) {
  const home = o.home ?? os.homedir();
  const root = o.root ?? SKILLS_DIR;
  const log = o.log ?? ((m) => console.log(m));
  const manifestFile = path.join(home, '.ingrainedcut', 'installed-skills.json');
  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch {}
  const results = [];
  let changed = false;
  for (const s of bundledSkills(root)) {
    const files = filesOf(s.dir);
    const bundled = fileHashes(s.dir, files);
    const want = treeHash(bundled);
    for (const t of skillTargets(home)) {
      const dest = path.join(t.dir, s.folder);
      const have = fileHashes(dest, files);
      const rec = manifest[s.folder]?.[t.dir];
      if (treeHash(have) === want) {
        results.push({ skill: s.name, agent: t.agent, dir: dest, action: 'unchanged' });
        if (!rec || rec.hash !== want) {
          manifest[s.folder] = { ...manifest[s.folder], [t.dir]: { hash: want, files: bundled, at: new Date().toISOString() } };
          changed = true;
        }
        continue;
      }
      if (rec?.hash === want) {
        // this bundled version is already installed and the user has edited it since: leave their copy alone
        results.push({ skill: s.name, agent: t.agent, dir: dest, action: 'kept_user_edits' });
        continue;
      }
      // a file that differs from what IngrainedCut last put there was edited by the user: keep it as .bak
      const backups = [];
      for (const [f, h] of Object.entries(have)) {
        if (h === bundled[f]) continue;
        if (rec?.files?.[f] === h) continue; // our own earlier version, not an edit
        const p = path.join(dest, ...f.split('/'));
        fs.copyFileSync(p, `${p}.bak`);
        backups.push(`${f}.bak`);
      }
      for (const f of files) {
        const to = path.join(dest, ...f.split('/'));
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(path.join(s.dir, ...f.split('/')), to);
      }
      const action = Object.keys(have).length ? 'updated' : 'installed';
      results.push({ skill: s.name, agent: t.agent, dir: dest, action, ...(backups.length ? { backups } : {}) });
      log(`[skills] ${action} ${s.name} for ${t.agent} in ${dest}${backups.length ? ` (your edited copy kept as ${backups.join(', ')})` : ''}`);
      manifest[s.folder] = { ...manifest[s.folder], [t.dir]: { hash: want, files: bundled, at: new Date().toISOString() } };
      changed = true;
    }
  }
  if (changed) {
    fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  }
  return results;
}

/** installBundledSkills that never throws (app start, before an agent launches). */
export function ensureSkillsInstalled(o = {}) {
  try {
    return installBundledSkills(o);
  } catch (e) {
    (o.log ?? console.error)(`[skills] could not install the bundled skills: ${e.message}`);
    return [];
  }
}
