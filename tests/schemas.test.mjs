// Tool registry: the new tools and parameters exist with the right shapes, write tools take dry_run, and no
// existing tool lost a parameter or gained a required one (compared with the 0.2.33 snapshot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { TOOL_DEFS, SERVER_INSTRUCTIONS } from '../electron/tools.mjs';
import { ROOT } from './helpers.mjs';

const def = (name) => {
  const d = TOOL_DEFS.find((x) => x.name === name);
  assert.ok(d, `${name} is registered`);
  return d;
};
const schema = (name) => z.object(def(name).shape);
const ok = (name, args) => assert.ok(schema(name).safeParse(args).success, `${name} accepts ${JSON.stringify(args)}`);
const bad = (name, args) => assert.ok(!schema(name).safeParse(args).success, `${name} rejects ${JSON.stringify(args)}`);
const required = (name) => (z.toJSONSchema(schema(name), { unrepresentable: 'any' }).required ?? []).sort();

test('every tool has a name, a description, where and a zod shape', () => {
  const names = new Set();
  for (const d of TOOL_DEFS) {
    assert.ok(!names.has(d.name), `${d.name} is defined once`);
    names.add(d.name);
    assert.ok(['main', 'renderer'].includes(d.where), `${d.name}.where`);
    assert.ok(d.description?.length > 5, `${d.name} has a description`);
    for (const [k, v] of Object.entries(d.shape)) assert.ok(v instanceof z.ZodType, `${d.name}.${k} is a zod type`);
  }
});

test('existing tools keep their names and parameters, and no new required parameters', () => {
  const before = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'tools-0.2.33.json'), 'utf8'));
  for (const [name, b] of Object.entries(before)) {
    const d = TOOL_DEFS.find((x) => x.name === name);
    assert.ok(d, `${name} still exists`);
    for (const p of b.params) assert.ok(p in d.shape, `${name}.${p} still exists`);
    assert.deepEqual(required(name), b.required, `${name} required params unchanged`);
  }
});

test('skills: list_skills and get_skill', () => {
  assert.deepEqual(required('list_skills'), []);
  ok('get_skill', { name: 'fraggedin-documentary-editor' });
  bad('get_skill', {});
  assert.match(SERVER_INSTRUCTIONS, /documentaries and gaming video essays, load the fraggedin-documentary-editor skill first/);
});

test('duck_audio shape', () => {
  ok('duck_audio', {});
  ok('duck_audio', { target_tracks: ['A4'], key_tracks: ['A3'], depth_db: 15, threshold_db: -40, attack: 0.15, release: 0.6, hold: 0.2, dry_run: true });
  bad('duck_audio', { target_tracks: 'A4' });
  bad('duck_audio', { depth_db: 'deep' });
  assert.deepEqual(required('duck_audio'), []);
});

test('sequence analysis params are optional', () => {
  for (const n of ['analyze_loudness', 'detect_silence', 'detect_scenes']) {
    ok(n, { sequence: true, start: 0, end: 60 });
    bad(n, { sequence: 'yes' });
  }
  ok('analyze_loudness', { media_id: 'm1' });
  ok('detect_scenes', { sequence: true, threshold: 0.3, hold_s: 20 });
});

test('import_edl / import_cues / check_edl shapes', () => {
  ok('import_edl', { path: 'C:/p/04_edl.csv', dry_run: true });
  bad('import_edl', {});
  ok('import_cues', { path: 'C:/p/05_cues.csv', dry_run: true, duck: true });
  bad('import_cues', {});
  ok('check_edl', { path: 'C:/p/04_edl.csv' });
  assert.deepEqual(required('import_edl'), ['path']);
  assert.deepEqual(required('import_cues'), ['path']);
});

test('jl_cut, link_clips, unlink_clips shapes', () => {
  ok('jl_cut', { clip_id: 'c1', audio_lead: 0.33 });
  ok('jl_cut', { clip_id: 'c1', audio_tail: 0.5, dry_run: true });
  bad('jl_cut', { audio_lead: 0.3 });
  ok('link_clips', { clip_ids: ['c1', 'c2'] });
  bad('link_clips', { clip_ids: 'c1' });
  ok('unlink_clips', { clip_ids: ['c1'] });
});

test('export_video loudness_target / true_peak', () => {
  ok('export_video', { path: 'C:/x.mp4', loudness_target: -14, true_peak: -1 });
  bad('export_video', { loudness_target: '-14' });
});

test('add_card shape', () => {
  for (const kind of ['chapter', 'date', 'quote', 'name', 'list']) ok('add_card', { kind, text: 'Hi', start: 1 });
  ok('add_card', { kind: 'quote', text: 'x | y', start: 1, duration: 4, backdrop: 'black', style_path: 'C:/s.json', dry_run: true });
  bad('add_card', { kind: 'banner', text: 'x', start: 0 });
  bad('add_card', { kind: 'chapter', text: 'x', start: 0, backdrop: 'glow' });
  assert.deepEqual(required('add_card'), ['kind', 'start', 'text']);
});

test('export_chapters and qa_report shapes', () => {
  ok('export_chapters', {});
  ok('qa_report', {});
  ok('qa_report', { targets: { hook_by_s: 30, climax_range: [0.45, 0.7], lufs: -14, true_peak: -1, max_hold_s: 20 } });
  bad('qa_report', { targets: { lufs: 'loud' } });
});

test('write tools take dry_run', () => {
  for (const n of ['duck_audio', 'jl_cut', 'link_clips', 'unlink_clips', 'add_card', 'import_edl', 'import_cues', 'add_clip', 'delete_clips']) assert.ok('dry_run' in def(n).shape, `${n}.dry_run`);
  for (const n of ['list_skills', 'get_skill', 'check_edl', 'qa_report', 'export_chapters', 'analyze_loudness']) assert.ok(!('dry_run' in def(n).shape), `${n} is read-only`);
});
