// Bundled skills: listing, reading, and installing for Claude Code / Codex (temporary home folders only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listSkills, getSkill, installBundledSkills, skillTargets, frontMatter, bundledSkills, SKILLS_DIR } from '../electron/skills.mjs';

const getSkillFiles = (root) => Object.fromEntries(bundledSkills(root).map((s) => [s.folder, s.files]));

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'icut-skills-'));

/** a copy of the bundled skills to change without touching the repo */
function bundle() {
  const root = path.join(tmp(), 'skills');
  fs.cpSync(SKILLS_DIR, root, { recursive: true });
  return root;
}

test('the documentary skill is bundled and listed', () => {
  const list = listSkills();
  const s = list.find((x) => x.name === 'fraggedin-documentary-editor');
  assert.ok(s, 'listed');
  assert.match(s.description, /FraggedIn gaming documentary/);
  const full = getSkill('fraggedin-documentary-editor');
  assert.equal(full.text, fs.readFileSync(path.join(SKILLS_DIR, 'fraggedin-documentary-editor', 'SKILL.md'), 'utf8'));
  assert.match(full.text, /## 3\. Assembling in IngrainedCut/);
  assert.throws(() => getSkill('no-such-skill'), /No bundled skill/);
});

test('the skills are baked into the program and match skills/ byte for byte', () => {
  const baked = getSkillFiles();
  const disk = getSkillFiles(SKILLS_DIR);
  assert.deepEqual(Object.keys(baked), Object.keys(disk), 'same skills');
  for (const [folder, files] of Object.entries(disk)) {
    assert.deepEqual(Object.keys(baked[folder]).sort(), Object.keys(files).sort(), `${folder}: same files`);
    for (const [f, buf] of Object.entries(files)) assert.ok(buf.equals(baked[folder][f]), `${folder}/${f} is identical (run node scripts/embed-skills.mjs)`);
  }
});

test('front matter', () => {
  assert.deepEqual(frontMatter('---\nname: a\ndescription: "b: c"\n---\n# x'), { name: 'a', description: 'b: c' });
});

test('install: new, unchanged, user edits kept, new version replaces with .bak, others untouched', () => {
  const home = tmp();
  const root = bundle();
  const logs = [];
  const log = (m) => logs.push(m);
  // someone else's skill next to ours is never touched
  const other = path.join(home, '.claude', 'skills', 'someone-else', 'SKILL.md');
  fs.mkdirSync(path.dirname(other), { recursive: true });
  fs.writeFileSync(other, 'theirs');

  let r = installBundledSkills({ home, root, log });
  assert.ok(r.length >= 2);
  assert.ok(r.every((x) => x.action === 'installed'), JSON.stringify(r));
  for (const t of skillTargets(home)) {
    const p = path.join(t.dir, 'fraggedin-documentary-editor', 'SKILL.md');
    assert.equal(fs.readFileSync(p, 'utf8'), fs.readFileSync(path.join(root, 'fraggedin-documentary-editor', 'SKILL.md'), 'utf8'), `${t.agent} copy`);
  }
  assert.ok(logs.some((l) => /installed fraggedin-documentary-editor for Claude Code/.test(l)));
  assert.ok(fs.existsSync(path.join(home, '.ingrainedcut', 'installed-skills.json')));

  // second run: nothing written
  logs.length = 0;
  r = installBundledSkills({ home, root, log });
  assert.ok(r.every((x) => x.action === 'unchanged'));
  assert.equal(logs.length, 0);

  // the user edits the installed copy: the same bundled version leaves it alone
  const claudeCopy = path.join(home, '.claude', 'skills', 'fraggedin-documentary-editor', 'SKILL.md');
  fs.appendFileSync(claudeCopy, '\nMy own note.\n');
  r = installBundledSkills({ home, root, log });
  assert.equal(r.find((x) => x.agent === 'Claude Code').action, 'kept_user_edits');
  assert.match(fs.readFileSync(claudeCopy, 'utf8'), /My own note/);

  // a new bundled version: the edited copy is kept as SKILL.md.bak, then replaced; the unedited one has no .bak
  fs.appendFileSync(path.join(root, 'fraggedin-documentary-editor', 'SKILL.md'), '\nNew section.\n');
  r = installBundledSkills({ home, root, log });
  const cc = r.find((x) => x.agent === 'Claude Code');
  assert.equal(cc.action, 'updated');
  assert.deepEqual(cc.backups, ['SKILL.md.bak']);
  assert.match(fs.readFileSync(claudeCopy + '.bak', 'utf8'), /My own note/);
  assert.match(fs.readFileSync(claudeCopy, 'utf8'), /New section/);
  const codex = r.find((x) => x.agent === 'Codex');
  assert.equal(codex.action, 'updated');
  assert.equal(codex.backups, undefined);
  assert.equal(fs.readFileSync(other, 'utf8'), 'theirs');
});

test('install over a copy IngrainedCut did not put there keeps it as .bak', () => {
  const home = tmp();
  const root = bundle();
  const p = path.join(home, '.claude', 'skills', 'fraggedin-documentary-editor', 'SKILL.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'an older hand-copied version');
  const r = installBundledSkills({ home, root, log: () => {} });
  assert.deepEqual(r.find((x) => x.agent === 'Claude Code').backups, ['SKILL.md.bak']);
  assert.equal(fs.readFileSync(p + '.bak', 'utf8'), 'an older hand-copied version');
});
