// Color Grading panel: scopes, basic correction, creative looks / LUTs, RGB curves and colour wheels for the selected clip.
import React, { useEffect, useRef, useState } from 'react';
import type { Clip, ColorGrade, ColorWheel, CurvePoint } from '../types';
import { useEditor, beginGesture, gesture, endGesture } from '../store';
import { ScrubNumber, Section } from './Widgets';
import { Icon } from './Icons';
import { LOOKS, sampleCurve, wheelOffset } from '../grade';
import { applyLook, autoColor, copyGrade, hasCopiedGrade, importLut, pasteGrade, resetGrade } from '../colorActions';
import { engine } from '../engine';

type GradeKey = 'exposure' | 'highlights' | 'shadows' | 'whites' | 'blacks' | 'vibrance';

export function ColorPanel() {
  const selection = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const sel = project.clips.filter((c) => selection.includes(c.id) && c.kind !== 'audio');
  const c = sel[0];
  return (
    <div className="ec color-panel">
      <Scopes />
      {!c ? (
        <div className="empty-hint" style={{ padding: 24 }}>
          <Icon name="wand" size={24} />
          <div>Select a video, image or adjustment clip to grade it.</div>
        </div>
      ) : (
        <ClipGrade c={c} ids={sel.map((x) => x.id)} luts={project.luts ?? {}} />
      )}
    </div>
  );
}

