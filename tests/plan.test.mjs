// Reading the plan files (src/docPlan.ts, loaded by Node's TypeScript type stripping): the skill's Reference H
// columns and wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseTime, edlRows, cueRows, parseMotion, parseTransition, inferCard, cardText, parseStyle, matchTitle, fileIn, DEFAULT_STYLE } from '../src/docPlan.ts';

const EDL = `id, timeline_in, timeline_out, section, narration_line, visual_type, source_file_or_url, source_in, source_out, on_screen_text, motion, transition_in, clip_audio_db, music_cue, sfx, credit, deliberate_hold, notes
E1,0:00,0:05,Cold open,"He left, mid-match.",original_clip,media/a.mp4,0,5,,none,cut,0,M1,,Credit: Channel A,,
E2,0:05,0:09.5,Cold open,,gameplay,media/b.mp4,00:00:02:15,6.5,,push_in_3pct,dissolve_0.5s,-6,M1,media/sfx.wav@-8,,,
E3,0:09.5,0:13,The Event,,card,,,,"The Event | Chapter 1",,dip_to_black_0.5s,,,,,,
E4,0:13,0:40,The Event,,original_clip,media/a.mp4,5,32,,,j_cut,0,,,Credit: Channel B,yes,money clip`;

const CUES = `cue_id,timeline_in,timeline_out,type,track_title,source_and_licence,function,level_vs_narration_db,entry,exit,notes
M1,0:00,0:30,music,"(game OST track)","OST, policy checked",tension under cold open,-15,fade_0.5s,cut_on_phrase,stops dead before title
S1,0:30,0:31,silence,,,"beat before title",,,,
M2,0:31,2:30,music,"(library track)","Library licence #...",curiosity bed,-18,hard_on_downbeat,fade_2s,
X1,6:10,6:48,clip_audio,"(original VOD)","Credit: channel name",the money clip,0,j_cut,l_cut,music muted under clip
M3,2:30,4:00,music,music/long_night.wav,"Library",build,-12,fade_1s,fade_1s,`;

test('parseCsv: quotes, commas inside quotes, padded headers', () => {
  const rows = parseCsv(EDL);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].narration_line, 'He left, mid-match.');
  assert.equal(rows[0].source_file_or_url, 'media/a.mp4');
  assert.equal(rows[2].on_screen_text, 'The Event | Chapter 1');
  assert.equal(rows[1]._line, '3');
});

test('parseTime: seconds, m:ss, h:mm:ss, timecode with frames', () => {
  assert.equal(parseTime('12.5', 30), 12.5);
  assert.equal(parseTime('1:02.5', 30), 62.5);
  assert.equal(parseTime('1:00:02', 30), 3602);
  assert.equal(parseTime('00:00:02:15', 30), 2.5);
  assert.throws(() => parseTime('soon', 30));
});

test('edlRows: Reference H columns', () => {
  const r = edlRows(parseCsv(EDL), 30);
  assert.equal(r[0].id, 'E1');
  assert.equal(r[0].type, 'original_clip');
  assert.equal(r[0].source, 'media/a.mp4');
  assert.equal(r[0].section, 'Cold open');
  assert.equal(r[0].narration, 'He left, mid-match.');
  assert.equal(r[1].sin, 2.5);
  assert.equal(r[1].tout, 9.5);
  assert.equal(r[1].motion, 'push_in_3pct');
  assert.equal(r[1].sfx, 'media/sfx.wav@-8');
  assert.equal(r[2].type, 'card');
  assert.equal(r[3].hold, true);
  assert.equal(r[3].notes, 'money clip');
  assert.equal(r[3].transition, 'j_cut');
});

