// Color grading on the GPU: white balance, exposure, tone (highlights/shadows/whites/blacks), lift/gamma/gain wheels,
// RGB curves, vibrance and 3D LUTs, in one WebGL2 pass per clip. The compositor draws a clip into a layer canvas,
// runs it through here and composites the result, so preview and export look the same.
import type { Clip, ColorGrade, ColorWheel, CurvePoint, Lut, Project } from './types';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// ---------- helpers shared with the UI ----------
const neutralWheel = (w?: ColorWheel) => !w || (Math.abs(w.x) < 1e-4 && Math.abs(w.y) < 1e-4 && Math.abs(w.luma) < 1e-4);
const neutralCurve = (pts?: CurvePoint[]) => !pts || pts.every(([x, y]) => Math.abs(x - y) < 1e-4);

export function gradeIsNeutral(g?: ColorGrade) {
  if (!g || g.enabled === false) return true;
  return (
    !g.exposure && !g.highlights && !g.shadows && !g.whites && !g.blacks && !g.vibrance &&
    neutralWheel(g.wheels?.shadows) && neutralWheel(g.wheels?.midtones) && neutralWheel(g.wheels?.highlights) &&
    neutralCurve(g.curves?.master) && neutralCurve(g.curves?.r) && neutralCurve(g.curves?.g) && neutralCurve(g.curves?.b) &&
    !(g.lut && g.lut.intensity > 0)
  );
}

/** Does this clip need the GPU pass (a grade, or white balance which renders there too)? */
export function needsGrade(c: Clip) {
  return !gradeIsNeutral(c.grade) || !!c.fx.temperature || !!c.fx.tint;
}

/** Monotone cubic (Fritsch–Carlson) through the points, sampled at n steps in 0..1. */
export function sampleCurve(pts: CurvePoint[] | undefined, n = 256): Float32Array {
  const out = new Float32Array(n);
  const p = [...(pts ?? [])].filter(([x]) => x >= 0 && x <= 1).sort((a, b) => a[0] - b[0]);
  if (!p.length || p[0][0] > 0) p.unshift([0, p.length && p[0][0] <= 0.001 ? p[0][1] : 0]);
  if (p[p.length - 1][0] < 1) p.push([1, 1]);
  const k = p.length;
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < k - 1; i++) d.push((p[i + 1][1] - p[i][1]) / Math.max(1e-6, p[i + 1][0] - p[i][0]));
  m[0] = d[0];
  m[k - 1] = d[k - 2];
  for (let i = 1; i < k - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < k - 1; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let seg = 0;
  for (let j = 0; j < n; j++) {
    const x = j / (n - 1);
    while (seg < k - 2 && x > p[seg + 1][0]) seg++;
    const [x0, y0] = p[seg];
    const [x1, y1] = p[seg + 1];
    const h = Math.max(1e-6, x1 - x0);
    const t = clamp((x - x0) / h, 0, 1);
    const t2 = t * t;
    const t3 = t2 * t;
    out[j] = clamp((2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m[seg] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m[seg + 1], 0, 1);
  }
  return out;
}

/** A wheel's push as an RGB offset that sums to zero (so it changes colour, not brightness). */
export function wheelOffset(w?: ColorWheel): [number, number, number] {
  if (!w) return [0, 0, 0];
  const amt = Math.min(1, Math.hypot(w.x, w.y));
  const h = Math.atan2(w.y, w.x);
  return [Math.cos(h) * amt, Math.cos(h - (2 * Math.PI) / 3) * amt, Math.cos(h - (4 * Math.PI) / 3) * amt];
}

// ---------- LUTs ----------
const b64encode = (u8: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const b64decode = (b: string) => Uint8Array.from(atob(b), (ch) => ch.charCodeAt(0));

/** Parse an Adobe/Resolve .cube 3D LUT. */
export function parseCube(text: string, name: string): Lut {
  let size = 0;
  let dmin = [0, 0, 0];
  let dmax = [1, 1, 1];
  const vals: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'LUT_3D_SIZE') size = parseInt(parts[1], 10);
    else if (key === 'LUT_1D_SIZE') throw new Error('1D LUTs are not supported — use a 3D .cube LUT');
    else if (key === 'DOMAIN_MIN') dmin = parts.slice(1, 4).map(Number);
    else if (key === 'DOMAIN_MAX') dmax = parts.slice(1, 4).map(Number);
    else if (/^[-+.\d]/.test(parts[0]) && parts.length >= 3) vals.push(+parts[0], +parts[1], +parts[2]);
  }
  if (!size || size < 2 || size > 129) throw new Error('Not a 3D .cube LUT (missing LUT_3D_SIZE)');
  if (vals.length < size ** 3 * 3) throw new Error(`The LUT is incomplete (${vals.length / 3} of ${size ** 3} entries)`);
  const u8 = new Uint8Array(size ** 3 * 3);
  for (let i = 0; i < u8.length; i++) {
    const ch = i % 3;
    u8[i] = Math.round(clamp((vals[i] - dmin[ch]) / (dmax[ch] - dmin[ch] || 1), 0, 1) * 255);
  }
  return { name, size, data: b64encode(u8) };
}

