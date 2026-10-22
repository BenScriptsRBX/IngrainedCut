// Timeline compositor: draws the sequence at a time onto a canvas. Used by the program monitor
// (real-time playback + scrubbing), the exporter (frame-accurate) and Claude's frame captures.
import { mediaSrc } from './webBridge';
import type { ExportFrames } from './exportFrames';
import type { Clip, Effects, MediaItem, Project, TextStyle, TransitionType } from './types';
import { clipEnd, fadeFactor, mediaOf, nextAdjacent, prevAdjacent, propAt, tracksOf } from './ops';
import { clamp, dbToGain } from './time';
import { Grader, needsGrade } from './grade';

export interface Layer {
  clip: Clip;
  local: number;
  tail?: boolean;
  trans?: { type: TransitionType; p: number; role: 'to' | 'from' | 'out'; hasFrom?: boolean };
}

export type RenderMode = 'play' | 'seek' | 'export';

export function srcTime(p: Project, c: Clip, local: number) {
  const m = mediaOf(p, c);
  const max = m && m.duration > 0 ? m.duration - 0.001 : Infinity;
  return clamp(c.in + local * c.speed, 0, max);
}

export function layersAt(p: Project, t: number): Layer[] {
  const out: Layer[] = [];
  const fps = p.settings.fps;
  for (const track of tracksOf(p, 'video')) {
    if (track.hidden) continue;
    const active = p.clips
      .filter((c) => c.trackId === track.id && c.enabled && c.start <= t + 1e-6 && t < clipEnd(c) - 1e-6)
      .sort((a, b) => a.start - b.start);
    for (const c of active) {
      const local = t - c.start;
      const ti = c.transitionIn;
      const to = c.transitionOut;
      if (ti && local < ti.duration) {
        const pr = clamp(local / ti.duration, 0, 1);
        const prev = prevAdjacent(p, c, fps);
        if (prev && prev.enabled) out.push({ clip: prev, local: t - prev.start, tail: true, trans: { type: ti.type, p: pr, role: 'from' } });
        out.push({ clip: c, local, trans: { type: ti.type, p: pr, role: 'to', hasFrom: !!(prev && prev.enabled) } });
      } else if (to && local > c.duration - to.duration) {
        const next = nextAdjacent(p, c, fps);
        if (next && next.transitionIn) out.push({ clip: c, local });
        else out.push({ clip: c, local, trans: { type: to.type, p: clamp((local - (c.duration - to.duration)) / to.duration, 0, 1), role: 'out' } });
      } else out.push({ clip: c, local });
    }
  }
  return out;
}