function ClipGrade({ c, ids, luts }: { c: Clip; ids: string[]; luts: NonNullable<ReturnType<typeof useEditor.getState>['project']['luts']> }) {
  const g: ColorGrade = c.grade ?? {};
  const id = c.id;
  const file = useRef<HTMLInputElement>(null);
  // live edits apply to every selected clip, as one undo step per drag
  const live = (fn: (cl: Clip) => void) => gesture((d) => d.clips.forEach((cl) => ids.includes(cl.id) && fn(cl)));
  const setGrade = (patch: Partial<ColorGrade>) => live((cl) => void (cl.grade = { ...(cl.grade ?? {}), ...patch }));
  const once = (label: string, fn: () => void) => {
    beginGesture();
    fn();
    endGesture(label);
  };

  const row = (label: string, value: number, apply: (v: number) => void, min: number, max: number, step = 1, precision = 0, neutral = 0) => (
    <div className="ec-row">
      <span className="ec-label" title="Double-click to reset" onDoubleClick={() => once(`Reset ${label}`, () => apply(neutral))}>
        {label}
      </span>
      <ScrubNumber value={value} min={min} max={max} step={step} precision={precision} onBegin={beginGesture} onChange={apply} onCommit={() => endGesture(label)} />
      <input type="range" className="ec-slider" min={min} max={max} step={step} value={value} onPointerDown={beginGesture} onChange={(e) => apply(Number(e.target.value))} onPointerUp={() => endGesture(label)} />
    </div>
  );
  const gRow = (label: string, k: GradeKey, min = -100, max = 100, step = 1, precision = 0) => row(label, g[k] ?? 0, (v) => setGrade({ [k]: v }), min, max, step, precision);
  const fxRow = (label: string, k: 'temperature' | 'tint' | 'contrast' | 'saturation' | 'vignette', min: number, max: number, neutral = 0) =>
    row(label, c.fx[k], (v) => live((cl) => void (cl.fx = { ...cl.fx, [k]: v })), min, max, 1, 0, neutral);

  const lutId = g.lut?.id ?? '';
  const enabled = g.enabled !== false;
  return (
    <>
      <div className="cp-head">
        <span className="cp-name" title={c.name}>
          {ids.length > 1 ? `${ids.length} clips` : c.name}
        </span>
        <label className="cp-toggle" title="Turn the grade off to compare with the original">
          <input type="checkbox" checked={enabled} onChange={(e) => once('Toggle Grade', () => setGrade({ enabled: e.target.checked }))} /> Grade on
        </label>
        <span className="grow" />
        <button className="btn sm" title="Set exposure, whites, blacks and white balance from the frame under the playhead" onClick={() => autoColor(id)}>
          Auto
        </button>
        <button className="icon-btn sm" title="Copy grade" onClick={() => copyGrade(id)}>
          <Icon name="copy" size={12} />
        </button>
        <button className="icon-btn sm" title="Paste grade onto the selected clips" disabled={!hasCopiedGrade()} onClick={() => pasteGrade(ids)}>
          <Icon name="paste" size={12} />
        </button>
        <button className="icon-btn sm" title="Reset the whole grade" onClick={() => resetGrade(ids)}>
          <Icon name="reset" size={12} />
        </button>
      </div>

      <Section title="Basic Correction">
        <div className="cp-sub">White Balance</div>
        {fxRow('Temperature', 'temperature', -100, 100)}
        {fxRow('Tint', 'tint', -100, 100)}
        <div className="cp-sub">Tone</div>
        {gRow('Exposure', 'exposure', -5, 5, 0.05, 2)}
        {fxRow('Contrast', 'contrast', -100, 100)}
        {gRow('Highlights', 'highlights')}
        {gRow('Shadows', 'shadows')}
        {gRow('Whites', 'whites')}
        {gRow('Blacks', 'blacks')}
        <div className="cp-sub">Color</div>
        {fxRow('Saturation', 'saturation', 0, 300, 100)}
        {gRow('Vibrance', 'vibrance')}
      </Section>

      <Section title="Creative" defaultOpen={!!g.lut || !!c.fx.vignette}>
        <div className="ec-row">
          <span className="ec-label">Look</span>
          <select
            className="grow"
            value={lutId}
            onChange={(e) => {
              if (e.target.value === '__import') return file.current?.click();
              applyLook(ids, e.target.value || null, g.lut?.intensity ?? 100);
            }}
          >
            <option value="">None</option>
            <optgroup label="Built-in looks">
              {LOOKS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </optgroup>
            {Object.entries(luts).some(([k]) => !k.startsWith('look-')) && (
              <optgroup label="Imported LUTs">
                {Object.entries(luts)
                  .filter(([k]) => !k.startsWith('look-'))
                  .map(([k, l]) => (
                    <option key={k} value={k}>
                      {l.name}
                    </option>
                  ))}
              </optgroup>
            )}
            <option value="__import">Import .cube LUT…</option>
          </select>
          <input
            ref={file}
            type="file"
            accept=".cube"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importLut(f, ids);
              e.target.value = '';
            }}
          />
        </div>
        {g.lut && row('Intensity', g.lut.intensity, (v) => setGrade({ lut: { id: g.lut!.id, intensity: v } }), 0, 100)}
        {fxRow('Vignette', 'vignette', 0, 100)}
      </Section>

      <Section title="Curves" defaultOpen={!!g.curves}>
        <CurveEditor curves={g.curves ?? {}} onLive={(curves) => setGrade({ curves })} />
      </Section>

      <Section title="Color Wheels" defaultOpen={!!g.wheels}>
        <div className="cp-wheels">
          {(['shadows', 'midtones', 'highlights'] as const).map((k) => (
            <WheelControl
              key={k}
              label={k === 'shadows' ? 'Shadows' : k === 'midtones' ? 'Midtones' : 'Highlights'}
              value={g.wheels?.[k] ?? { x: 0, y: 0, luma: 0 }}
              onLive={(w) => setGrade({ wheels: { ...(g.wheels ?? {}), [k]: w } })}
            />
          ))}
        </div>
      </Section>
    </>
  );
}

// ---------- curves ----------
const CH = ['master', 'r', 'g', 'b'] as const;
const CH_COLOR = { master: '#e8e8e8', r: '#ff5a5a', g: '#4bd36b', b: '#5b8cff' };

