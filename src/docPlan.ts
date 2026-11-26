// Reading the documentary plan files: CSV, times, the EDL (04_edl.csv) and cue sheet (05_cues.csv) columns of the
// fraggedin-documentary-editor skill (its Reference H), motion / transition / card wording, and the channel style.
// Pure functions with no editor imports, so they run in the editor and under `node --test` alike.
import type { TransitionType } from './types';

// ---------------- CSV, times ----------------

export type Row = Record<string, string> & { _line: string };

export function parseCsv(text: string): Row[] {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? '\t' : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: { line: number; cells: string[] }[] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === '') {
      q = true;
      cell = '';
    } else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push({ line: rowLine, cells: row });
      row = [];
      cell = '';
      line++;
      rowLine = line;
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push({ line: rowLine, cells: row });
  }
  const useful = rows.filter((r) => r.cells.some((c) => c.trim()) && !r.cells[0].trim().startsWith('#'));
  if (!useful.length) return [];
  const header = useful[0].cells.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return useful.slice(1).map((r) => {
    const o = { _line: String(r.line) } as Row;
    header.forEach((h, i) => (o[h] = (r.cells[i] ?? '').trim()));
    return o;
  });
}

/** seconds from "12.5", "1:02.5" (m:ss), "1:02:03.5" (h:mm:ss) or "01:02:03:12" (h:mm:ss:ff) */
export function parseTime(v: string | number | undefined | null, fps: number): number | undefined {
  if (v == null) return undefined;
  if (typeof v === 'number') return v;
  const s = v.trim().replace(/;/g, ':');
  if (!s) return undefined;
  if (/^-?\d+(\.\d+)?\s*s?$/i.test(s)) return parseFloat(s);
  const parts = s.split(':');
  if (parts.length >= 2 && parts.length <= 4 && parts.every((x) => /^\d+(\.\d+)?$/.test(x))) {
    const n = parts.map(Number);
    if (n.length === 4) return n[0] * 3600 + n[1] * 60 + n[2] + n[3] / fps;
    if (n.length === 3) return n[0] * 3600 + n[1] * 60 + n[2];
    return n[0] * 60 + n[1];
  }
  throw new Error(`"${v}" is not a time (use seconds, m:ss, h:mm:ss or h:mm:ss:ff)`);
}

export const pick = (r: Row, ...keys: string[]) => {
  for (const k of keys) if (r[k] != null && r[k] !== '') return r[k];
  return '';
};
export const truthy = (v: string) => /^(y|yes|true|1|x|✓|hold|deliberate)$/i.test(v.trim());
export const num = (v: string) => {
  const m = v.replace(',', '.').match(/^\s*([+-]?\d+(\.\d+)?)/);
  return m ? parseFloat(m[1]) : undefined;
};

// ---------------- paths ----------------

export const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|heic)$/i;
export const AUDIO_EXT = /\.(wav|mp3|m4a|aac|flac|ogg|opus)$/i;
export const MEDIA_EXT = /\.(mp4|mov|mkv|webm|m4v|avi|mts|m2ts|ts|wav|mp3|m4a|aac|flac|ogg|opus|png|jpe?g|webp|gif|bmp|tiff?|avif)$/i;
export const isAbs = (p: string) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\');
export const isUrl = (s: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(s.trim()) && !/^file:/i.test(s.trim());

export function joinPath(base: string, rel: string) {
  if (!rel || isAbs(rel)) return rel;
  const win = base.includes('\\') || /^[a-zA-Z]:/.test(base);
  const parts = (base.replace(/[\\/]+$/, '') + '/' + rel).split(/[\\/]+/);
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  return out.join(win ? '\\' : '/');
}
export const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '');