export function cssFilter(fx: Effects, sf: number, extraBlur = 0) {
  const parts: string[] = [];
  if (fx.brightness) parts.push(`brightness(${(1 + fx.brightness / 100).toFixed(3)})`);
  if (fx.contrast) parts.push(`contrast(${(1 + fx.contrast / 100).toFixed(3)})`);
  if (fx.saturation !== 100) parts.push(`saturate(${(fx.saturation / 100).toFixed(3)})`);
  if (fx.hue) parts.push(`hue-rotate(${fx.hue}deg)`);
  if (fx.grayscale) parts.push(`grayscale(${fx.grayscale / 100})`);
  if (fx.sepia) parts.push(`sepia(${fx.sepia / 100})`);
  if (fx.invert) parts.push(`invert(${fx.invert / 100})`);
  const b = (fx.blur + extraBlur) * sf;
  if (b > 0.05) parts.push(`blur(${b.toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

const BLEND: Record<string, GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', add: 'lighter', difference: 'difference',
};

export function textFont(st: TextStyle, sf: number) {
  return `${st.italic ? 'italic ' : ''}${st.bold ? '700' : '400'} ${st.size * sf}px ${st.font}`;
}

let measureCtx: CanvasRenderingContext2D | null = null;
export function measureText(st: TextStyle, sf = 1) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  measureCtx.font = textFont(st, sf);
  const lines = (st.content || ' ').split('\n');
  const size = st.size * sf;
  const w = Math.max(...lines.map((l) => measureCtx!.measureText(l).width), size * 0.3);
  const h = lines.length * size * 1.2;
  const pad = st.backgroundOpacity > 0 ? size * 0.3 : 0;
  return { w: w + pad * 2, h: h + pad * 1.2, lines, size };
}

function drawText(ctx: CanvasRenderingContext2D, st: TextStyle, sf: number) {
  const { lines, size } = measureText(st, sf);
  ctx.font = textFont(st, sf);
  const widths = lines.map((l) => ctx.measureText(l).width);
  const maxW = Math.max(...widths, size * 0.3);
  const lh = size * 1.2;
  const total = lh * lines.length;
  if (st.backgroundOpacity > 0) {
    const pad = size * 0.3;
    ctx.save();
    ctx.globalAlpha *= st.backgroundOpacity / 100;
    ctx.fillStyle = st.backgroundColor;
    ctx.beginPath();
    (ctx as any).roundRect(-maxW / 2 - pad, -total / 2 - pad * 0.6, maxW + pad * 2, total + pad * 1.2, size * 0.15);
    ctx.fill();
    ctx.restore();
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = st.align;
  const ax = st.align === 'left' ? -maxW / 2 : st.align === 'right' ? maxW / 2 : 0;
  lines.forEach((ln, i) => {
    const y = -total / 2 + lh * (i + 0.5);
    ctx.save();
    if (st.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.65)';
      ctx.shadowBlur = size * 0.12;
      ctx.shadowOffsetY = size * 0.04;
    }
    if (st.strokeWidth > 0) {
      ctx.lineWidth = st.strokeWidth * sf * 2;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = st.strokeColor;
      ctx.strokeText(ln, ax, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = st.color;
    ctx.fillText(ln, ax, y);
    ctx.restore();
  });
}

function hexToRgb(c: string): [number, number, number] {
  const m = c.replace('#', '');
  const v = m.length === 3 ? m.split('').map((x) => x + x).join('') : m.padEnd(6, '0');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function chromaKey(ctx: CanvasRenderingContext2D, W: number, H: number, color: string, tolerance: number, softness: number) {
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const [kr, kg, kb] = hexToRgb(color);
  const kcb = -0.169 * kr - 0.331 * kg + 0.5 * kb;
  const kcr = 0.5 * kr - 0.419 * kg - 0.081 * kb;
  const tol = tolerance * 1.2;
  const soft = Math.max(1, softness * 1.2);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const cb = -0.169 * r - 0.331 * g + 0.5 * b;
    const cr = 0.5 * r - 0.419 * g - 0.081 * b;
    const dist = Math.hypot(cb - kcb, cr - kcr);
    if (dist < tol + soft) {
      const f = clamp((dist - tol) / soft, 0, 1);
      d[i + 3] = d[i + 3] * f;
      if (kg > kr && kg > kb) d[i + 1] = Math.min(g, Math.max(r, b) + (g - Math.max(r, b)) * f);
    }
  }
  ctx.putImageData(img, 0, 0);
}

export interface Bounds {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
}

export class Compositor {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  layer: HTMLCanvasElement;
  lctx: CanvasRenderingContext2D;
  key: HTMLCanvasElement;
  kctx: CanvasRenderingContext2D;
  videos = new Map<string, HTMLVideoElement>();
  images = new Map<string, HTMLImageElement>();
  private token = 0;
  /** Export only: WebCodecs-decoded frames for video clips (see exportFrames.ts). */
  frames: ExportFrames | null = null;

  constructor(canvas?: HTMLCanvasElement) {
    this.canvas = canvas ?? document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.layer = document.createElement('canvas');
    this.lctx = this.layer.getContext('2d')!;
    this.key = document.createElement('canvas');
    this.kctx = this.key.getContext('2d', { willReadFrequently: true })!;
  }

  /** GPU colour grading, created on first use (null when WebGL2 isn't available: basic fallback). */
  private graderInst: Grader | null | undefined;
  private get grader() {
    if (this.graderInst === undefined) this.graderInst = Grader.create();
    return this.graderInst;
  }

  /** Run the clip's grade over a W×H layer canvas in place. Returns false without GPU support. */
  private grade(lc: CanvasRenderingContext2D, canvas: HTMLCanvasElement, c: Clip, p: Project, W: number, H: number) {
    const g = this.grader;
    if (!g) return false;
    const out = g.render(canvas, W, H, c, p.luts);
    lc.save();
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalAlpha = 1;
    lc.filter = 'none';
    lc.globalCompositeOperation = 'copy';
    lc.drawImage(out, 0, 0);
    lc.restore();
    return true;
  }

  setSize(w: number, h: number) {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    for (const c of [this.canvas, this.layer, this.key]) {
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    }
  }

  video(c: Clip, m: MediaItem): HTMLVideoElement {
    let v = this.videos.get(c.id);
    if (v && v.dataset.src !== mediaSrc(m.url)) {
      v.pause();
      v.removeAttribute('src');
      v.load();
      this.videos.delete(c.id);
      v = undefined;
    }
    if (!v) {
      v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.preload = 'auto';
      v.muted = true;
      v.playsInline = true;
      v.src = mediaSrc(m.url);
      v.dataset.src = mediaSrc(m.url);
      this.videos.set(c.id, v);
    }
    v.dataset.used = String(performance.now());
    return v;
  }

  image(m: MediaItem): HTMLImageElement {
    let img = this.images.get(m.id);
    if (!img) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = mediaSrc(m.url);
      this.images.set(m.id, img);
    }
    return img;
  }

  /** Drop decoders for clips that have not been used recently. */
  gc(keep: Set<string>) {
    if (this.videos.size <= 10) return;
    const now = performance.now();
    for (const [id, v] of this.videos) {
      if (keep.has(id)) continue;
      if (now - Number(v.dataset.used || 0) > 15000) {
        v.pause();
        v.removeAttribute('src');
        v.load();
        this.videos.delete(id);
      }
    }
  }

  private seekVideo(v: HTMLVideoElement, time: number, precise: boolean): Promise<void> {
    if (v.readyState >= 2 && !v.seeking && Math.abs(v.currentTime - time) < (precise ? 0.0005 : 0.02)) return Promise.resolve();
    return new Promise((res) => {
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        v.removeEventListener('seeked', fin);
        clearTimeout(to);
        if (v.readyState >= 2 || !precise) res();
        else {
          const onData = () => {
            v.removeEventListener('loadeddata', onData);
            res();
          };
          v.addEventListener('loadeddata', onData);
          setTimeout(onData, 2000);
        }
      };
      const to = setTimeout(fin, precise ? 5000 : 1500);
      v.addEventListener('seeked', fin);
      v.currentTime = time;
    });
  }

  /** Seek media for time t and draw. Latest call wins. */
  async render(p: Project, t: number, mode: Exclude<RenderMode, 'play'> = 'seek') {
    const token = ++this.token;
    const layers = layersAt(p, t);
    const waits: Promise<any>[] = [];
    for (const l of layers) {
      const m = mediaOf(p, l.clip);
      if (!m) continue;
      if (l.clip.kind === 'video') {
        if (mode === 'export' && this.frames?.handles(l.clip.id)) {
          waits.push(this.frames.advance(l.clip.id));
          continue;
        }
        const v = this.video(l.clip, m);
        if (!v.paused) v.pause();
        waits.push(this.seekVideo(v, srcTime(p, l.clip, l.local) + (mode === 'export' ? 0.0005 : 0), mode === 'export'));
      } else if (l.clip.kind === 'image') {
        const img = this.image(m);
        if (!img.complete || mode === 'export') waits.push(img.decode().catch(() => {}));
      }
    }
    if (document.fonts && mode === 'export') waits.push(document.fonts.ready);
    await Promise.all(waits);
    if (token !== this.token && mode !== 'export') return;
    this.draw(p, t, layers);
  }

  /** Real-time playback step: keep media elements running in sync, draw immediately. */
  playStep(p: Project, t: number, rate: number) {
    const layers = layersAt(p, t);
    const active = new Set<string>();
    for (const l of layers) {
      const m = mediaOf(p, l.clip);
      if (!m || l.clip.kind !== 'video') continue;
      active.add(l.clip.id);
      const v = this.video(l.clip, m);
      const want = srcTime(p, l.clip, l.local);
      const pr = clamp(l.clip.speed * rate, 0.0625, 16);
      if (v.playbackRate !== pr) v.playbackRate = pr;
      if (v.paused) {
        if (Math.abs(v.currentTime - want) > 0.04) v.currentTime = want;
        v.play().catch(() => {});
      } else if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
    }
    // preroll clips that start within the next second
    for (const c of p.clips) {
      if (c.kind !== 'video' || !c.enabled || active.has(c.id)) continue;
      if (c.start > t && c.start - t < 1.2 / Math.max(rate, 0.25)) {
        const m = mediaOf(p, c);
        if (!m) continue;
        const v = this.video(c, m);
        if (v.paused && Math.abs(v.currentTime - c.in) > 0.05 && !v.seeking) v.currentTime = c.in;
        active.add(c.id);
      }
    }
    for (const [id, v] of this.videos) if (!active.has(id) && !v.paused) v.pause();
    this.draw(p, t, layers);
    this.gc(active);
  }

  pauseAll() {
    for (const v of this.videos.values()) if (!v.paused) v.pause();
  }

  draw(p: Project, t: number, layers = layersAt(p, t)) {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const sf = W / p.settings.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = p.settings.background || '#000';
    ctx.fillRect(0, 0, W, H);
    for (const l of layers) {
      try {
        this.drawLayer(p, l, W, H, sf);
      } catch (e) {
        console.warn('draw layer failed', e);
      }
    }
  }

  private drawLayer(p: Project, l: Layer, W: number, H: number, sf: number) {
    const c = l.clip;
    const ctx = this.ctx;
    const tr = l.trans;
    let alpha = (propAt(c, 'opacity', l.local) / 100) * (l.tail ? 1 : fadeFactor(c, l.local));
    let offX = 0;
    let zoom = 1;
    let extraBlur = 0;
    let clipRect: [number, number, number, number] | null = null;
    let dip: { color: string; a: number } | null = null;
    if (tr) {
      const pr = tr.p;
      const dipColor = tr.type === 'dip-to-white' ? '#ffffff' : '#000000';
      switch (tr.type) {
        case 'cross-dissolve':
          if (tr.role === 'to') alpha *= pr;
          if (tr.role === 'out') alpha *= 1 - pr;
          break;
        case 'blur-dissolve':
          if (tr.role === 'to') (alpha *= pr), (extraBlur = (1 - pr) * 30);
          if (tr.role === 'from') extraBlur = pr * 30;
          if (tr.role === 'out') (alpha *= 1 - pr), (extraBlur = pr * 30);
          break;
        case 'dip-to-black':
        case 'dip-to-white':
          if (tr.role === 'from' && pr >= 0.5) return;
          if (tr.role === 'to') {
            if (tr.hasFrom && pr < 0.5) alpha = 0;
            dip = { color: dipColor, a: tr.hasFrom ? 1 - Math.abs(2 * pr - 1) : 1 - pr };
          }
          if (tr.role === 'out') dip = { color: dipColor, a: pr };
          break;
        case 'wipe-left':
        case 'wipe-right': {
          const left = tr.type === 'wipe-left';
          if (tr.role === 'to') clipRect = left ? [0, 0, W * pr, H] : [W * (1 - pr), 0, W * pr, H];
          if (tr.role === 'out') clipRect = left ? [W * pr, 0, W * (1 - pr), H] : [0, 0, W * (1 - pr), H];
          break;
        }
        case 'slide-left':
        case 'slide-right': {
          const dir = tr.type === 'slide-left' ? 1 : -1;
          if (tr.role === 'to') offX = dir * (1 - pr) * W;
          if (tr.role === 'out') offX = -dir * pr * W;
          break;
        }
        case 'push-left':
          if (tr.role === 'to') offX = (1 - pr) * W;
          if (tr.role === 'from' || tr.role === 'out') offX = -pr * W;
          break;
        case 'zoom-in':
          if (tr.role === 'to') (zoom = 0.6 + 0.4 * pr), (alpha *= pr);
          if (tr.role === 'out') (zoom = 1 + 0.5 * pr), (alpha *= 1 - pr);
          break;
      }
    }

    if (c.kind === 'adjustment') {
      const lc = this.lctx;
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.globalCompositeOperation = 'source-over';
      lc.globalAlpha = 1;
      lc.clearRect(0, 0, W, H);
      lc.filter = cssFilter(c.fx, sf);
      lc.drawImage(this.canvas, 0, 0);
      lc.filter = 'none';
      const graded = needsGrade(c) && this.grade(lc, this.layer, c, p, W, H);
      this.postFx(lc, c.fx, W, H, graded);
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      if (clipRect) {
        ctx.beginPath();
        ctx.rect(...clipRect);
        ctx.clip();
      }
      ctx.drawImage(this.layer, 0, 0);
      ctx.restore();
      if (dip) this.drawDip(dip, W, H);
      return;
    }

    const fx = c.fx;
    const ck = c.chromaKey?.enabled ? c.chromaKey : null;
    const wantsGrade = needsGrade(c);
    const needsLayer = !!ck || wantsGrade || !!fx.vignette;
    const target = needsLayer ? (ck ? this.kctx : this.lctx) : ctx;
    const targetCanvas = needsLayer ? (ck ? this.key : this.layer) : this.canvas;

    if (needsLayer) {
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.globalAlpha = 1;
      target.globalCompositeOperation = 'source-over';
      target.filter = 'none';
      target.clearRect(0, 0, W, H);
    } else {
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.globalCompositeOperation = BLEND[c.blend] || 'source-over';
      if (clipRect) {
        ctx.beginPath();
        ctx.rect(...clipRect);
        ctx.clip();
      }
    }

    target.save();
    const x = propAt(c, 'x', l.local) * sf + offX;
    const y = propAt(c, 'y', l.local) * sf;
    const s = (propAt(c, 'scale', l.local) / 100) * zoom;
    const rot = propAt(c, 'rotation', l.local);
    target.translate(W / 2 + x, H / 2 + y);
    if (rot) target.rotate((rot * Math.PI) / 180);
    target.scale(s, s);
    target.filter = cssFilter(fx, sf, extraBlur);
    this.drawContent(p, target, c, l, W, H, sf);
    target.restore();

    if (needsLayer) {
      if (ck) chromaKey(target, W, H, ck.color || '#00ff00', ck.tolerance ?? 30, ck.softness ?? 15);
      const graded = wantsGrade && this.grade(target, targetCanvas, c, p, W, H);
      this.postFx(target, fx, W, H, graded);
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.globalCompositeOperation = BLEND[c.blend] || 'source-over';
      if (clipRect) {
        ctx.beginPath();
        ctx.rect(...clipRect);
        ctx.clip();
      }
      ctx.drawImage(targetCanvas, 0, 0);
      ctx.restore();
    } else ctx.restore();
    if (dip) this.drawDip(dip, W, H);
  }

  private drawDip(dip: { color: string; a: number }, W: number, H: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = clamp(dip.a, 0, 1);
    ctx.fillStyle = dip.color;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /** Vignette, plus the old overlay white balance when the GPU grade didn't already do it. */
  private postFx(lc: CanvasRenderingContext2D, fx: Effects, W: number, H: number, graded = false) {
    lc.save();
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.filter = 'none';
    lc.globalCompositeOperation = 'source-atop';
    if (fx.temperature && !graded) {
      const a = (Math.abs(fx.temperature) / 100) * 0.3;
      lc.fillStyle = fx.temperature > 0 ? `rgba(255,140,30,${a})` : `rgba(30,120,255,${a})`;
      lc.fillRect(0, 0, W, H);
    }
    if (fx.tint && !graded) {
      const a = (Math.abs(fx.tint) / 100) * 0.22;
      lc.fillStyle = fx.tint > 0 ? `rgba(255,0,190,${a})` : `rgba(0,220,70,${a})`;
      lc.fillRect(0, 0, W, H);
    }
    if (fx.vignette) {
      const g = lc.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.hypot(W, H) * 0.55);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${fx.vignette / 100})`);
      lc.fillStyle = g;
      lc.fillRect(0, 0, W, H);
    }
    lc.restore();
  }

  private drawContent(p: Project, ctx: CanvasRenderingContext2D, c: Clip, l: Layer, W: number, H: number, sf: number) {
    const cr = c.crop || { left: 0, right: 0, top: 0, bottom: 0 };
    const drawFitted = (src: CanvasImageSource, vw: number, vh: number) => {
      if (!vw || !vh) return;
      const fit = Math.min(W / vw, H / vh);
      const dw = vw * fit;
      const dh = vh * fit;
      const kl = cr.left / 100, kr = cr.right / 100, kt = cr.top / 100, kb = cr.bottom / 100;
      if (kl + kr >= 1 || kt + kb >= 1) return;
      ctx.drawImage(src, vw * kl, vh * kt, vw * (1 - kl - kr), vh * (1 - kt - kb), -dw / 2 + dw * kl, -dh / 2 + dh * kt, dw * (1 - kl - kr), dh * (1 - kt - kb));
    };
    switch (c.kind) {
      case 'video': {
        const m = mediaOf(p, c);
        if (!m) return;
        const fi = this.frames?.image(c.id);
        if (fi) {
          drawFitted(fi.img, fi.w, fi.h);
          break;
        }
        const v = this.video(c, m);
        if (v.readyState >= 2) drawFitted(v, v.videoWidth, v.videoHeight);
        break;
      }
      case 'image': {
        const m = mediaOf(p, c);
        if (!m) return;
        const img = this.image(m);
        if (img.complete && img.naturalWidth) drawFitted(img, img.naturalWidth, img.naturalHeight);
        break;
      }
      case 'color': {
        ctx.fillStyle = c.color || '#000';
        const kl = cr.left / 100, kr = cr.right / 100, kt = cr.top / 100, kb = cr.bottom / 100;
        ctx.fillRect(-W / 2 + W * kl, -H / 2 + H * kt, W * (1 - kl - kr), H * (1 - kt - kb));
        break;
      }
      case 'text':
        if (c.text) drawText(ctx, c.text, sf);
        break;
    }
  }

  /** Bounding box of a visual clip in sequence pixel coordinates (for on-monitor handles). */
  bounds(p: Project, c: Clip, t: number): Bounds | null {
    const local = clamp(t - c.start, 0, c.duration);
    const W = p.settings.width;
    const H = p.settings.height;
    let w = W;
    let h = H;
    if (c.kind === 'video' || c.kind === 'image') {
      const m = mediaOf(p, c);
      const v = c.kind === 'video' ? this.videos.get(c.id) : this.images.get(c.mediaId!);
      const vw = (v as any)?.videoWidth || (v as any)?.naturalWidth || m?.width || W;
      const vh = (v as any)?.videoHeight || (v as any)?.naturalHeight || m?.height || H;
      const fit = Math.min(W / vw, H / vh);
      w = vw * fit;
      h = vh * fit;
      const cr = c.crop;
      w *= 1 - (cr.left + cr.right) / 100;
      h *= 1 - (cr.top + cr.bottom) / 100;
    } else if (c.kind === 'text' && c.text) {
      const m = measureText(c.text, 1);
      w = m.w;
      h = m.h;
    } else if (c.kind === 'adjustment') return null;
    const s = propAt(c, 'scale', local) / 100;
    return { cx: W / 2 + propAt(c, 'x', local), cy: H / 2 + propAt(c, 'y', local), w: w * s, h: h * s, rot: propAt(c, 'rotation', local) };
  }

  dispose() {
    this.graderInst?.dispose();
    this.graderInst = undefined;
    for (const v of this.videos.values()) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
    this.videos.clear();
  }
}