function CurveEditor({ curves, onLive }: { curves: NonNullable<ColorGrade['curves']>; onLive: (c: NonNullable<ColorGrade['curves']>) => void }) {
  const [ch, setCh] = useState<(typeof CH)[number]>('master');
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<number | null>(null);
  const S = 220;
  const pts: CurvePoint[] = curves[ch]?.length ? curves[ch]! : [[0, 0], [1, 1]];

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, S, S);
    g.strokeStyle = '#2c2c2c';
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo((i * S) / 4, 0);
      g.lineTo((i * S) / 4, S);
      g.moveTo(0, (i * S) / 4);
      g.lineTo(S, (i * S) / 4);
      g.stroke();
    }
    g.strokeStyle = '#444';
    g.beginPath();
    g.moveTo(0, S);
    g.lineTo(S, 0);
    g.stroke();
    for (const k of CH) {
      if (k !== ch && !curves[k]?.length) continue;
      const v = sampleCurve(curves[k], 128);
      g.strokeStyle = CH_COLOR[k];
      g.globalAlpha = k === ch ? 1 : 0.35;
      g.lineWidth = k === ch ? 2 : 1;
      g.beginPath();
      v.forEach((y, i) => (i ? g.lineTo((i / 127) * S, (1 - y) * S) : g.moveTo(0, (1 - y) * S)));
      g.stroke();
    }
    g.globalAlpha = 1;
    g.fillStyle = CH_COLOR[ch];
    for (const [x, y] of pts) {
      g.beginPath();
      g.arc(x * S, (1 - y) * S, 4, 0, Math.PI * 2);
      g.fill();
    }
  }, [curves, ch]);

  const at = (e: React.PointerEvent): CurvePoint => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
  };
  const set = (next: CurvePoint[]) => onLive({ ...curves, [ch]: next });

  return (
    <div className="cp-curves">
      <div className="mp-efforts">
        {CH.map((k) => (
          <button key={k} className={'chip' + (k === ch ? ' on' : '')} style={{ color: k === ch ? undefined : CH_COLOR[k] }} onClick={() => setCh(k)}>
            {k === 'master' ? 'Master' : k.toUpperCase()}
          </button>
        ))}
        <button className="chip" title="Reset this curve" onClick={() => (beginGesture(), set([[0, 0], [1, 1]]), endGesture('Reset Curve'))}>
          Reset
        </button>
      </div>
      <canvas
        ref={ref}
        width={S}
        height={S}
        className="cp-curve-canvas"
        title="Click to add a point, drag to move, double-click a point to remove it"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const [x, y] = at(e);
          let i = pts.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 0.05);
          beginGesture();
          if (i < 0) {
            const next = [...pts, [x, y] as CurvePoint].sort((a, b) => a[0] - b[0]);
            i = next.findIndex((p) => p[0] === x && p[1] === y);
            set(next);
          }
          drag.current = i;
        }}
        onPointerMove={(e) => {
          if (drag.current == null) return;
          const [x, y] = at(e);
          const next = pts.map((p) => [...p] as CurvePoint);
          const i = drag.current;
          const lo = i > 0 ? next[i - 1][0] + 0.01 : 0;
          const hi = i < next.length - 1 ? next[i + 1][0] - 0.01 : 1;
          next[i] = [i === 0 ? 0 : i === next.length - 1 ? 1 : Math.min(hi, Math.max(lo, x)), y];
          set(next);
        }}
        onPointerUp={() => {
          if (drag.current != null) endGesture('Curves');
          drag.current = null;
        }}
        onDoubleClick={(e) => {
          const [x, y] = at(e as unknown as React.PointerEvent);
          const i = pts.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 0.05);
          if (i > 0 && i < pts.length - 1) {
            beginGesture();
            set(pts.filter((_, k) => k !== i));
            endGesture('Remove Curve Point');
          }
        }}
      />
    </div>
  );
}