test('cueRows: Reference H columns, the example rows from the skill', () => {
  const c = cueRows(parseCsv(CUES), 30);
  const [m1, s1, m2, x1, m3] = c;
  assert.equal(m1.id, 'M1');
  assert.equal(m1.level, -15);
  assert.equal(m1.fadeIn, 0.5);
  assert.equal(m1.exit, 'cut_on_phrase');
  assert.equal(m1.fadeOut, undefined);
  assert.equal(m1.file, undefined, 'a "(game OST track)" title names no file');
  assert.equal(m1.credit, 'OST, policy checked');
  assert.equal(s1.type, 'silence');
  assert.equal(m2.snap, 'downbeat', 'hard_on_downbeat starts on a downbeat');
  assert.equal(m2.fadeOut, 2);
  assert.equal(x1.type, 'clip_audio');
  assert.equal(x1.level, 0);
  assert.equal(x1.entry, 'j_cut');
  assert.equal(x1.tin, 370);
  assert.equal(m3.file, 'music/long_night.wav');
});

test('motion wording', () => {
  assert.deepEqual(parseMotion('push_in_3pct'), { type: 'push_in', amount: 3, direction: undefined });
  assert.equal(parseMotion('slow_scroll').type, 'slow_scroll');
  assert.deepEqual(parseMotion('pan left'), { type: 'pan', amount: undefined, direction: 'left' });
  assert.equal(parseMotion('none'), null);
  assert.throws(() => parseMotion('wobble'));
});

test('transition wording: cut, dissolve_0.5s, dip_to_black_0.5s, j_cut, l_cut', () => {
  assert.deepEqual(parseTransition('cut'), { type: 'cut', duration: undefined });
  assert.deepEqual(parseTransition('dissolve_0.5s'), { type: 'cross-dissolve', duration: 0.5 });
  assert.deepEqual(parseTransition('dip_to_black_0.5s'), { type: 'dip-to-black', duration: 0.5 });
  assert.deepEqual(parseTransition('j_cut'), { type: 'j_cut', frames: undefined });
  assert.deepEqual(parseTransition('l_cut 8f'), { type: 'l_cut', frames: 8 });
  assert.equal(parseTransition(''), null);
  assert.throws(() => parseTransition('spin_3d'));
});

test('card kinds from the wording', () => {
  assert.equal(inferCard('March 2006'), 'date_card');
  assert.equal(inferCard('2006'), 'date_card');
  assert.equal(inferCard('“I did it for fun” | the hacker'), 'quote_card');
  assert.equal(inferCard('Wallhack; Aimbot; Both'), 'list_card');
  assert.equal(inferCard('The Livestream'), 'chapter_card');
  assert.deepEqual(cardText('quote: Hello there | Obi-Wan'), { preset: 'quote_card', main: 'Hello there', sub: 'Obi-Wan' });
  assert.deepEqual(cardText('The Event | Chapter 1'), { preset: undefined, main: 'The Event', sub: 'Chapter 1' });
});

test('style files: Markdown and JSON, defaults = add_text', () => {
  assert.equal(parseStyle().font, DEFAULT_STYLE.font);
  assert.match(DEFAULT_STYLE.font, /^Inter, Segoe UI/);
  const md = parseStyle('# FraggedIn\n- Font: Arial Black\n- Accent colour: #ffcc00\n- Card blur: 16\n- Card darken: 40');
  assert.equal(md.font, 'Arial');
  assert.equal(md.accent, '#ffcc00');
  assert.equal(md.blur, 16);
  assert.equal(md.darken, 40);
  const js = parseStyle(JSON.stringify({ font: 'Bebas Neue', colors: { text: '#fafafa', accent: '#00aaff' }, card: { blur: 12, darken: 30 } }));
  assert.equal(js.font, 'Bebas Neue');
  assert.equal(js.color, '#fafafa');
  assert.equal(js.accent, '#00aaff');
  assert.equal(js.source, 'style.json');
  assert.throws(() => parseStyle('{ not json'));
});

test('cue files: named in the row, or matched by track title', () => {
  assert.equal(fileIn('music/ost.wav'), 'music/ost.wav');
  assert.equal(fileIn('ost.mp3 (OST, policy checked)'), 'ost.mp3');
  assert.equal(fileIn('(library track)'), undefined);
  const files = ['music/long_night.wav', 'music/bed_loop.wav', 'sfx/click.wav', 'footage/a.mp4'];
  assert.equal(matchTitle('Long Night', files), 'music/long_night.wav');
  assert.equal(matchTitle('Bed Loop (library)', files), 'music/bed_loop.wav');
  assert.equal(matchTitle('(game OST track)', files), undefined);
});
