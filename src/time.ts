export const EPS = 1e-6;

export function snapFrame(t: number, fps: number) {
  return Math.round(t * fps) / fps;
}

export function fmtTC(sec: number, fps: number) {
  const neg = sec < 0;
  const f = Math.round(Math.abs(sec) * fps);
  const fi = Math.max(1, Math.round(fps));
  const ff = f % fi;
  const totalS = Math.floor(f / fi);
  const ss = totalS % 60;
  const mm = Math.floor(totalS / 60) % 60;
  const hh = Math.floor(totalS / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${neg ? '-' : ''}${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}

/** Short human time like 1:23.4 */
export function fmtShort(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** Accepts "hh:mm:ss:ff", "mm:ss:ff", "mm:ss", "12.5", "+15" (frames offset from base). */
export function parseTC(str: string, fps: number, base = 0): number | null {
  const s = str.trim();
  if (!s) return null;
  if (/^[+-]\d+$/.test(s)) return base + parseInt(s, 10) / fps;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(/[:;.]/).map((x) => parseInt(x, 10));
  if (parts.some(isNaN)) return null;
  if (parts.length === 4) return parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / fps;
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / fps;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

export const dbToGain = (db: number) => (db <= -60 ? 0 : Math.pow(10, db / 20));
export const r3 = (x: number) => Math.round(x * 1000) / 1000;
export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