// ---------- colour wheels ----------
function WheelControl({ label, value, onLive }: { label: string; value: ColorWheel; onLive: (w: ColorWheel) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const R = 46;
  const move = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    let x = (e.clientX - r.left - R) / R;
    let y = -(e.clientY - r.top - R) / R;
    const d = Math.hypot(x, y);
    if (d > 1) (x /= d), (y /= d);
    onLive({ ...value, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
  };
  const [r, g, b] = wheelOffset(value);
  const tintCss = `rgb(${Math.round(128 + r * 127)},${Math.round(128 + g * 127)},${Math.round(128 + b * 127)})`;
  return (
    <div className="cp-wheel">
      <div
        ref={ref}
        className="cp-wheel-disc"
        style={{ width: R * 2, height: R * 2 }}
        title="Drag to push the colour, double-click to reset"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          beginGesture();
          move(e);
        }}
        onPointerMove={(e) => e.buttons && move(e)}
        onPointerUp={() => endGesture(`${label} Wheel`)}
        onDoubleClick={() => (beginGesture(), onLive({ x: 0, y: 0, luma: value.luma }), endGesture(`Reset ${label} Wheel`))}
      >
        <span className="cp-puck" style={{ left: R + value.x * R - 5, top: R - value.y * R - 5, background: tintCss }} />
      </div>
      <input
        type="range"
        className="ec-slider"
        min={-100}
        max={100}
        value={value.luma}
        title="Brightness of this range"
        onPointerDown={beginGesture}
        onChange={(e) => onLive({ ...value, luma: Number(e.target.value) })}
        onPointerUp={() => endGesture(`${label} Brightness`)}
        onDoubleClick={() => (beginGesture(), onLive({ ...value, luma: 0 }), endGesture(`Reset ${label} Brightness`))}
      />
      <div className="cp-wheel-label">{label}</div>
    </div>
  );
}

// ---------- scopes ----------
type ScopeMode = 'waveform' | 'parade' | 'vectorscope' | 'histogram';

function Scopes() {
  const [mode, setMode] = useState<ScopeMode>(() => (localStorage.getItem('icut-scope') as ScopeMode) || 'waveform');
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem('icut-scope', mode);
    } catch {}
  }, [mode]);
  useEffect(() => {
    if (!open) return;
    const sw = 192;
    const small = document.createElement('canvas');
    const sg = small.getContext('2d', { willReadFrequently: true })!;
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 80) return;
      last = now;
      const src = engine.comp?.canvas;
      const out = ref.current;
      if (!src || !out || !src.width) return;
      const sh = Math.max(1, Math.round((sw * src.height) / src.width));
      if (small.width !== sw || small.height !== sh) (small.width = sw), (small.height = sh);
      sg.drawImage(src, 0, 0, sw, sh);
      renderScope(out, sg.getImageData(0, 0, sw, sh), mode);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [mode, open]);
  return (
    <div className="cp-scopes">
      <div className="cp-scope-bar">
        <button className="icon-btn sm" onClick={() => setOpen(!open)} title={open ? 'Hide scopes' : 'Show scopes'}>
          <Icon name={open ? 'chevronDown' : 'chevron'} size={11} />
        </button>
        <span className="cp-sub" style={{ padding: 0 }}>
          Scopes
        </span>
        <span className="grow" />
        {(['waveform', 'parade', 'vectorscope', 'histogram'] as ScopeMode[]).map((m) => (
          <button key={m} className={'chip' + (m === mode ? ' on' : '')} onClick={() => setMode(m)}>
            {m === 'waveform' ? 'Waveform' : m === 'parade' ? 'RGB Parade' : m === 'vectorscope' ? 'Vectorscope' : 'Histogram'}
          </button>
        ))}
      </div>
      {open && <canvas ref={ref} width={384} height={200} className="cp-scope" />}
    </div>
  );
}