// ---------------- audio ----------------

export function anySolo(p: Project) {
  return p.tracks.some((t) => t.kind === 'audio' && t.solo);
}

export function clipGain(p: Project, c: Clip, local: number, solo = anySolo(p)) {
  const tr = p.tracks.find((t) => t.id === c.trackId);
  if (!tr || tr.muted || (solo && !tr.solo) || !c.enabled) return 0;
  let g = dbToGain(propAt(c, 'volume', local)) * fadeFactor(c, local) * dbToGain(tr.volume);
  if (c.transitionIn && local < c.transitionIn.duration) g *= Math.max(0, local / c.transitionIn.duration);
  if (c.transitionOut && local > c.duration - c.transitionOut.duration) g *= Math.max(0, (c.duration - local) / c.transitionOut.duration);
  return g;
}

interface AudioNodeSet {
  el: HTMLAudioElement;
  src: MediaElementAudioSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
  url: string;
}

export class AudioEngine {
  ctx: AudioContext;
  master: GainNode;
  analyserL: AnalyserNode;
  analyserR: AnalyserNode;
  nodes = new Map<string, AudioNodeSet>();
  private buf = new Float32Array(2048);

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    const split = this.ctx.createChannelSplitter(2);
    this.analyserL = this.ctx.createAnalyser();
    this.analyserR = this.ctx.createAnalyser();
    this.analyserL.fftSize = this.analyserR.fftSize = 2048;
    this.master.connect(split);
    split.connect(this.analyserL, 0);
    split.connect(this.analyserR, 1);
    this.master.connect(this.ctx.destination);
  }

  private node(c: Clip, m: MediaItem): AudioNodeSet {
    const url = mediaSrc(m.audioUrl || m.url);
    let n = this.nodes.get(c.id);
    if (n && n.url !== url) {
      this.drop(c.id);
      n = undefined;
    }
    if (!n) {
      const el = new Audio();
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      el.src = url;
      const src = this.ctx.createMediaElementSource(el);
      const gain = this.ctx.createGain();
      const pan = this.ctx.createStereoPanner();
      src.connect(gain).connect(pan).connect(this.master);
      n = { el, src, gain, pan, url };
      this.nodes.set(c.id, n);
    }
    return n;
  }

  private drop(id: string) {
    const n = this.nodes.get(id);
    if (!n) return;
    n.el.pause();
    n.src.disconnect();
    n.gain.disconnect();
    n.pan.disconnect();
    n.el.removeAttribute('src');
    n.el.load();
    this.nodes.delete(id);
  }

  sync(p: Project, t: number, playing: boolean, rate: number) {
    if (playing && this.ctx.state === 'suspended') this.ctx.resume();
    const solo = anySolo(p);
    const active = new Set<string>();
    if (playing && rate > 0) {
      for (const c of p.clips) {
        if (c.kind !== 'audio' || !c.enabled) continue;
        const local = t - c.start;
        const upcoming = c.start > t && c.start - t < 1;
        if (!(local >= 0 && local < c.duration) && !upcoming) continue;
        const m = mediaOf(p, c);
        if (!m) continue;
        const n = this.node(c, m);
        active.add(c.id);
        if (upcoming) {
          if (n.el.paused && Math.abs(n.el.currentTime - c.in) > 0.05) n.el.currentTime = c.in;
          continue;
        }
        const want = srcTime(p, c, local);
        const pr = clamp(c.speed * rate, 0.25, 4);
        if (n.el.playbackRate !== pr) n.el.playbackRate = pr;
        if (n.el.paused) {
          n.el.currentTime = want;
          n.el.play().catch(() => {});
        } else if (Math.abs(n.el.currentTime - want) > 0.2) n.el.currentTime = want;
        n.gain.gain.setTargetAtTime(clipGain(p, c, local, solo), this.ctx.currentTime, 0.012);
        n.pan.pan.setTargetAtTime(clamp((c.pan || 0) / 100, -1, 1), this.ctx.currentTime, 0.02);
      }
    }
    for (const [id, n] of this.nodes) {
      if (!active.has(id) && !n.el.paused) n.el.pause();
      if (!active.has(id) && this.nodes.size > 24) this.drop(id);
    }
  }

  stopAll() {
    for (const n of this.nodes.values()) n.el.pause();
  }

  level(which: 'L' | 'R') {
    const a = which === 'L' ? this.analyserL : this.analyserR;
    a.getFloatTimeDomainData(this.buf);
    let m = 0;
    for (let i = 0; i < this.buf.length; i++) m = Math.max(m, Math.abs(this.buf[i]));
    return m;
  }
}
