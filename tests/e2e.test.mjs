// End to end through the MCP server: the helper engine runs with a temporary home and app-data folder, the editor
// runs in a headless browser, and every call goes through mcp/server.mjs exactly as Claude Code's would. Fixtures
// are made with FFmpeg lavfi. Skipped when there is no FFmpeg or no Chromium / Chrome / Edge.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ffmpegPath, findBrowser, makeFixtures, startStack, ebur128 } from './helpers.mjs';

const canRun = !!ffmpegPath() && !!findBrowser();
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`);

const EDL_HEAD = 'id,timeline_in,timeline_out,section,narration_line,visual_type,source_file_or_url,source_in,source_out,on_screen_text,motion,transition_in,clip_audio_db,music_cue,sfx,credit,deliberate_hold,notes';
const EDL = [
  EDL_HEAD,
  'E1,0:00,0:05,Cold open,"He left, mid-match.",original_clip,media/footage1.mp4,0,5,,none,cut,0,M1,,Credit: Channel A,,',
  'E2,0:05,0:09,Cold open,,gameplay,media/footage2.mp4,2,6,,push_in_3pct,dissolve_0.5s,-6,M1,media/sfx.wav@-8,,,',
  'E3,0:09,0:13,The Event,,card,,,,The Event | Chapter 1,none,dip_to_black_0.5s,,,,,,',
  'E4,0:13,0:18,The Event,,photo,media/photo.png,,,Falador | March 2006,pan,cut,,,,Photo: Archive,,',
  'E5,0:18,0:23,The Event,,artifact,media/photo.png,,,,slow_scroll,dissolve_0.5s,,,,,,',
  'E6,0:23,0:30,The Event,,original_clip,media/footage1.mp4,4,11,name: Tobi | Player,none,j_cut,0,,,Credit: Channel B,yes,money clip',
].join('\n');
const BAD_EDL = [
  EDL_HEAD,
  'B1,0:00,0:04,Intro,,gameplay,media/footage2.mp4,0,4,,none,cut,,,,,,',
  'B2,0:04,0:08,Intro,,original_clip,https://example.com/watch?v=1,,,,,,,,,,,',
  'B3,0:08,0:10,Intro,,interview,media/missing.mp4,,,,,,,,,,,',
  'B4,,0:12,Intro,,gameplay,media/footage2.mp4,,,,,,,,,,,',
  'B5,0:12,0:14,Intro,,hologram,media/footage2.mp4,,,,,,,,,,,',
].join('\n');
const CUES = [
  'cue_id,timeline_in,timeline_out,type,track_title,source_and_licence,function,level_vs_narration_db,entry,exit,notes',
  'M1,0:00,0:20,music,Bed Loop,"Library licence #1",curiosity bed,-15,hard_on_downbeat,fade_1s,',
  'S1,0:20,0:21,silence,,,beat,,,,',
  'M2,0:21,0:36,music,music/bed_loop.wav,"Library licence #1",build,-12,fade_0.5s,cut_on_phrase,',
  'X1,0:23,0:30,clip_audio,(original VOD),Credit: Channel B,the money clip,0,,l_cut,music muted under clip',
  'FX1,0:13,0:14,sfx,sfx.wav,,click,-6,,,',
  'Z1,0:40,0:50,music,(nothing like this),,missing,-15,,,',
].join('\n');

/** volume at timeline time t from duck_audio's keyframe list */
function envAt(keys, t) {
  if (t <= keys[0].t) return keys[0].db;
  for (let i = 0; i < keys.length - 1; i++) if (t <= keys[i + 1].t) return keys[i].db + ((keys[i + 1].db - keys[i].db) * (t - keys[i].t)) / (keys[i + 1].t - keys[i].t || 1);
  return keys[keys.length - 1].db;
}

describe('IngrainedCut documentary tools, end to end through MCP', { skip: !canRun && 'needs FFmpeg and a Chromium-based browser', timeout: 25 * 60_000 }, () => {
  let S;
  let dir;
  let call;
  const state = async () => JSON.parse(JSON.stringify(await call('get_project_state', {})));
  const byEdl = (st, id) => st.clips.filter((c) => c.meta?.edl === id);

  before(async () => {
    const model = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'IngrainedCut', 'models', 'ggml-base.en.bin');
    S = await startStack({ settings: fs.existsSync(model) ? { whisperModel: model } : {} });
    call = S.call;
    dir = path.join(S.tmp, 'proj');
    fs.mkdirSync(dir, { recursive: true });
    makeFixtures(dir);
    fs.writeFileSync(path.join(dir, '04_edl.csv'), EDL);
    fs.writeFileSync(path.join(dir, 'bad_edl.csv'), BAD_EDL);
    fs.writeFileSync(path.join(dir, '05_cues.csv'), CUES);
    await call('save_project', { path: path.join(dir, 'doc.icut') });
  });
  after(async () => {
    await S?.stop();
  });

  test('get_project_state, list_skills and get_skill through the MCP server', async () => {
    const tools = (await S.client.listTools()).tools.map((t) => t.name);
    for (const n of ['duck_audio', 'jl_cut', 'link_clips', 'unlink_clips', 'add_card', 'import_edl', 'import_cues', 'check_edl', 'export_chapters', 'qa_report', 'list_skills', 'get_skill']) assert.ok(tools.includes(n), `${n} is offered`);
    const st = await call('get_project_state', { detail: 'summary' });
    assert.ok(String(st).length > 10);
    const ls = await call('list_skills');
    assert.ok(ls.skills.some((s) => s.name === 'fraggedin-documentary-editor'));
    const sk = await call('get_skill', { name: 'fraggedin-documentary-editor' });
    assert.match(sk[0], /^---\nname: fraggedin-documentary-editor/);
    assert.match(sk[0], /duck_audio/);
    // the engine installed it for Claude Code and Codex in the (temporary) home folder
    for (const d of ['.claude', '.agents']) assert.ok(fs.existsSync(path.join(S.home, d, 'skills', 'fraggedin-documentary-editor', 'SKILL.md')), `${d} copy`);
  });

  test('import_edl reports every row it cannot place, and a dry run changes nothing', async () => {
    const r = await call('import_edl', { path: path.join(dir, 'bad_edl.csv'), dry_run: true });
    assert.equal(r.dry_run, true);
    const why = Object.fromEntries(r.result.skipped.map((s) => [s.id, s.reason]));
    assert.match(why.B2, /link/);
    assert.match(why.B3, /not found/);
    assert.match(why.B4, /timeline_in/);
    assert.match(why.B5, /not understood/);
    assert.equal(r.result.placed, 1);
    assert.equal((await state()).clips.length, 0, 'nothing placed');
  });

  test('import_edl builds the expected clips on the skill track layout', async () => {
    const r = await call('import_edl', { path: path.join(dir, '04_edl.csv') });
    assert.equal(r.result.placed, 6, JSON.stringify(r.result.skipped));
    assert.deepEqual(r.result.skipped, []);
    const st = await state();
    const lab = (c) => c.track;
    const names = Object.fromEntries(st.tracks.map((t) => [t.label, t.name]));
    assert.equal(names.V1, 'Footage');
    assert.equal(names.V2, 'Panels');
    assert.equal(names.V3, 'Adjustments');
    assert.equal(names.V4, 'Cards');
    assert.equal(names.A1, 'Clip audio');
    assert.equal(names.A3, 'Narration');
    assert.equal(names.A4, 'Music');
    assert.equal(names.A5, 'SFX / Ambience');
    const e1 = byEdl(st, 'E1');
    assert.deepEqual(e1.map(lab).sort(), ['A1', 'V1']);
    assert.equal(e1.find((c) => c.kind === 'video').meta.credit, 'Credit: Channel A');
    const e2 = byEdl(st, 'E2');
    assert.deepEqual(e2.map(lab).sort(), ['A1', 'A5', 'V1']);
    assert.equal(e2.find((c) => c.track === 'A1').volume, -6);
    assert.equal(e2.find((c) => c.track === 'A5').volume, -8);
    const e2v = e2.find((c) => c.kind === 'video');
    assert.equal(e2v.transitionIn.type, 'cross-dissolve');
    near(e2v.in, 2, 1e-6, 'E2 source in');
    assert.ok(e2v.keyframes.scale?.length === 2, 'push_in_3pct');
    near(e2v.keyframes.scale[1].v / e2v.keyframes.scale[0].v, 1.03, 1e-3, 'push 3%');
    const e3 = byEdl(st, 'E3');
    assert.ok(e3.some((c) => c.kind === 'color' && c.track === 'V3' && c.color === '#000000'), 'card on black on V3');
    assert.ok(e3.some((c) => c.kind === 'text' && c.track === 'V4' && c.text.content === 'The Event'), 'card text on V4');
    assert.equal(e3.find((c) => c.kind === 'color').transitionIn?.type, 'dip-to-black');
    assert.ok(st.markers.some((m) => m.kind === 'chapter' && m.name === 'The Event' && Math.abs(m.time - 9) < 1e-6), 'chapter marker');
    const e4 = byEdl(st, 'E4');
    assert.ok(e4.some((c) => c.kind === 'image' && c.track === 'V1' && c.keyframes?.x?.length === 2), 'photo with a pan on V1');
    assert.ok(e4.some((c) => c.kind === 'text' && c.track === 'V4' && c.meta.preset === 'name_super'), 'super');
    const e5 = byEdl(st, 'E5');
    assert.ok(e5.some((c) => c.kind === 'image' && c.track === 'V2' && c.meta.role === 'panel'), 'artifact as a panel on V2');
    const e6 = byEdl(st, 'E6');
    const e6v = e6.find((c) => c.kind === 'video');
    const e6a = e6.find((c) => c.kind === 'audio');
    assert.equal(e6v.linkId, e6a.linkId, 'still linked');
    assert.equal(Math.round((e6v.start - e6a.start) * 30), 10, 'j_cut: sound 10 frames early');
    assert.ok(st.markers.some((m) => m.kind === 'hold' && Math.abs(m.time - 23) < 1e-6 && Math.abs(m.duration - 7) < 1e-6), 'deliberate hold marker');
  });

  test('check_edl reports zero differences, and finds a moved clip', async () => {
    const r = await call('check_edl', { path: path.join(dir, '04_edl.csv') });
    assert.equal(r.differences, 0, JSON.stringify(r));
    assert.equal(r.matching, 6);
    const e4 = byEdl(await state(), 'E4').find((c) => c.kind === 'image');
    await call('move_clip', { clip_id: e4.id, start: 13.5 });
    const moved = await call('check_edl', { path: path.join(dir, '04_edl.csv') });
    assert.equal(moved.moved.length, 1);
    assert.equal(moved.moved[0].id, 'E4');
    await call('undo', {});
    assert.equal((await call('check_edl', { path: path.join(dir, '04_edl.csv') })).differences, 0);
  });

  test('jl_cut offsets are frame-exact and keep the link', async () => {
    const st = await state();
    const v2 = byEdl(st, 'E2').find((c) => c.kind === 'video');
    const r = await call('jl_cut', { clip_id: v2.id, audio_lead: 0.33 });
    assert.equal(r.result.clips[0].lead_frames, 10);
    const v6 = byEdl(st, 'E6').find((c) => c.kind === 'video');
    const r6 = await call('jl_cut', { clip_id: v6.id, audio_tail: 0.5 });
    assert.equal(r6.result.clips[0].tail_frames, 15);
    const after = await state();
    const a2 = byEdl(after, 'E2').find((c) => c.kind === 'audio' && c.track === 'A1');
    const p2 = byEdl(after, 'E2').find((c) => c.kind === 'video');
    assert.equal(a2.linkId, p2.linkId);
    assert.ok(Math.abs(p2.start - a2.start - 10 / 30) < 1e-9, `lead ${p2.start - a2.start} is exactly 10 frames`);
    const a6 = byEdl(after, 'E6').find((c) => c.kind === 'audio');
    const p6 = byEdl(after, 'E6').find((c) => c.kind === 'video');
    assert.ok(Math.abs(a6.start + a6.duration - (p6.start + p6.duration) - 15 / 30) < 1e-9, 'tail is exactly 15 frames');
    // the picture did not move
    near(p2.start, 5, 1e-9, 'E2 picture start');
    // dry run
    const dry = await call('jl_cut', { clip_id: v2.id, audio_lead: 0, dry_run: true });
    assert.equal(dry.dry_run, true);
    assert.ok(Math.abs(byEdl(await state(), 'E2').find((c) => c.track === 'A1').start - (5 - 10 / 30)) < 1e-9, 'dry run changed nothing');
  });

  test('link_clips and unlink_clips', async () => {
    const st = await state();
    const [v, a] = ['video', 'audio'].map((k) => byEdl(st, 'E1').find((c) => c.kind === k));
    await call('unlink_clips', { clip_ids: [v.id] });
    let s2 = await state();
    assert.ok(!s2.clips.find((c) => c.id === v.id).linkId && !s2.clips.find((c) => c.id === a.id).linkId, 'both unlinked');
    const r = await call('link_clips', { clip_ids: [v.id, a.id] });
    s2 = await state();
    assert.equal(s2.clips.find((c) => c.id === v.id).linkId, r.result.link);
    assert.equal(s2.clips.find((c) => c.id === a.id).linkId, r.result.link);
  });

  test('import_cues: Reference H cue sheet, levels against the narration, ducking', async () => {
    await call('add_clip', { path: path.join(dir, 'media', 'narration.wav'), track: 'A3', start: 0 });
    const dry = await call('import_cues', { path: path.join(dir, '05_cues.csv'), duck: true, dry_run: true });
    assert.equal(dry.dry_run, true);
    const r = await call('import_cues', { path: path.join(dir, '05_cues.csv'), duck: true });
    const res = r.result;
    const placed = Object.fromEntries(res.placed.map((p) => [p.id, p]));
    assert.equal(placed.M1.track, 'A4');
    assert.equal(placed.M1.file, 'bed_loop.wav', 'matched by track title');
    assert.equal(placed.FX1.track, 'A5');
    assert.ok(placed.X1.music_out_under.length >= 1, 'music out under the clip sound');
    assert.ok(res.skipped.some((s) => s.id === 'Z1' && /no file for track_title/.test(s.reason)));
    // the bed: measured against the narration (narration LUFS - music LUFS), ducked by 15 under the voice
    const narr = ebur128(path.join(dir, 'media', 'narration.wav')).I;
    const mus = ebur128(path.join(dir, 'media', 'music', 'bed_loop.wav')).I;
    near(placed.M1.gain_db, narr - mus, 1.0, 'M1 bed at the narration level in the gaps');
    assert.equal(placed.M1.ducks_by_db, 15);
    assert.ok(r.result.levels.some((l) => /Narration measured at/.test(l)));
    assert.ok(r.snapped?.length >= 1, 'hard_on_downbeat snapped');
    assert.ok(r.cut_on_phrase?.length >= 1 || r.phrase_notes, 'cut_on_phrase handled');
    const st = await state();
    const x1 = st.clips.filter((c) => c.meta?.gainLayers?.['cue:X1']);
    assert.ok(x1.length >= 1, 'X1 sets the clip sound level');
  });

  test('duck_audio puts keyframes where the key track has speech', async () => {
    const r = await call('duck_audio', { target_tracks: ['A4'], key_tracks: ['A3'], depth_db: 15, threshold_db: -40, attack: 0.15, release: 0.6, hold: 0.2 });
    const regions = r.result.key_regions;
    // narration: 1.5 s bursts every 3 s from 0 to 30 s
    assert.equal(regions.length, 10, JSON.stringify(regions));
    regions.forEach(([s, e], i) => {
      near(s, i * 3, 0.06, `burst ${i} start`);
      near(e, i * 3 + 1.5, 0.06, `burst ${i} end`);
    });
    const m1 = r.result.clips.find((c) => c.keyframes.length && c.keyframes[0].t < 1);
    assert.ok(m1, 'the first music clip has keyframes');
    const base = envAt(m1.keyframes, 2.55);
    for (const k of [1, 2, 3, 4, 5]) {
      near(envAt(m1.keyframes, k * 3 + 0.75), base - 15, 0.6, `ducked in burst ${k}`);
      near(envAt(m1.keyframes, k * 3 + 2.55), base, 0.6, `back up in gap ${k}`);
    }
  });

  test('add_card: each kind, backdrops, one undo step each, dry run', async () => {
    const before = (await state()).clips.length;
    const dry = await call('add_card', { kind: 'chapter', text: 'Part Two | Chapter 2', start: 31, duration: 4, dry_run: true });
    assert.equal(dry.dry_run, true);
    assert.equal((await state()).clips.length, before);
    const ch = await call('add_card', { kind: 'chapter', text: 'Part Two | Chapter 2', start: 1, duration: 3 });
    assert.equal(ch.result.backdrop, 'blur');
    assert.equal(ch.result.style, 'style.md', 'FraggedIn/style.md next to the project');
    const st = await state();
    const made = st.clips.filter((c) => ch.result.created.includes(c.id));
    assert.ok(made.some((c) => c.kind === 'adjustment' && c.track === 'V3' && c.fx.blur > 0 && c.fx.brightness < 0), 'blur + darken on V3');
    assert.ok(made.some((c) => c.kind === 'text' && c.track === 'V4' && c.text.content === 'Part Two' && c.fadeIn > 0 && c.fadeOut > 0), 'text with fades on V4');
    assert.ok(made.some((c) => c.kind === 'text' && c.text.content === 'CHAPTER 2' && c.text.color === '#ffcc00'), 'accent subtitle from style.md');
    assert.ok(st.markers.some((m) => m.kind === 'chapter' && m.name === 'Part Two'));
    const date = await call('add_card', { kind: 'date', text: 'March 2006', start: 33, backdrop: 'black' });
    assert.ok((await state()).clips.some((c) => date.result.created.includes(c.id) && c.kind === 'color' && c.color === '#000000'));
    const q = await call('add_card', { kind: 'quote', text: 'I did it for fun | the hacker', start: 37, backdrop: 'none' });
    assert.ok(!(await state()).clips.some((c) => q.result.created.includes(c.id) && (c.kind === 'adjustment' || c.kind === 'color')));
    const nm = await call('add_card', { kind: 'name', text: 'Tobi | Player', start: 24 });
    assert.equal(nm.result.backdrop, 'none');
    const ls = await call('add_card', { kind: 'list', text: 'Wallhack; Aimbot; Both', start: 41 });
    assert.equal(ls.result.created.length, 2);
    // one undo step removes the whole card
    await call('undo', {});
    const after = await state();
    assert.ok(!after.clips.some((c) => ls.result.created.includes(c.id)));
    await call('redo', {});
  });

  test('sequence loudness matches ffmpeg ebur128 on an exported wav within 0.5 LU', async (t) => {
    // turn every audio track down 12 dB so the file does not clip and the true peaks compare too (undone after)
    const audio = (await state()).tracks.filter((x) => x.kind === 'audio').map((x) => x.label);
    await call('batch', { operations: audio.map((track) => ({ tool: 'manage_tracks', args: { action: 'set', track, volume_db: -12 } })) });
    const L = await call('analyze_loudness', { sequence: true, per_second: true });
    assert.ok(Array.isArray(L.short_term_lufs) && L.short_term_lufs.length > 20, 'per-second short-term loudness');
    assert.ok(Number.isFinite(L.loudness_range_lu));
    const wav = path.join(dir, 'qa', 'mix.wav');
    fs.mkdirSync(path.dirname(wav), { recursive: true });
    await call('export_video', { path: wav, format: 'wav', normalize: false });
    const ff = ebur128(wav);
    near(L.integrated_lufs, ff.I, 0.5, 'integrated LUFS vs ffmpeg');
    // a 16-bit file clips at 0 dBFS, so the true peaks only compare when the mix stays under it
    if (ff.TP < -0.3) near(L.true_peak_dbtp, ff.TP, 0.5, 'true peak vs ffmpeg');
    else assert.ok(L.true_peak_dbtp > -0.5, `the mix goes over 0 dBTP (${L.true_peak_dbtp}) and the file clipped (${ff.TP})`);
    t.diagnostic(`IngrainedCut ${L.integrated_lufs} LUFS / ${L.true_peak_dbtp} dBTP / LRA ${L.loudness_range_lu}; ffmpeg ${ff.I} LUFS / ${ff.TP} dBTP / LRA ${ff.LRA}`);
    assert.ok(ff.TP < -0.3, `the turned-down mix does not clip (${ff.TP})`);
    await call('undo', {});
  });

  test('export with loudness_target lands at -14 ±0.5 LUFS with true peak ≤ -1 dBTP', async (t) => {
    for (const [file, format] of [['norm.wav', 'wav'], ['norm.mp4', 'mp4-h264']]) {
      const out = path.join(dir, 'qa', file);
      const r = await call('export_video', { path: out, format, loudness_target: -14, true_peak: -1, quality: 30, height: 360 });
      assert.ok(r.loudness, 'the export reports its loudness');
      const ff = ebur128(out);
      near(ff.I, -14, 0.5, `${format} integrated`);
      t.diagnostic(`${format}: ffmpeg ${ff.I} LUFS, ${ff.TP} dBTP; export reports ${JSON.stringify(r.loudness)}`);
      assert.ok(ff.TP <= -1, `${format} true peak ${ff.TP} dBTP ≤ -1`);
    }
  });

  test('detect_silence and detect_scenes with sequence: true', async () => {
    const sil = await call('detect_silence', { sequence: true, threshold_db: -45, min_duration: 0.4 });
    assert.ok(Array.isArray(sil.silences));
    const sc = await call('detect_scenes', { sequence: true, threshold: 0.3 });
    assert.equal(sc.sequence, true);
    const cuts = sc.cut_times.map((c) => c.at);
    for (const t of [5, 9, 13, 23]) assert.ok(cuts.some((x) => Math.abs(x - t) < 0.05), `a cut at ${t} s (${cuts.join(', ')})`);
    assert.ok(sc.shots > 4 && sc.average_shot_length > 0 && Array.isArray(sc.longest_shots) && Array.isArray(sc.holds));
  });

  test('export_chapters lists the chapter markers', async () => {
    const r = await call('export_chapters', {});
    assert.match(r.chapters, /^0:00 /);
    assert.match(r.chapters, /0:09 The Event/);
  });

  test('qa_report on the cut, then flags a deliberately broken fixture', async (t) => {
    const st = await state();
    const dur = Math.max(...st.clips.map((c) => c.start + c.duration));
    await call('markers', { action: 'add', time: 12, name: 'Hook', kind: 'hook' });
    await call('markers', { action: 'add', time: dur * 0.55, name: 'Climax', kind: 'climax' });
    const good = await call('qa_report', { edl_path: path.join(dir, '04_edl.csv') });
    t.diagnostic(`qa_report on the cut: ${good.summary}; ${good.checks.map((c) => `${c.check}=${c.pass}`).join(' ')}`);
    const chk = Object.fromEntries(good.checks.map((c) => [c.check, c]));
    assert.equal(chk.hook.pass, true, JSON.stringify(chk.hook));
    assert.equal(chk.climax.pass, true, JSON.stringify(chk.climax));
    assert.equal(chk.edl.pass, true, JSON.stringify(chk.edl));
    assert.equal(chk.holds.pass, true, JSON.stringify(chk.holds));
    assert.ok('loudness' in chk && 'silences' in chk && 'freezes' in chk && 'pace' in chk, Object.keys(chk).join(', '));

    // the broken cut: one 32 s frozen, silent shot, an 8 s gap, the narration late, the climax far too early
    await call('delete_clips', { clip_ids: (await state()).clips.map((c) => c.id) });
    await call('markers', { action: 'clear' });
    await call('add_clip', { path: path.join(dir, 'media', 'frozen.mp4'), track: 'V1', start: 0 });
    await call('add_clip', { path: path.join(dir, 'media', 'narration.wav'), track: 'A3', start: 40, volume_db: -20 });
    await call('markers', { action: 'add', time: 45, name: 'Hook', kind: 'hook' });
    await call('markers', { action: 'add', time: 5, name: 'Climax', kind: 'climax' });
    const bad = await call('qa_report', { skip: ['transcript'] });
    t.diagnostic(`qa_report on the broken fixture: ${bad.summary}; issues: ${bad.issues.map((i) => `${i.timecode} ${i.type}`).join(', ')}`);
    const b = Object.fromEntries(bad.checks.map((c) => [c.check, c]));
    assert.equal(bad.pass, false);
    for (const k of ['hook', 'climax', 'holds', 'freezes', 'silences', 'loudness']) assert.equal(b[k]?.pass, false, `${k} flagged: ${JSON.stringify(b[k])}`);
    const types = new Set(bad.issues.map((i) => i.type));
    for (const t of ['hold', 'freeze', 'silence', 'loudness']) assert.ok(types.has(t), `an issue of type ${t}`);
    assert.ok(bad.issues.some((i) => i.type === 'silence' && i.at < 1), 'the silent opening is flagged');
    assert.ok(bad.issues.every((i) => typeof i.at === 'number' && /^\d+:\d\d/.test(i.timecode)), 'issues have timestamps');
  });
});