type Rgb = [number, number, number];
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Built-in creative looks, generated as 17³ LUTs. */
export const LOOKS: { id: string; name: string; fn: (r: number, g: number, b: number) => Rgb }[] = [
  {
    id: 'look-teal-orange',
    name: 'Teal & Orange',
    fn: (r, g, b) => {
      const l = luma(r, g, b);
      const w = smooth(0.15, 0.85, l);
      return [r + 0.1 * w - 0.06 * (1 - w), g + 0.02 * w + 0.02 * (1 - w), b - 0.1 * w + 0.1 * (1 - w)];
    },
  },
  {
    id: 'look-warm-film',
    name: 'Warm Film',
    fn: (r, g, b) => {
      const f = (x: number) => 0.06 + 0.88 * (x * x * (3 - 2 * x));
      return [f(r) * 1.06, f(g) * 1.01, f(b) * 0.9];
    },
  },
  {
    id: 'look-cool-night',
    name: 'Cool Night',
    fn: (r, g, b) => {
      const l = luma(r, g, b);
      return [r * 0.82 + 0.02, g * 0.92 + 0.03, b * 1.05 + 0.08 * (1 - l)];
    },
  },
  {
    id: 'look-bleach-bypass',
    name: 'Bleach Bypass',
    fn: (r, g, b) => {
      const l = luma(r, g, b);
      const c = (x: number) => clamp((x - 0.5) * 1.35 + 0.5, 0, 1);
      return [c(r * 0.45 + l * 0.55), c(g * 0.45 + l * 0.55), c(b * 0.45 + l * 0.55)];
    },
  },
  {
    id: 'look-vintage-fade',
    name: 'Vintage Fade',
    fn: (r, g, b) => [0.1 + r * 0.82 + 0.03, 0.08 + g * 0.8, 0.12 + b * 0.7],
  },
  {
    id: 'look-mono-contrast',
    name: 'Black & White Contrast',
    fn: (r, g, b) => {
      const l = luma(r, g, b);
      const v = l * l * (3 - 2 * l);
      return [v, v, v];
    },
  },
  {
    id: 'look-vivid',
    name: 'Vivid',
    fn: (r, g, b) => {
      const l = luma(r, g, b);
      return [l + (r - l) * 1.45, l + (g - l) * 1.45, l + (b - l) * 1.45];
    },
  },
];