/** A media file named in free text ("music/ost.wav", "ost.mp3 (OST, policy checked)"), else undefined. */
export function fileIn(s: string): string | undefined {
  const t = s.trim();
  if (!t) return undefined;
  if (MEDIA_EXT.test(t) && !/[,;()]/.test(t)) return t;
  const m = t.match(/(?:[a-zA-Z]:[\\/])?[^\s,;()"']*\.(mp4|mov|mkv|webm|m4v|wav|mp3|m4a|aac|flac|ogg|opus|png|jpe?g|webp)\b/i);
  return m?.[0];
}

const stem = (p: string) => p.split(/[\\/]/).pop()!.replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The file in `files` whose name matches a cue's track title ("Long Night" → music/long_night.wav). */
export function matchTitle(title: string, files: string[]): string | undefined {
  const t = title.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!t || t.length < 2) return undefined;
  const cands = files.filter((f) => MEDIA_EXT.test(f));
  return cands.find((f) => stem(f) === t) ?? cands.find((f) => stem(f).includes(t) && t.length >= 4) ?? cands.find((f) => t.includes(stem(f)) && stem(f).length >= 4);
}

// ---------------- motion ----------------

export type Motion = 'push_in' | 'pull_out' | 'pan' | 'slow_scroll' | 'none';

/** "push_in_3pct", "push in 3%", "pan left", "slow_scroll", "none" */
export function parseMotion(s: string): { type: Motion; amount?: number; direction?: string } | null {
  const t = s.trim().toLowerCase();
  if (!t || t === 'none' || t === 'static' || t === '-') return null;
  const flat = t.replace(/[\s-]+/g, '_');
  const type = (['push_in', 'pull_out', 'pan', 'slow_scroll'] as Motion[]).find((m) => flat.startsWith(m) || t.replace(/[\s_-]+/g, '').startsWith(m.replace('_', '')));
  const alias: Record<string, Motion> = { zoom_in: 'push_in', push: 'push_in', zoom: 'push_in', zoom_out: 'pull_out', pull: 'pull_out', scroll: 'slow_scroll', ken_burns: 'push_in' };
  const ty = type ?? alias[Object.keys(alias).find((k) => flat.startsWith(k)) ?? ''];
  if (!ty) throw new Error(`motion "${s}" not understood (none, push_in_3pct, slow_scroll, pan [left|right|up|down])`);
  const amount = t.match(/(\d+(\.\d+)?)\s*(%|pct|percent)?/)?.[1];
  const direction = t.match(/(?:^|[\s_-])(left|right|up|down)\b/)?.[1];
  return { type: ty, amount: amount ? parseFloat(amount) : undefined, direction };
}

// ---------------- transitions ----------------

const TRANS_ALIAS: Record<string, TransitionType | 'cut'> = {
  cut: 'cut', none: 'cut', hard_cut: 'cut', dissolve: 'cross-dissolve', cross_dissolve: 'cross-dissolve', crossfade: 'cross-dissolve', xfade: 'cross-dissolve', mix: 'cross-dissolve',
  dip_to_black: 'dip-to-black', fade_black: 'dip-to-black', fadeblack: 'dip-to-black', dip: 'dip-to-black', fade_to_black: 'dip-to-black', dip_to_white: 'dip-to-white',
  wipe_left: 'wipe-left', wipe_right: 'wipe-right', slide_left: 'slide-left', slide_right: 'slide-right', push_left: 'push-left', zoom_in: 'zoom-in', blur_dissolve: 'blur-dissolve',
};
export function transitionType(s: string): TransitionType | 'cut' {
  const k = s.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/^_+|_+$/g, '');
  const t = TRANS_ALIAS[k];
  if (!t) throw new Error(`transition "${s}" not understood (cut, dissolve, dip_to_black, dip_to_white, wipe_left…)`);
  return t;
}

export type EdlTransition = { type: TransitionType | 'cut'; duration?: number } | { type: 'j_cut' | 'l_cut'; frames?: number };

/** "cut", "dissolve_0.5s", "dip_to_black 1", "j_cut", "l_cut 8f" */
export function parseTransition(s: string): EdlTransition | null {
  const t = s.trim();
  if (!t) return null;
  const jl = t.toLowerCase().replace(/[\s-]+/g, '_').match(/^(j|l)_?cut(?:_?(\d+)\s*(f|fr|frames)?)?$/);
  if (jl) return { type: jl[1] === 'j' ? 'j_cut' : 'l_cut', frames: jl[2] ? parseInt(jl[2], 10) : undefined };
  const m = t.match(/^([a-z_\- ]+?)[\s_:@-]*(\d+(\.\d+)?)?\s*s?$/i);
  if (!m) throw new Error(`transition "${s}" not understood (cut, dissolve_0.5s, dip_to_black_0.5s, j_cut, l_cut)`);
  return { type: transitionType(m[1]), duration: m[2] ? parseFloat(m[2]) : undefined };
}

// ---------------- text cards ----------------