function renderScope(out: HTMLCanvasElement, img: ImageData, mode: ScopeMode) {
  const W = out.width;
  const H = out.height;
  const g = out.getContext('2d')!;
  const acc = new Float32Array(W * H * 3);
  const d = img.data;
  const iw = img.width;
  const add = (x: number, y: number, r: number, gg: number, b: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = ((y | 0) * W + (x | 0)) * 3;
    acc[i] += r;
    acc[i + 1] += gg;
    acc[i + 2] += b;
  };
  if (mode === 'histogram') {
    const bins = [new Float32Array(256), new Float32Array(256), new Float32Array(256)];
    for (let i = 0; i < d.length; i += 4) {
      bins[0][d[i]]++;
      bins[1][d[i + 1]]++;
      bins[2][d[i + 2]]++;
    }
    const max = Math.max(...bins.map((b) => Math.max(...b.slice(2, 254)))) || 1;
    g.fillStyle = '#101010';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    ['rgba(255,70,70,0.7)', 'rgba(70,220,90,0.7)', 'rgba(80,130,255,0.7)'].forEach((col, ch) => {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(0, H);
      for (let v = 0; v < 256; v++) g.lineTo((v / 255) * W, H - Math.min(1, bins[ch][v] / max) * (H - 4));
      g.lineTo(W, H);
      g.fill();
    });
    g.globalCompositeOperation = 'source-over';
    return;
  }
  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % iw;
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
    if (mode === 'waveform') {
      const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      add((px / iw) * W, (1 - l) * (H - 1), 1, 1, 1);
    } else if (mode === 'parade') {
      const third = W / 3;
      add((px / iw) * third, (1 - r) * (H - 1), 1, 0.25, 0.25);
      add(third + (px / iw) * third, (1 - gg) * (H - 1), 0.25, 1, 0.25);
      add(2 * third + (px / iw) * third, (1 - b) * (H - 1), 0.25, 0.35, 1);
    } else {
      const cb = -0.1146 * r - 0.3854 * gg + 0.5 * b;
      const cr = 0.5 * r - 0.4542 * gg - 0.0458 * b;
      add(W / 2 + cb * H * 0.9, H / 2 - cr * H * 0.9, r * 0.6 + 0.4, gg * 0.6 + 0.4, b * 0.6 + 0.4);
    }
  }
  const out8 = g.createImageData(W, H);
  const gain = mode === 'vectorscope' ? 40 : 14;
  for (let i = 0, j = 0; i < acc.length; i += 3, j += 4) {
    out8.data[j] = Math.min(255, 16 + Math.log1p(acc[i]) * gain * 4);
    out8.data[j + 1] = Math.min(255, 16 + Math.log1p(acc[i + 1]) * gain * 4);
    out8.data[j + 2] = Math.min(255, 16 + Math.log1p(acc[i + 2]) * gain * 4);
    out8.data[j + 3] = 255;
  }
  g.putImageData(out8, 0, 0);
  // graticule
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.font = '9px sans-serif';
  if (mode === 'vectorscope') {
    g.beginPath();
    g.arc(W / 2, H / 2, H * 0.45, 0, Math.PI * 2);
    g.moveTo(W / 2 - H * 0.45, H / 2);
    g.lineTo(W / 2 + H * 0.45, H / 2);
    g.moveTo(W / 2, 0);
    g.lineTo(W / 2, H);
    g.stroke();
    // skin-tone line (about 123°)
    g.strokeStyle = 'rgba(255,190,120,0.35)';
    g.beginPath();
    g.moveTo(W / 2, H / 2);
    g.lineTo(W / 2 + Math.cos((123 * Math.PI) / 180) * H * 0.45, H / 2 - Math.sin((123 * Math.PI) / 180) * H * 0.45);
    g.stroke();
  } else {
    for (const v of [0, 25, 50, 75, 100]) {
      const y = (1 - v / 100) * (H - 1);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
      g.fillText(String(v), 2, Math.max(9, y - 1));
    }
  }
}