export function buildLook(id: string): Lut | null {
  const look = LOOKS.find((l) => l.id === id);
  if (!look) return null;
  const n = 17;
  const u8 = new Uint8Array(n ** 3 * 3);
  let i = 0;
  for (let bi = 0; bi < n; bi++)
    for (let gi = 0; gi < n; gi++)
      for (let ri = 0; ri < n; ri++) {
        const out = look.fn(ri / (n - 1), gi / (n - 1), bi / (n - 1));
        for (const v of out) u8[i++] = Math.round(clamp(v, 0, 1) * 255);
      }
  return { name: look.name, size: n, data: b64encode(u8) };
}

/** Make sure a built-in look's LUT is stored in the project (call inside a commit). */
export function ensureLook(p: Project, id: string) {
  if (p.luts?.[id]) return;
  const lut = buildLook(id);
  if (!lut) throw new Error(`Unknown look ${id}. Looks: ${LOOKS.map((l) => l.id).join(', ')}`);
  p.luts = { ...(p.luts ?? {}), [id]: lut };
}

// ---------- the WebGL pass ----------
const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 uv; out vec4 o;
uniform sampler2D img; uniform sampler2D curves; uniform sampler3D lut;
uniform float exposure, temp, tint, hi, sh, wh, bl, vib, lutMix, lutSize;
uniform vec3 lift, gamma, gain;
uniform bool useCurves, useLut;
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec2 cu(float x) { return vec2(x * 255.0 / 256.0 + 0.5 / 256.0, 0.5); }
void main() {
  vec4 s = texture(img, vec2(uv.x, 1.0 - uv.y));
  if (s.a <= 0.0) { o = vec4(0.0); return; }
  vec3 c = s.rgb;
  // exposure and white balance in linear light
  vec3 L = toLin(c) * exp2(exposure);
  L *= vec3(1.0 + 0.3 * temp - 0.06 * tint, 1.0 - 0.25 * tint, 1.0 - 0.3 * temp - 0.06 * tint);
  c = toSrgb(clamp(L, 0.0, 16.0));
  // tone
  float l = clamp(lum(c), 0.0, 1.0);
  float d = sh * 0.45 * (1.0 - l) * (1.0 - l) * l * 4.0
          + hi * 0.45 * l * l * (1.0 - l) * 4.0
          + wh * 0.3 * smoothstep(0.45, 1.0, l)
          + bl * 0.22 * (1.0 - smoothstep(0.0, 0.45, l));
  c += d;
  // lift / gamma / gain
  c = c * gain + lift * (1.0 - c);
  c = pow(max(c, 0.0), 1.0 / max(gamma, vec3(0.05)));
  // curves: master, then per channel
  if (useCurves) {
    c = clamp(c, 0.0, 1.0);
    c = vec3(texture(curves, cu(c.r)).a, texture(curves, cu(c.g)).a, texture(curves, cu(c.b)).a);
    c = vec3(texture(curves, cu(c.r)).r, texture(curves, cu(c.g)).g, texture(curves, cu(c.b)).b);
  }
  // vibrance: boosts muted colours more than saturated ones
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float y = lum(c);
  c = mix(vec3(y), c, 1.0 + vib * (1.0 - clamp(mx - mn, 0.0, 1.0)));
  c = clamp(c, 0.0, 1.0);
  if (useLut) c = mix(c, texture(lut, c * ((lutSize - 1.0) / lutSize) + 0.5 / lutSize).rgb, lutMix);
  o = vec4(c * s.a, s.a);
}`;

export class Grader {
  canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private tex: WebGLTexture;
  private curveTex: WebGLTexture;
  private lutTex: WebGLTexture;
  private lutKey = '';
  private u: Record<string, WebGLUniformLocation | null> = {};

  static create(): Grader | null {
    try {
      return new Grader();
    } catch (e) {
      console.warn('GPU color grading unavailable, using the basic fallback:', e);
      return null;
    }
  }

  private constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('no WebGL2');
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader error');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link error');
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['img', 'curves', 'lut', 'exposure', 'temp', 'tint', 'hi', 'sh', 'wh', 'bl', 'vib', 'lutMix', 'lutSize', 'lift', 'gamma', 'gain', 'useCurves', 'useLut']) {
      this.u[n] = gl.getUniformLocation(prog, n);
    }
    const mk = (unit: number, target: number) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(target, t);
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.tex = mk(0, gl.TEXTURE_2D);
    this.curveTex = mk(1, gl.TEXTURE_2D);
    this.lutTex = mk(2, gl.TEXTURE_3D);
    gl.uniform1i(this.u.img, 0);
    gl.uniform1i(this.u.curves, 1);
    gl.uniform1i(this.u.lut, 2);
  }

  /** Grade `src` (a W×H canvas with the clip drawn into it); returns the GPU canvas holding the result. */
  render(src: HTMLCanvasElement | OffscreenCanvas, W: number, H: number, c: Clip, luts: Project['luts']) {
    const gl = this.gl;
    const g: ColorGrade = c.grade && c.grade.enabled !== false ? c.grade : {};
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    // the 2D canvas is premultiplied; ask for straight colour so grading isn't skewed by alpha
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource);

    const f = (v: number | undefined, k = 1) => ((v ?? 0) / 100) * k;
    gl.uniform1f(this.u.exposure, clamp(g.exposure ?? 0, -5, 5));
    gl.uniform1f(this.u.temp, f(c.fx.temperature));
    gl.uniform1f(this.u.tint, f(c.fx.tint));
    gl.uniform1f(this.u.hi, f(g.highlights));
    gl.uniform1f(this.u.sh, f(g.shadows));
    gl.uniform1f(this.u.wh, f(g.whites));
    gl.uniform1f(this.u.bl, f(g.blacks));
    gl.uniform1f(this.u.vib, f(g.vibrance));
    const w = g.wheels ?? {};
    const [sr, sg, sb] = wheelOffset(w.shadows);
    const [mr, mg, mb] = wheelOffset(w.midtones);
    const [hr, hg, hb] = wheelOffset(w.highlights);
    const sl = f(w.shadows?.luma, 0.25);
    const ml = f(w.midtones?.luma, 0.6);
    const hl = f(w.highlights?.luma, 0.6);
    gl.uniform3f(this.u.lift, sr * 0.2 + sl, sg * 0.2 + sl, sb * 0.2 + sl);
    gl.uniform3f(this.u.gamma, 1 + mr * 0.35 + ml, 1 + mg * 0.35 + ml, 1 + mb * 0.35 + ml);
    gl.uniform3f(this.u.gain, 1 + hr * 0.35 + hl, 1 + hg * 0.35 + hl, 1 + hb * 0.35 + hl);

    const cv = g.curves;
    const useCurves = !!cv && !(neutralCurve(cv.master) && neutralCurve(cv.r) && neutralCurve(cv.g) && neutralCurve(cv.b));
    gl.uniform1i(this.u.useCurves, useCurves ? 1 : 0);
    if (useCurves) {
      const [m, r, gg, b] = [sampleCurve(cv!.master), sampleCurve(cv!.r), sampleCurve(cv!.g), sampleCurve(cv!.b)];
      const px = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) {
        px[i * 4] = Math.round(r[i] * 255);
        px[i * 4 + 1] = Math.round(gg[i] * 255);
        px[i * 4 + 2] = Math.round(b[i] * 255);
        px[i * 4 + 3] = Math.round(m[i] * 255);
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }

    const lut = g.lut && g.lut.intensity > 0 ? luts?.[g.lut.id] : undefined;
    gl.uniform1i(this.u.useLut, lut ? 1 : 0);
    if (lut) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
      const key = g.lut!.id + ':' + lut.data.length;
      if (key !== this.lutKey) {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, lut.size, lut.size, lut.size, 0, gl.RGB, gl.UNSIGNED_BYTE, b64decode(lut.data));
        this.lutKey = key;
      }
      gl.uniform1f(this.u.lutMix, clamp(g.lut!.intensity / 100, 0, 1));
      gl.uniform1f(this.u.lutSize, lut.size);
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