export const CARD_PRESETS = ['chapter_card', 'date_card', 'quote_card', 'name_super', 'list_card'] as const;
export type CardPreset = (typeof CARD_PRESETS)[number];
export const CARD_KINDS: Record<string, CardPreset> = { chapter: 'chapter_card', date: 'date_card', quote: 'quote_card', name: 'name_super', list: 'list_card' };

export function cardOf(type: string): CardPreset | null {
  const t = type.toLowerCase().trim().replace(/[\s-]+/g, '_');
  if ((CARD_PRESETS as readonly string[]).includes(t)) return t as CardPreset;
  if (CARD_KINDS[t]) return CARD_KINDS[t];
  if (['title', 'title_card', 'chapter', 'chapter_title'].includes(t)) return 'chapter_card';
  if (['date', 'date_title', 'date_card'].includes(t)) return 'date_card';
  if (['quote', 'quote_card'].includes(t)) return 'quote_card';
  if (['lower_third', 'name', 'super', 'lowerthird', 'name_card'].includes(t)) return 'name_super';
  if (['list', 'bullets'].includes(t)) return 'list_card';
  return null;
}

/** "main | subtitle", optionally prefixed "preset: " */
export function cardText(s: string): { preset?: CardPreset; main: string; sub?: string } {
  let t = s.trim();
  let preset: CardPreset | undefined;
  const m = t.match(/^([a-z_ ]+):\s*(.+)$/i);
  if (m && cardOf(m[1])) {
    preset = cardOf(m[1])!;
    t = m[2];
  }
  const [main, ...rest] = t.split(/\s*\|\s*/);
  return { preset, main: main.replace(/\\n/g, '\n'), sub: rest.join(' | ') || undefined };
}

const MONTHS = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;

