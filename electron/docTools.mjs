// Documentary tools on the engine side: they read the plan files (EDL, cues, script, style.md), run FFmpeg over the
// footage on screen (cuts, freezes), transcribe the narration, and put together the QA report, chapters, credits,
// Shorts and snapshots. The timeline edits themselves happen in the editor (src/docTools.ts).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { detectScenes, detectFreezes, transcribe } from './media.mjs';
import { getSettings } from './settings.mjs';
import { userDataDir } from './paths.mjs';

const r3 = (x) => Math.round(x * 1000) / 1000;
const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1) }] });
const clipEnd = (c) => c.start + c.duration;

function readText(p, what) {
  if (!p) throw new Error(`Pass the path of the ${what}`);
  if (!path.isAbsolute(p)) throw new Error(`${p}: give the full path of the ${what}`);
  if (!fs.existsSync(p)) throw new Error(`${p} does not exist`);
  return fs.readFileSync(p, 'utf8');
}

/** FraggedIn/style.md (or style.md) near the CSV / the project, walking up a few folders. */
export function findStyle(explicit, ...dirs) {
  if (explicit) return { path: explicit, text: readText(explicit, 'style file') };
  for (const start of dirs.filter(Boolean)) {
    let d = start;
    for (let i = 0; i < 4; i++) {
      for (const c of [path.join(d, 'FraggedIn', 'style.md'), path.join(d, 'style.md')]) if (fs.existsSync(c)) return { path: c, text: fs.readFileSync(c, 'utf8') };
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
  }
  return { path: null, text: '' };
}

export function createDocTools({ callRenderer, emit }) {
  const rjson = (res) => {
    const t = res?.content?.find((c) => c.type === 'text')?.text ?? '';
    if (res?.isError) throw new Error(t.replace(/^Error:\s*/, ''));
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  };
  const project = async () => rjson(await callRenderer('_project_json', {}));
  const trackLabel = (p, id) => {
    const t = p.tracks.find((x) => x.id === id);
    if (!t) return '?';
    return (t.kind === 'video' ? 'V' : 'A') + (p.tracks.filter((x) => x.kind === t.kind).indexOf(t) + 1);
  };
  const findTrack = (p, ref) => {
    const r = String(ref).trim().toLowerCase();
    return p.tracks.find((t) => t.id.toLowerCase() === r) || p.tracks.find((t) => trackLabel(p, t.id).toLowerCase() === r) || p.tracks.find((t) => (t.name ?? '').trim().toLowerCase() === r);
  };
  const seqDur = (p) => p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const media = (p, c) => p.media.find((m) => m.id === c.mediaId);
  const fmt = (t) => {
    const s = Math.floor(t + 1e-6);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  };
  const projectDir = (p) => (p.path && path.isAbsolute(p.path) ? path.dirname(p.path) : null);
  const holdCovered = (p, a, b) =>
    p.markers.some((m) => m.kind === 'hold' && m.time <= a + 0.5 && m.time + (m.duration || 0) >= b - 0.5) ||
    p.clips.some((c) => c.meta?.hold && c.start <= a + 0.5 && clipEnd(c) >= b - 0.5);

  // ---------- reading the plan files ----------

  async function withFile(name, args) {
    const extra = {};
    if (name === 'import_edl' || name === 'import_cues' || name === 'check_edl') extra._text = readText(args.path, name === 'import_cues' ? 'cue sheet' : 'EDL');
    if (name === 'import_edl' || name === 'add_text_card') {
      const p = await project();
      const st = findStyle(args.style_path, args.path && path.dirname(args.path), projectDir(p));
      extra._style = st.text;
    }
    return callRenderer(name, { ...args, ...extra });
  }

  // ---------- what is on screen ----------

  /** Picture segments: which clip is on top (full-frame, not an overlay) between each pair of edit points. */
  function pictureSegments(p, a = 0, b = seqDur(p)) {
    const vids = p.tracks.filter((t) => t.kind === 'video' && !t.hidden);
    const order = new Map(vids.map((t, i) => [t.id, i]));
    const base = p.clips.filter((c) => {
      if (!c.enabled || !order.has(c.trackId)) return false;
      // full-frame text cards are a picture of their own (a chapter card over black is not a black hold)
      if (c.kind === 'text') return ['chapter_card', 'date_card', 'quote_card', 'list_card'].includes(c.meta?.preset) && c.meta?.role === 'card';
      if (!['video', 'image', 'color'].includes(c.kind)) return false;
      if (['panel', 'card_bg', 'caption', 'short_bg'].includes(c.meta?.role)) return false;
      const tr = c.transform ?? {};
      return (tr.scale ?? 100) >= 95 && (tr.opacity ?? 100) >= 99 && Math.abs(tr.x ?? 0) < 20 && Math.abs(tr.y ?? 0) < 20;
    });
    const ts = new Set([a, b]);
    for (const c of base) {
      if (c.start > a && c.start < b) ts.add(r3(c.start));
      if (clipEnd(c) > a && clipEnd(c) < b) ts.add(r3(clipEnd(c)));
    }
    const times = [...ts].sort((x, y) => x - y);
    const segs = [];
    for (let i = 0; i < times.length - 1; i++) {
      const s = times[i];
      const e = times[i + 1];
      if (e - s < 1e-3) continue;
      const mid = (s + e) / 2;
      const top = base.filter((c) => c.start <= mid && clipEnd(c) > mid).sort((x, y) => order.get(y.trackId) - order.get(x.trackId))[0] ?? null;
      const last = segs[segs.length - 1];
      // one clip split in two with continuous source is not a cut
      const continuous =
        last && top && last.clip && (last.clip.id === top.id || (last.clip.mediaId && last.clip.mediaId === top.mediaId && Math.abs(last.clip.in + (s - last.clip.start) * last.clip.speed - (top.in + (s - top.start) * top.speed)) < 0.05));
      if (last && ((!top && !last.clip) || continuous)) last.end = e;
      else segs.push({ start: s, end: e, clip: top });
    }
    return segs;
  }

  const sceneCache = new Map();
  async function detectCuts(args, p0) {
    const p = p0 ?? (await project());
    const A = args.start ?? 0;
    const B = Math.min(args.end ?? Infinity, seqDur(p));
    const segs = pictureSegments(p, A, B);
    const cuts = segs.slice(1).map((s) => ({ at: r3(s.start), kind: 'edit', into: s.clip?.id ?? 'black' }));
    const notes = [];
    if (args.scan_sources !== false) {
      const th = (args.threshold ?? 10) / 100;
      for (const s of segs) {
        const c = s.clip;
        const m = c && c.kind === 'video' ? media(p, c) : null;
        if (!m || s.end - s.start < 1) continue;
        const srcA = c.in + (s.start - c.start) * c.speed;
        const srcB = c.in + (s.end - c.start) * c.speed;
        const key = `${m.path}|${r3(srcA)}|${r3(srcB)}|${th}`;
        try {
          if (!sceneCache.has(key)) sceneCache.set(key, await detectScenes(m.path, { threshold: th, start: srcA, end: srcB }));
          for (const t of sceneCache.get(key)) {
            const tl = c.start + (t - c.in) / c.speed;
            if (tl > s.start + 0.2 && tl < s.end - 0.2) cuts.push({ at: r3(tl), kind: 'in_footage', clip: c.id });
          }
        } catch (e) {
          notes.push(`${c.id}: scene scan failed (${String(e.message).slice(0, 120)})`);
        }
      }
    }
    cuts.sort((x, y) => x.at - y.at);
    const edges = [A, ...cuts.map((c) => c.at), B];
    const shots = [];
    for (let i = 0; i < edges.length - 1; i++) if (edges[i + 1] - edges[i] > 0.02) shots.push({ start: r3(edges[i]), end: r3(edges[i + 1]), length: r3(edges[i + 1] - edges[i]) });
    const lens = shots.map((s) => s.length).sort((x, y) => x - y);
    const holdS = args.hold_s ?? 20;
    const holds = shots
      .filter((s) => s.length > holdS)
      .map((s) => {
        const seg = segs.find((g) => g.start <= s.start + 1e-3 && g.end >= s.end - 1e-3);
        const c = seg?.clip;
        const moving = c && ['scale', 'x', 'y'].some((k) => c.keyframes?.[k]?.length > 1);
        return { ...s, clip: c?.id ?? 'black', deliberate: holdCovered(p, s.start, s.end), ...(moving ? { has_motion: true } : {}) };
      })
      .sort((x, y) => y.length - x.length);
    return {
      range: [r3(A), r3(B)],
      cuts: cuts.length,
      cut_times: cuts,
      shots: shots.length,
      average_shot_length: r3(shots.length ? (B - A) / shots.length : 0),
      median_shot_length: r3(lens.length ? lens[Math.floor(lens.length / 2)] : 0),
      longest_shots: [...shots].sort((x, y) => y.length - x.length).slice(0, 10),
      holds_over: holdS,
      holds,
      unmarked_holds: holds.filter((h) => !h.deliberate).length,
      ...(notes.length ? { notes } : {}),
    };
  }

  const freezeCache = new Map();
  async function detectFreezesTool(args, p0) {
    const p = p0 ?? (await project());
    const min = args.min_s ?? 10;
    const A = args.start ?? 0;
    const B = Math.min(args.end ?? Infinity, seqDur(p));
    const out = [];
    const notes = [];
    for (const s of pictureSegments(p, A, B)) {
      const c = s.clip;
      const len = s.end - s.start;
      if (len < min) continue;
      const deliberate = holdCovered(p, s.start, s.end);
      const overlays = p.clips.filter((o) => o.kind !== 'audio' && o.id !== c?.id && o.start < s.end && clipEnd(o) > s.start && ['video', 'image'].includes(o.kind) && o.meta?.role === 'panel').map((o) => o.id);
      if (!c) {
        out.push({ start: r3(s.start), end: r3(s.end), length: r3(len), kind: 'black', deliberate });
        continue;
      }
      if (c.kind === 'image' || c.kind === 'color') {
        const moving = ['scale', 'x', 'y'].some((k) => c.keyframes?.[k]?.length > 1);
        if (!moving) out.push({ start: r3(s.start), end: r3(s.end), length: r3(len), kind: `still ${c.kind}`, clip: c.id, deliberate, ...(overlays.length ? { overlays } : {}) });
        continue;
      }
      const m = media(p, c);
      if (!m) continue;
      const srcA = c.in + (s.start - c.start) * c.speed;
      const srcB = c.in + (s.end - c.start) * c.speed;
      const key = `${m.path}|${r3(srcA)}|${r3(srcB)}|${min * c.speed}|${args.noise_db ?? -60}`;
      try {
        if (!freezeCache.has(key)) freezeCache.set(key, await detectFreezes(m.path, { minDuration: Math.max(0.5, min * c.speed), noiseDb: args.noise_db ?? -60, start: srcA, end: srcB }));
        for (const f of freezeCache.get(key)) {
          const fa = c.start + (f.start - c.in) / c.speed;
          const fb = c.start + ((f.end ?? srcB) - c.in) / c.speed;
          const a2 = Math.max(s.start, fa);
          const b2 = Math.min(s.end, fb);
          if (b2 - a2 >= min) {
            const moving = ['scale', 'x', 'y'].some((k) => c.keyframes?.[k]?.length > 1);
            out.push({ start: r3(a2), end: r3(b2), length: r3(b2 - a2), kind: 'frozen footage', clip: c.id, deliberate: holdCovered(p, a2, b2), ...(moving ? { has_motion: true } : {}), ...(overlays.length ? { overlays } : {}) });
          }
        }
      } catch (e) {
        notes.push(`${c.id}: freeze scan failed (${String(e.message).slice(0, 120)})`);
      }
    }
    out.sort((x, y) => x.start - y.start);
    return { min_s: min, freezes: out, unintended: out.filter((f) => !f.deliberate).length, ...(notes.length ? { notes } : {}) };
  }

  // ---------- transcript ----------

  async function transcribeTrack(args, p0) {
    const p = p0 ?? (await project());
    const tr = findTrack(p, args.track);
    if (!tr) throw new Error(`Track "${args.track}" not found`);
    const model = getSettings().whisperModel;
    const clips = p.clips
      .filter((c) => c.trackId === tr.id && c.enabled && (c.kind === 'audio' || (c.kind === 'video' && media(p, c)?.hasAudio)))
      .sort((x, y) => x.start - y.start);
    if (!clips.length) throw new Error(`${trackLabel(p, tr.id)} has no clips with sound`);
    emit?.('app:toast', { message: `Transcribing ${clips.length} clip${clips.length > 1 ? 's' : ''} on ${tr.name || trackLabel(p, tr.id)}… (first run can take a while)` });
    const segs = [];
    const byFile = new Map();
    for (const c of clips) {
      const m = media(p, c);
      if (!m) continue;
      if (!byFile.has(m.path)) byFile.set(m.path, await transcribe(m.path, model, { language: args.language || 'auto' }));
      const a = c.in;
      const b = c.in + c.duration * c.speed;
      for (const s of byFile.get(m.path)) {
        if (s.end <= a || s.start >= b) continue;
        segs.push({ start: r3(c.start + (Math.max(a, s.start) - c.in) / c.speed), end: r3(c.start + (Math.min(b, s.end) - c.in) / c.speed), text: s.text, clip: c.id });
      }
    }
    segs.sort((x, y) => x.start - y.start);
    // word times are spread over each segment by length (Whisper gives segment times)
    const words = [];
    for (const s of segs) {
      const ws = s.text.split(/\s+/).filter(Boolean);
      const total = ws.reduce((t, w) => t + w.length + 1, 0) || 1;
      let t = s.start;
      for (const w of ws) {
        const d = ((s.end - s.start) * (w.length + 1)) / total;
        words.push({ t: r3(t), end: r3(t + d), w });
        t += d;
      }
    }
    const pauseS = args.pause_s ?? 0.6;
    const pauses = [];
    for (let i = 1; i < segs.length; i++) {
      const g = segs[i].start - segs[i - 1].end;
      if (g >= pauseS) pauses.push({ start: segs[i - 1].end, end: segs[i].start, length: r3(g) });
    }
    const speaking = segs.reduce((t, s) => t + (s.end - s.start), 0);
    const span = segs.length ? segs[segs.length - 1].end - segs[0].start : 0;
    const out = {
      track: trackLabel(p, tr.id),
      segments: segs,
      word_count: words.length,
      words_per_minute: span ? Math.round(words.length / (span / 60)) : 0,
      words_per_speaking_minute: speaking ? Math.round(words.length / (speaking / 60)) : 0,
      pauses_over: pauseS,
      pause_count: pauses.length,
      longest_pauses: [...pauses].sort((x, y) => y.length - x.length).slice(0, 15),
      note: 'Word times are approximate (spread over each Whisper segment).',
    };
    if (args.words) out.words = words;
    if (args.script_path) out.script = scriptDiff(words, readText(args.script_path, 'script'));
    return { out, words, segs };
  }

  function scriptWords(md) {
    const keep = [];
    for (let line of md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
      if (/^\s*#/.test(line) || /^\s*\|/.test(line) || /^\s*(```|---)/.test(line)) continue;
      const label = line.match(/^\s*[*_]*([A-Z][A-Z0-9 ./-]{1,24})[*_]*\s*:\s*(.*)$/);
      if (label) {
        if (/^(VO|V\.O\.|NARRATION|NARRATOR|NARR|HOST)$/i.test(label[1].trim())) line = label[2];
        else continue;
      }
      keep.push(line.replace(/\[[^\]]*\]|\{[^}]*\}/g, ' '));
    }
    return keep.join(' ').toLowerCase().replace(/[’']/g, "'").split(/[^a-z0-9']+/).filter(Boolean).map(spelling);
  }
  // British / American spellings count as the same word
  const spelling = (w) => w.replace(/is(e|es|ed|ing|ation|ations|er|ers)$/, 'iz$1').replace(/our$/, 'or').replace(/ours$/, 'ors');
  const normWord = (w) => spelling(w.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9']/g, ''));

  function scriptDiff(words, md) {
    const a = scriptWords(md);
    const tw = words.map((w) => ({ ...w, n: normWord(w.w) })).filter((w) => w.n);
    const b = tw.map((w) => w.n);
    const n = a.length;
    const m = b.length;
    if (!n) return { note: 'The script has no narration words (headings, tables and LABEL: lines are skipped; VO:/NARRATOR: lines are kept)' };
    if (n * m > 40e6) return { note: `Too long to compare word by word (${n} script words × ${m} spoken)`, script_words: n, spoken_words: m };
    const W = m + 1;
    const L = new Uint16Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) L[i * W + j] = a[i] === b[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    const missing = [];
    const extra = [];
    let i = 0;
    let j = 0;
    let curM = null;
    let curE = null;
    const changed = [];
    const flush = () => {
      // a few script words replaced by a few other words: said differently (or a transcription slip)
      if (curM && curE && curM.words.length <= 4 && curE.words.length <= 4) changed.push({ at: curE.at, script: curM.words.join(' '), said: curE.words.join(' ') });
      else {
        if (curM) missing.push(curM);
        if (curE) extra.push(curE);
      }
      curM = curE = null;
    };
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        flush();
        i++;
        j++;
      } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) {
        curM ??= { near: tw[Math.max(0, j - 1)]?.t ?? 0, words: [] };
        curM.words.push(a[i++]);
      } else {
        curE ??= { at: tw[j].t, words: [] };
        curE.words.push(tw[j++].w);
      }
    }
    flush();
    if (i < n) missing.push({ near: tw[m - 1]?.t ?? 0, words: a.slice(i) });
    if (j < m) extra.push({ at: tw[j].t, words: tw.slice(j).map((w) => w.w) });
    const fillers = /^(um+|uh+|erm|ah+|hmm+|like)$/i;
    const ex = extra.filter((e) => !(e.words.length === 1 && fillers.test(normWord(e.words[0]))));
    const matched = L[0];
    const fmtRun = (r) => ({ ...(r.near != null ? { near: r3(r.near) } : { at: r3(r.at) }), text: r.words.join(' ') });
    return {
      script_words: n,
      spoken_words: m,
      matched,
      match_pct: Math.round((matched / n) * 1000) / 10,
      missing_words: missing.reduce((t, r) => t + r.words.length, 0),
      extra_words: ex.reduce((t, r) => t + r.words.length, 0),
      said_differently: changed.slice(0, 40).map((c) => ({ ...c, at: r3(c.at) })),
      missing: missing.sort((x, y) => y.words.length - x.words.length).slice(0, 40).map(fmtRun),
      extra: ex.sort((x, y) => y.words.length - x.words.length).slice(0, 40).map(fmtRun),
      note: 'Numbers said as words (“twenty twenty-four”) and transcription slips show up as differences too.',
    };
  }

  // ---------- QA report ----------

  async function qaReport(args) {
    const p = await project();
    const dur = seqDur(p);
    const skip = new Set(args.skip ?? []);
    const checks = [];
    const issues = [];
    const add = (name, pass, detail) => checks.push({ check: name, pass, ...detail });
    const marker = (re, kind) => p.markers.filter((m) => m.kind === kind || re.test(m.name)).sort((x, y) => x.time - y.time)[0];
    // structure
    const hookBy = args.hook_by_s ?? 30;
    const hook = marker(/\bhook\b/i, 'hook');
    add('hook', hook ? hook.time <= hookBy : null, hook ? { at: r3(hook.time), target: `by ${hookBy} s` } : { note: 'No marker named "Hook" (or kind hook): add one where the hook lands' });
    const [c0, c1] = args.climax_range ?? [0.45, 0.7];
    const climax = marker(/\bclimax\b/i, 'climax');
    add('climax', climax ? climax.time / dur >= c0 && climax.time / dur <= c1 : null, climax ? { at: r3(climax.time), at_pct: Math.round((climax.time / dur) * 100), target: `${c0 * 100}–${c1 * 100}% of ${fmt(dur)}` } : { note: 'No marker named "Climax" (or kind climax)' });
    const chapters = p.markers.filter((m) => m.kind === 'chapter').length;
    add('chapters', chapters >= 3 || null, { count: chapters, note: chapters < 3 ? 'YouTube needs at least 3 chapters (chapter cards add them)' : undefined });
    const run = async (name, fn) => {
      if (skip.has(name)) return;
      try {
        await fn();
      } catch (e) {
        add(name, null, { error: String(e.message ?? e).slice(0, 300) });
      }
    };
    await run('loudness', async () => {
      const L = rjson(await callRenderer('analyze_loudness', { per_second: false }));
      const tl = args.target_lufs ?? -14;
      const tp = args.true_peak ?? -1;
      const norm = p.settings.loudness;
      if (norm) add('loudness', norm.lufs === tl && norm.truePeak <= tp, { mix_lufs: L.integrated_lufs, mix_true_peak: L.true_peak_dbtp, export_normalizes_to: `${norm.lufs} LUFS / ${norm.truePeak} dBTP`, target: `${tl} LUFS / ${tp} dBTP` });
      else {
        const ok = L.integrated_lufs != null && Math.abs(L.integrated_lufs - tl) <= 1 && (L.true_peak_dbtp ?? -99) <= tp;
        add('loudness', ok, { integrated_lufs: L.integrated_lufs, true_peak_dbtp: L.true_peak_dbtp, loudness_range_lu: L.loudness_range_lu, target: `${tl} LUFS / ${tp} dBTP`, ...(ok ? {} : { fix: 'normalize (export applies it) or adjust gains' }) });
      }
    });
    await run('silences', async () => {
      const S = rjson(await callRenderer('detect_silence', { threshold_db: -45, min_duration: 0.4 }));
      const raws = p.clips.filter((c) => c.meta?.role === 'raw');
      const cards = p.clips.filter((c) => c.meta?.preset === 'chapter_card');
      const bad = S.silences.filter((s) => {
        if (s.start < 0.5 || s.end > dur - 0.5) return false;
        if (cards.some((c) => c.start - 3 <= s.end && clipEnd(c) + 3 >= s.start)) return false;
        if (raws.some((c) => c.start - 2 <= s.end && clipEnd(c) + 2 >= s.start)) return false;
        if (p.markers.some((m) => m.kind === 'chapter' && Math.abs(m.time - s.start) < 4)) return false;
        return !holdCovered(p, s.start, s.end);
      });
      add('silences', bad.length === 0, { total: S.count, outside_cards_and_raw_clips: bad.length });
      // silences less than a second apart (between sound effects, say) are one issue
      const groups = [];
      for (const s of bad) {
        const g = groups[groups.length - 1];
        if (g && s.start - g.end < 1) {
          g.end = s.end;
          g.n++;
          g.total += s.length;
        } else groups.push({ start: s.start, end: s.end, n: 1, total: s.length });
      }
      for (const g of groups)
        issues.push({
          at: g.start,
          type: 'silence',
          detail: g.n === 1 ? `${r3(g.total)} s of silence (${fmt(g.start)}–${fmt(g.end)}) not under a chapter card or raw clip` : `${g.n} gaps of silence (${r3(g.total)} s in all) between ${fmt(g.start)} and ${fmt(g.end)}, not under a chapter card or raw clip`,
        });
    });
    await run('cuts', async () => {
      const C = await detectCuts({ hold_s: args.max_hold_s ?? 20 }, p);
      add('holds', C.unmarked_holds === 0, { average_shot_length: C.average_shot_length, median_shot_length: C.median_shot_length, shots: C.shots, unmarked_holds_over: `${C.holds_over} s: ${C.unmarked_holds}` });
      for (const h of C.holds.filter((x) => !x.deliberate)) issues.push({ at: h.start, type: 'hold', detail: `${h.length} s without a cut (${fmt(h.start)}–${fmt(h.end)}, ${h.clip})${h.has_motion ? ', has a camera move' : ''}: cut it or mark it with a hold marker` });
    });
    await run('freezes', async () => {
      const F = await detectFreezesTool({ min_s: 10 }, p);
      add('freezes', F.unintended === 0, { found: F.freezes.length, unintended: F.unintended });
      for (const f of F.freezes.filter((x) => !x.deliberate)) issues.push({ at: f.start, type: 'freeze', detail: `${f.kind} for ${f.length} s (${fmt(f.start)}–${fmt(f.end)})${f.clip ? `, ${f.clip}` : ''}${f.overlays ? ' (a panel is over it)' : ''}` });
    });
    await run('transcript', async () => {
      const narr = findTrack(p, 'narration');
      if (!narr || !p.clips.some((c) => c.trackId === narr.id)) return add('transcript', null, { note: 'No Narration track with clips' });
      if (!getSettings().whisperModel) return add('transcript', null, { note: 'No Whisper model set (Settings → Transcription)' });
      const { out } = await transcribeTrack({ track: narr.id, script_path: args.script_path }, p);
      const wpm = out.words_per_minute;
      add('pace', wpm >= 130 && wpm <= 180, { words_per_minute: wpm, words_per_speaking_minute: out.words_per_speaking_minute, longest_pauses: out.longest_pauses.slice(0, 5), target: '130–180 wpm' });
      if (out.script?.match_pct != null) {
        add('script', out.script.match_pct >= 97, { match_pct: out.script.match_pct, missing_words: out.script.missing_words, extra_words: out.script.extra_words });
        for (const r of out.script.missing.filter((x) => x.text.split(' ').length >= 3).slice(0, 15)) issues.push({ at: r.near, type: 'script', detail: `Not in the narration: “${r.text}”` });
      }
    });
    if (args.edl_path)
      await run('edl', async () => {
        const E = rjson(await callRenderer('check_edl', { path: args.edl_path, _text: readText(args.edl_path, 'EDL') }));
        const bad = E.missing.length + E.moved.length + E.wrong_length.length + E.slipped.length;
        add('edl', bad === 0, { rows: E.rows_checked, matching: E.matching, missing: E.missing.length, moved: E.moved.length, wrong_length: E.wrong_length.length, slipped: E.slipped.length });
      });
    issues.sort((x, y) => x.at - y.at);
    // at most 25 issues of a kind, so one noisy check does not bury the rest
    const perType = new Map();
    const kept = issues.filter((x) => {
      const n = (perType.get(x.type) ?? 0) + 1;
      perType.set(x.type, n);
      return n <= 25;
    });
    const dropped = [...perType].filter(([, n]) => n > 25).map(([t, n]) => `${n - 25} more ${t} issues not listed`);
    issues.length = 0;
    issues.push(...kept);
    const passed = checks.filter((c) => c.pass === true).length;
    const failed = checks.filter((c) => c.pass === false).length;
    return {
      runtime: fmt(dur),
      summary: `${passed} passed, ${failed} failed, ${checks.length - passed - failed} not checked`,
      checks,
      issues: issues.map((x) => ({ ...x, at: r3(x.at), timecode: fmt(x.at) })),
      ...(dropped.length ? { not_listed: dropped } : {}),
    };
  }

  // ---------- chapters, credits ----------

  async function exportChapters(args) {
    const p = await project();
    const ms = p.markers.filter((m) => m.kind === 'chapter').sort((x, y) => x.time - y.time);
    const warnings = [];
    const list = ms.map((m) => ({ t: m.time, title: m.name }));
    if (!list.length || list[0].t >= 1) {
      list.unshift({ t: 0, title: args.intro_title ?? 'Intro' });
      warnings.push(`No chapter at 0:00: added "${args.intro_title ?? 'Intro'}"`);
    } else list[0].t = 0;
    if (list.length < 3) warnings.push('YouTube shows chapters only with at least 3 of them');
    const dur = seqDur(p);
    list.forEach((c, i) => {
      const next = list[i + 1]?.t ?? dur;
      if (next - c.t < 10) warnings.push(`"${c.title}" is ${r3(next - c.t)} s long; YouTube needs at least 10 s per chapter`);
    });
    const txt = list.map((c) => `${fmt(c.t)} ${c.title}`).join('\n');
    if (args.path) fs.writeFileSync(args.path, txt + '\n');
    return { chapters: txt, count: list.length, ...(warnings.length ? { warnings } : {}), ...(args.path ? { saved: args.path } : {}) };
  }

  async function exportCredits(args) {
    const p = await project();
    const music = new Set(p.tracks.filter((t) => t.kind === 'audio' && /^music/i.test(t.name ?? '')).map((t) => t.id));
    const groups = new Map();
    const addTo = (section, key, t) => {
      const k = `${section}|${key}`;
      const g = groups.get(k) ?? { section, credit: key, times: [] };
      if (!g.times.some((x) => Math.abs(x - t) < 1)) g.times.push(t);
      groups.set(k, g);
    };
    for (const c of [...p.clips].sort((x, y) => x.start - y.start)) {
      const isMusic = c.meta?.role === 'music' || music.has(c.trackId);
      if (c.meta?.credit) addTo(isMusic ? 'Music' : 'Sources', c.meta.credit, c.start);
      else if (isMusic && c.kind === 'audio') {
        const m = media(p, c);
        if (m) addTo('Music', m.name.replace(/\.[a-z0-9]+$/i, ''), c.start);
      }
    }
    const withTimes = args.with_times !== false;
    const sections = ['Sources', 'Music'];
    const lines = [];
    for (const s of sections) {
      const gs = [...groups.values()].filter((g) => g.section === s).sort((x, y) => x.times[0] - y.times[0]);
      if (!gs.length) continue;
      lines.push(`${s}:`);
      for (const g of gs) lines.push(`${g.credit}${withTimes ? ` (${g.times.slice(0, 6).map(fmt).join(', ')}${g.times.length > 6 ? ', …' : ''})` : ''}`);
      lines.push('');
    }
    const txt = lines.join('\n').trim();
    if (args.path) fs.writeFileSync(args.path, txt + '\n');
    const uncredited = p.clips.filter((c) => ['video', 'image'].includes(c.kind) && !c.meta?.credit && !['card_bg', 'short_bg'].includes(c.meta?.role)).length;
    return { credits: txt || '(no credits: give clips a credit in the EDL credit column or add_clip credit)', ...(uncredited ? { picture_clips_without_credit: uncredited } : {}), ...(args.path ? { saved: args.path } : {}) };
  }

  // ---------- Short ----------

  async function makeShort(args) {
    const p = await project();
    if (!(args.end > args.start)) throw new Error('end must be after start');
    let captions = [];
    const mode = args.captions ?? 'word';
    const notes = [];
    if (mode !== 'none') {
      try {
        const { words, segs } = await transcribeTrack({ track: args.caption_track ?? 'narration' }, p);
        if (mode === 'line') captions = segs.filter((s) => s.end > args.start && s.start < args.end).map((s) => ({ start: s.start, end: s.end, text: s.text }));
        else {
          const ws = words.filter((w) => w.end > args.start && w.t < args.end);
          captions = ws.map((w, i) => ({ start: w.t, end: Math.min(w.end + 0.15, ws[i + 1]?.t ?? w.end + 0.15), text: w.w.replace(/[.,!?;:]+$/, '') }));
        }
      } catch (e) {
        notes.push(`No captions: ${e.message}`);
      }
    }
    const dir = projectDir(p) ?? path.join(userDataDir(), 'shorts');
    const stamp = `${Math.floor(args.start / 60)}m${String(Math.floor(args.start % 60)).padStart(2, '0')}s`;
    const out = args.path ?? path.join(dir, `${(p.name || 'Project').replace(/[\\/:*?"<>|]/g, '')} - Short ${stamp}.icut`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const st = findStyle(undefined, projectDir(p));
    const r = rjson(await callRenderer('_build_short', { start: args.start, end: args.end, layout: args.layout, title: args.title, captions, path: out, _style: st.text }));
    return { ...r, layout: args.layout ?? 'panel_top', captions: mode === 'none' ? 'none' : `${captions.length} (${mode})`, next: 'Open the file in IngrainedCut to review it, then export_video with preset short_9x16.', ...(notes.length ? { notes } : {}) };
  }

  // ---------- snapshots ----------

  const snapDir = (p) => path.join(userDataDir(), 'snapshots', crypto.createHash('sha1').update(String(p.path || p.name || 'untitled').toLowerCase()).digest('hex').slice(0, 12));
  async function snapshot(args) {
    const p = await project();
    const dir = snapDir(p);
    fs.mkdirSync(dir, { recursive: true });
    const id = `s${Date.now().toString(36)}`;
    const rec = { id, label: args.label || new Date().toLocaleString(), time: Date.now(), clips: p.clips.length, duration: r3(seqDur(p)), project: p };
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(rec));
    const all = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    for (const f of all.slice(0, Math.max(0, all.length - 50))) fs.rmSync(path.join(dir, f), { force: true });
    return { snapshot: id, label: rec.label, clips: rec.clips, duration: rec.duration };
  }
  async function restore(args) {
    const p = await project();
    const dir = snapDir(p);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse() : [];
    if (!args.id) {
      return {
        snapshots: files.map((f) => {
          const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          return { id: r.id, label: r.label, time: new Date(r.time).toLocaleString(), clips: r.clips, duration: r.duration };
        }),
      };
    }
    const f = path.join(dir, `${args.id}.json`);
    if (!fs.existsSync(f)) throw new Error(`No snapshot ${args.id} for this project (restore without id lists them)`);
    const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (args.dry_run) return { dry_run: true, would_restore: rec.label, clips_now: p.clips.length, clips_after: rec.clips, duration_after: rec.duration };
    return rjson(await callRenderer('_restore_project', { project: rec.project, label: rec.label }));
  }

  /** Engine-side documentary tools; null when `name` is not one of them. */
  async function run(name, args) {
    switch (name) {
      case 'import_edl':
      case 'import_cues':
      case 'check_edl':
      case 'add_text_card':
        return withFile(name, args);
      case 'detect_cuts':
        return text(await detectCuts(args));
      case 'detect_freezes':
        return text(await detectFreezesTool(args));
      case 'qa_report':
        return text(await qaReport(args));
      case 'export_chapters':
        return text(await exportChapters(args));
      case 'export_credits':
        return text(await exportCredits(args));
      case 'make_short':
        return text(await makeShort(args));
      case 'snapshot':
        return text(await snapshot(args));
      case 'restore':
        return text(await restore(args));
    }
    return null;
  }
  return { run, transcribeTrack: async (args) => (await transcribeTrack(args)).out, findStyle, project };
}
