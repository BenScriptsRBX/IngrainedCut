// Colour actions shared by the Color Grading panel, the right-click menus and the AI tools.
import type { Clip, ColorGrade } from './types';
import { S, commit, toast, beginGesture, gesture, endGesture } from './store';
import { ensureLook, parseCube } from './grade';
import { engine } from './engine';
import { clipEnd } from './ops';

const visual = (c: Clip) => c.kind !== 'audio';

/** Copied grade (with the white balance that lives in fx) for Paste Grade. */
let gradeClip: { grade: ColorGrade; temperature: number; tint: number; lutName?: string } | null = null;
export const hasCopiedGrade = () => !!gradeClip;

export function copyGrade(id: string) {
  const c = S().project.clips.find((x) => x.id === id);
  if (!c || !visual(c)) return;
  gradeClip = { grade: structuredClone(c.grade ?? {}), temperature: c.fx.temperature, tint: c.fx.tint };
  toast(`Copied the grade from ${c.name}`, 'success', 1800);
}

export function pasteGrade(ids: string[]) {
  if (!gradeClip) return;
  const g = gradeClip;
  const targets = S().project.clips.filter((c) => ids.includes(c.id) && visual(c));
  if (!targets.length) return toast('Select video, image, text or adjustment clips to paste a grade onto', 'info');
  commit(`Paste Grade (${targets.length})`, (d) => {
    for (const c of d.clips) {
      if (!targets.some((t) => t.id === c.id)) continue;
      c.grade = structuredClone(g.grade);
      c.fx = { ...c.fx, temperature: g.temperature, tint: g.tint };
    }
  });
}

export function resetGrade(ids: string[]) {
  commit('Reset Grade', (d) => {
    for (const c of d.clips) {
      if (!ids.includes(c.id)) continue;
      delete c.grade;
      c.fx = { ...c.fx, temperature: 0, tint: 0 };
    }
  });
}

/** Apply a built-in look (or an imported LUT id) to clips. */
export function applyLook(ids: string[], lutId: string | null, intensity = 100) {
  commit(lutId ? 'Apply Look' : 'Remove Look', (d) => {
    if (lutId?.startsWith('look-')) ensureLook(d, lutId);
    for (const c of d.clips) {
      if (!ids.includes(c.id) || !visual(c)) continue;
      const g = { ...(c.grade ?? {}) };
      if (lutId) g.lut = { id: lutId, intensity };
      else delete g.lut;
      c.grade = g;
    }
  });
}

/** Read a .cube file into the project and apply it to clips. */
export async function importLut(file: File, ids: string[]) {
  try {
    const lut = parseCube(await file.text(), file.name.replace(/\.cube$/i, ''));
    const id = 'lut-' + Math.random().toString(36).slice(2, 9);
    commit('Import LUT', (d) => {
      d.luts = { ...(d.luts ?? {}), [id]: lut };
      for (const c of d.clips) if (ids.includes(c.id) && visual(c)) c.grade = { ...(c.grade ?? {}), lut: { id, intensity: 100 } };
    });
    toast(`Loaded LUT ${lut.name} (${lut.size}³)`, 'success');
    return id;
  } catch (e: any) {
    toast(e.message, 'error', 7000);
    return null;
  }
}

const frames = (n: number) => new Promise<void>((r) => {
  const step = (k: number) => (k <= 0 ? r() : requestAnimationFrame(() => step(k - 1)));
  step(n);
});

/**
 * Auto: neutralise the clip's basic correction, look at the frame under the playhead, then set exposure, whites,
 * blacks and white balance so the frame spans the full range and greys come out grey. One undo step.
 */
export async function autoColor(id: string) {
  const s = S();
  const c = s.project.clips.find((x) => x.id === id);
  if (!c || !visual(c)) return;
  if (s.playhead < c.start || s.playhead > clipEnd(c)) engine.seek(c.start + Math.min(c.duration / 2, 1));
  const canvas = engine.comp?.canvas;
  if (!canvas) return;
  beginGesture();
  gesture((d) => {
    const x = d.clips.find((k) => k.id === id)!;
    x.grade = { ...(x.grade ?? {}), exposure: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 };
    x.fx = { ...x.fx, temperature: 0, tint: 0 };
  });
  await frames(3);
  const w = 160;
  const h = Math.max(1, Math.round((w * canvas.height) / canvas.width));
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const g = tmp.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(canvas, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const lums: number[] = [];
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255, gg = px[i + 1] / 255, b = px[i + 2] / 255;
    const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    lums.push(l);
    if (l > 0.12 && l < 0.88) {
      sr += r;
      sg += gg;
      sb += b;
      n++;
    }
  }
  lums.sort((a, b) => a - b);
  const pct = (q: number) => lums[Math.min(lums.length - 1, Math.floor(q * lums.length))];
  const lo = pct(0.005);
  const hi = pct(0.995);
  const mid = pct(0.5);
  const cl = (v: number, m: number) => Math.round(Math.max(-m, Math.min(m, v)));
  const exposure = Math.round(Math.max(-2, Math.min(2, Math.log2(0.42 / Math.max(0.03, mid)) * 0.5)) * 100) / 100;
  const whites = cl((0.96 - hi) * 220, 70);
  const blacks = cl((0.03 - lo) * 320, 70);
  let temperature = 0;
  let tint = 0;
  if (n > 50) {
    const mr = sr / n, mg = sg / n, mb = sb / n, m = (mr + mg + mb) / 3 || 1;
    temperature = cl(((mb - mr) / m) * 140, 60);
    tint = cl(((mg - (mr + mb) / 2) / m) * 160, 60);
  }
  gesture((d) => {
    const x = d.clips.find((k) => k.id === id)!;
    // (each gesture step starts from the clip as it was before Auto)
    x.grade = { ...(x.grade ?? {}), exposure, whites, blacks, highlights: 0, shadows: 0 };
    x.fx = { ...x.fx, temperature, tint };
  });
  endGesture('Auto Color');
  toast(`Auto: exposure ${exposure >= 0 ? '+' : ''}${exposure}, whites ${whites}, blacks ${blacks}, temperature ${temperature}, tint ${tint}`, 'info', 5000);
}