/** What kind of card a "card" row is, from its wording (a chapter card when nothing else fits). */
export function inferCard(text: string): CardPreset {
  const t = text.trim();
  if (/^[“"'‘]/.test(t)) return 'quote_card';
  if (/[;\n]/.test(t.split('|')[0])) return 'list_card';
  const main = t.split('|')[0].trim();
  const words = main.split(/\s+/).length;
  if (words <= 6 && (/^\d{4}$/.test(main) || /\b(19|20)\d{2}\b/.test(main) && (MONTHS.test(main) || words <= 3) || (MONTHS.test(main) && /\d/.test(main)))) return 'date_card';
  return 'chapter_card';
}

// ---------------- the channel style ----------------

export interface DocStyle {
  font: string;
  color: string;
  accent: string;
  bold: boolean;
  italic: boolean;
  blur: number;
  darken: number;
  source: string;
}

/** The style when there is no style file: the add_text defaults (white bold sans), a red accent. */
export const DEFAULT_STYLE: DocStyle = { font: 'Inter, Segoe UI, Arial, sans-serif', color: '#ffffff', accent: '#e63946', bold: true, italic: false, blur: 18, darken: 45, source: 'defaults' };

/** The card style from a style file: JSON ({font, color, accent, blur, darken…}) or Markdown ("font: …", "accent: #…", "text colour: …", "card blur", "card darken"). */
export function parseStyle(src?: string): DocStyle {
  const st: DocStyle = { ...DEFAULT_STYLE };
  if (!src || !src.trim()) return st;
  const trimmed = src.trim().replace(/^﻿/, '');
  if (trimmed.startsWith('{')) {
    let j: any;
    try {
      j = JSON.parse(trimmed);
    } catch (e: any) {
      throw new Error(`The style file is not valid JSON: ${e.message}`);
    }
    const flat: Record<string, any> = {};
    const walk = (o: any, pre = '') => {
      for (const [k, v] of Object.entries(o ?? {})) {
        const key = (pre + k).toLowerCase().replace(/[^a-z]+/g, '_');
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key + '_');
        else flat[key] = v;
      }
    };
    walk(j);
    const get = (...ks: string[]) => ks.map((k) => flat[k]).find((v) => v != null && v !== '');
    const font = get('font', 'font_family', 'typeface', 'text_font', 'card_font', 'fonts_heading', 'heading_font');
    if (font) st.font = String(font);
    const color = get('color', 'colour', 'text_color', 'text_colour', 'colors_text', 'colours_text', 'primary');
    if (color) st.color = String(color);
    const accent = get('accent', 'accent_color', 'accent_colour', 'colors_accent', 'colours_accent', 'highlight');
    if (accent) st.accent = String(accent);
    const bold = get('bold', 'text_bold');
    if (bold != null) st.bold = !!bold;
    const italic = get('italic');
    if (italic != null) st.italic = !!italic;
    const blur = get('blur', 'card_blur', 'background_blur', 'cards_blur');
    if (blur != null && Number.isFinite(+blur)) st.blur = +blur;
    const dark = get('darken', 'card_darken', 'background_darken', 'cards_darken', 'dim');
    if (dark != null && Number.isFinite(+dark)) st.darken = +dark;
    st.source = 'style.json';
    return st;
  }
  const md = src;
  st.source = 'style.md';
  const get = (re: RegExp) => {
    for (const line of md.split(/\r?\n/)) {
      const m = line.replace(/[*_`>|]/g, ' ').match(/^\s*[-•]?\s*([A-Za-z][A-Za-z /()-]{1,40}?)\s*[:=–—]\s*(.+?)\s*$/);
      if (m && re.test(m[1].trim())) return m[2].trim();
    }
    return undefined;
  };
  const hex = (v?: string) => v?.match(/#[0-9a-f]{3,8}\b/i)?.[0];
  const font = get(/^(font|font family|typeface|heading font|title font|display font|fonts?)$/i);
  if (font) {
    st.font = font.split(/[,(;]/)[0].replace(/["']/g, '').replace(/\b(black|bold|heavy|extra ?bold|semi ?bold|italic|regular|medium|light)\b/gi, '').trim() || st.font;
    st.italic = /italic/i.test(font);
    st.bold = !/\b(regular|light|thin)\b/i.test(font);
  }
  st.accent = hex(get(/^(accent|accent colou?r|highlight|highlight colou?r|brand colou?r|colou?r accent)$/i)) ?? st.accent;
  st.color = hex(get(/^(text|text colou?r|primary|primary colou?r|main colou?r|white)$/i)) ?? st.color;
  const blur = get(/^(card blur|background blur|blur)$/i);
  if (blur && num(blur) != null) st.blur = num(blur)!;
  const dark = get(/^(card darken|background darken|darken|dim)$/i);
  if (dark && num(dark) != null) st.darken = num(dark)!;
  return st;
}

// ---------------- EDL rows (Reference H) ----------------

export interface EdlRow {
  line: string;
  id: string;
  tin?: number;
  tout?: number;
  section: string;
  narration: string;
  type: string;
  source: string;
  sin?: number;
  sout?: number;
  text: string;
  motion: string;
  transition: string;
  audioDb: string;
  music: string;
  sfx: string;
  credit: string;
  hold: boolean;
  notes: string;
}

export function edlRows(rows: Row[], fps: number): EdlRow[] {
  return rows.map((r, i) => ({
    line: r._line,
    id: pick(r, 'id', 'shot', 'row', 'shot_id', 'n', 'no') || `row${i + 1}`,
    tin: parseTime(pick(r, 'timeline_in', 'tl_in', 'record_in', 'rec_in', 'in', 'start', 'timeline_start'), fps),
    tout: parseTime(pick(r, 'timeline_out', 'tl_out', 'record_out', 'rec_out', 'out', 'end', 'timeline_end'), fps),
    section: pick(r, 'section', 'chapter', 'act', 'beat'),
    narration: pick(r, 'narration_line', 'narration', 'vo', 'line'),
    type: pick(r, 'visual_type', 'type', 'visual', 'kind').toLowerCase().replace(/[\s-]+/g, '_'),
    source: pick(r, 'source_file_or_url', 'source_file', 'source', 'src', 'file', 'media', 'path', 'asset', 'url', 'clip'),
    sin: parseTime(pick(r, 'source_in', 'src_in', 'clip_in', 'source_start'), fps),
    sout: parseTime(pick(r, 'source_out', 'src_out', 'clip_out', 'source_end'), fps),
    text: pick(r, 'on_screen_text', 'text', 'ost', 'caption', 'super', 'title'),
    motion: pick(r, 'motion', 'move', 'camera'),
    transition: pick(r, 'transition_in', 'transition', 'trans_in', 'trans'),
    audioDb: pick(r, 'clip_audio_db', 'clip_audio', 'audio_db', 'clip_db'),
    music: pick(r, 'music_cue', 'music'),
    sfx: pick(r, 'sfx', 'sound', 'sound_fx'),
    credit: pick(r, 'credit', 'credits', 'attribution', 'source_credit'),
    hold: truthy(pick(r, 'deliberate_hold', 'hold', 'deliberate')),
    notes: pick(r, 'notes', 'note', 'comment'),
  }));
}

/** Reference H visual_type → how the row is built. */
export const VISUAL = {
  video: new Set(['original_clip', 'interview', 'recreation', 'era_broll', 'gameplay', 'footage', 'video', 'clip', 'broll', 'b_roll', 'archive', 'stock', 'raw', 'raw_clip', 'reaction', 'stream', 'vod', 'main_clip']),
  image: new Set(['photo', 'illustration', 'image', 'still', 'art', 'artwork', 'thumbnail', 'map', 'graphic']),
  panel: new Set(['artifact', 'panel', 'screenshot', 'document', 'doc', 'tweet', 'post', 'article', 'headline', 'chat', 'web', 'webpage', 'reddit']),
  black: new Set(['black', 'none', 'gap', 'silence', 'empty']),
  raw: new Set(['original_clip', 'raw', 'raw_clip', 'reaction', 'main_clip', 'interview']),
};

// ---------------- cue rows (Reference H) ----------------

export interface CueRow {
  line: string;
  id: string;
  type: string;
  tin?: number;
  tout?: number;
  title: string;
  /** a file named in track_title / source_and_licence / source */
  file?: string;
  sin?: number;
  /** level_vs_narration_db */
  level?: number;
  /** an absolute gain_db (older sheets) */
  gain?: number;
  entry: string;
  exit: string;
  fadeIn?: number;
  fadeOut?: number;
  duck: boolean;
  duckDepth?: number;
  loop: boolean;
  snap: string;
  credit: string;
  fn: string;
  notes: string;
}

/** fade_0.5s → 0.5 */
export const fadeOf = (s: string) => {
  const m = s.toLowerCase().match(/^fade(?:_in|_out)?[\s_]*(\d+(\.\d+)?)?\s*s?$/);
  return m ? (m[1] ? parseFloat(m[1]) : 1) : undefined;
};

export function cueRows(rows: Row[], fps: number): CueRow[] {
  return rows.map((r, i) => {
    const title = pick(r, 'track_title', 'title', 'track_name', 'name');
    const lic = pick(r, 'source_and_licence', 'source_and_license', 'licence', 'license');
    const src = pick(r, 'source', 'src', 'file', 'media', 'path', 'track');
    const entry = pick(r, 'entry', 'in_style').toLowerCase().replace(/[\s-]+/g, '_');
    const exit = pick(r, 'exit', 'out_style').toLowerCase().replace(/[\s-]+/g, '_');
    return {
      line: r._line,
      id: pick(r, 'cue_id', 'id', 'cue', 'n') || `cue${i + 1}`,
      type: pick(r, 'type', 'kind', 'cue_type', 'layer').toLowerCase().replace(/[\s-]+/g, '_'),
      tin: parseTime(pick(r, 'timeline_in', 'tl_in', 'in', 'start', 'timeline_start'), fps),
      tout: parseTime(pick(r, 'timeline_out', 'tl_out', 'out', 'end', 'timeline_end'), fps),
      title,
      file: fileIn(src) ?? fileIn(title) ?? fileIn(lic) ?? (src && !/\s/.test(src) ? src : undefined),
      sin: parseTime(pick(r, 'source_in', 'src_in', 'offset', 'source_start'), fps),
      level: num(pick(r, 'level_vs_narration_db', 'level_vs_narration', 'vs_narration_db', 'level_vs_vo_db')),
      gain: num(pick(r, 'gain_db', 'level_db', 'db', 'volume_db', 'gain')),
      entry,
      exit,
      fadeIn: num(pick(r, 'fade_in', 'fade_in_s', 'fadein')) ?? fadeOf(entry),
      fadeOut: num(pick(r, 'fade_out', 'fade_out_s', 'fadeout')) ?? fadeOf(exit),
      duck: truthy(pick(r, 'duck', 'ducked', 'duck_under_vo')),
      duckDepth: num(pick(r, 'duck_depth_db', 'duck_db', 'duck_depth')),
      loop: truthy(pick(r, 'loop', 'looped')),
      snap: (pick(r, 'snap', 'snap_to', 'start_on') || (entry === 'hard_on_downbeat' ? 'downbeat' : '')).toLowerCase(),
      credit: pick(r, 'credit', 'credits', 'attribution') || lic,
      fn: pick(r, 'function', 'purpose', 'role'),
      notes: pick(r, 'notes', 'note', 'comment'),
    };
  });
}
