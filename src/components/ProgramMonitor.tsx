import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { S, setS, useEditor, beginGesture, gesture, endGesture } from '../store';
import { engine } from '../engine';
import { layersAt } from '../compositor';
import { sequenceDuration, clipEnd } from '../ops';
import { fmtTC, parseTC } from '../time';
import { Icon } from './Icons';
import { exportFrame, goToEdit, liftExtract, setInOut, stepFrames, addTextAt } from '../actions';

export function ProgramMonitor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const settings = useEditor((s) => s.project.settings);
  const showSafe = useEditor((s) => s.showSafe);
  const previewScale = useEditor((s) => s.previewScale);
  const [box, setBox] = useState({ w: 640, h: 360, x: 0, y: 0 });

  useEffect(() => {
    engine.attach(canvasRef.current!);
  }, []);

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const fit = () => {
      const W = el.clientWidth - 16;
      const H = el.clientHeight - 16;
      const ar = settings.width / settings.height;
      let w = W;
      let h = W / ar;
      if (h > H) {
        h = H;
        w = H * ar;
      }
      setBox({ w, h, x: (el.clientWidth - w) / 2, y: (el.clientHeight - h) / 2 });
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [settings.width, settings.height]);

  return (
    <div className="monitor program">
      <div className="monitor-view" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="monitor-canvas"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
          onDoubleClick={() => S().tool === 'type' && addTextAt()}
        />
        <TransformOverlay box={box} />
        {showSafe && (
          <div className="safe" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
            <div className="safe-action" />
            <div className="safe-title" />
          </div>
        )}
        <ClaudeBadge />
      </div>
      <MonitorBar
        right={
          <select className="mini-select" value={previewScale} onChange={(e) => setS({ previewScale: Number(e.target.value) })} title="Playback Resolution">
            <option value={1}>Full</option>
            <option value={0.5}>1/2</option>
            <option value={0.25}>1/4</option>
          </select>
        }
      />
      <Transport />
    </div>
  );
}

function ClaudeBadge() {
  const flash = useEditor((s) => s.flash);
  const last = Math.max(0, ...Object.values(flash));
  const [, tick] = useState(0);
  useEffect(() => {
    if (Date.now() - last < 2000) {
      const t = setTimeout(() => tick((x) => x + 1), 2000);
      return () => clearTimeout(t);
    }
  }, [last]);
  if (Date.now() - last > 2000) return null;
  return (
    <div className="claude-badge">
      <Icon name="sparkle" size={12} /> Claude edited the timeline
    </div>
  );
}

function MonitorBar({ right }: { right?: React.ReactNode }) {
  const playhead = useEditor((s) => s.playhead);
  const project = useEditor((s) => s.project);
  const fps = project.settings.fps;
  const dur = sequenceDuration(project);
  const [edit, setEdit] = useState<string | null>(null);
  return (
    <div className="monitor-bar">
      {edit != null ? (
        <input
          className="tc-input"
          autoFocus
          value={edit}
          onChange={(e) => setEdit(e.target.value)}
          onBlur={() => setEdit(null)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              const t = parseTC(edit, fps, playhead);
              if (t != null) engine.seek(t);
              setEdit(null);
            }
            if (e.key === 'Escape') setEdit(null);
          }}
        />
      ) : (
        <span className="tc" onClick={() => setEdit(fmtTC(playhead, fps))}>
          {fmtTC(playhead, fps)}
        </span>
      )}
      <span className="grow" />
      {right}
      <span className="tc dim">{fmtTC(dur, fps)}</span>
    </div>
  );
}

function Transport() {
  const playing = useEditor((s) => s.playing);
  return (
    <div className="transport">
      <button className="icon-btn" title="Mark In (I)" onClick={() => setInOut('in')}>
        <Icon name="markIn" />
      </button>
      <button className="icon-btn" title="Mark Out (O)" onClick={() => setInOut('out')}>
        <Icon name="markOut" />
      </button>
      <span className="sep" />
      <button className="icon-btn" title="Go to Previous Edit (Up)" onClick={() => goToEdit(-1)}>
        <Icon name="toIn" />
      </button>
      <button className="icon-btn" title="Step Back 1 Frame (Left)" onClick={() => stepFrames(-1)}>
        <Icon name="stepBack" />
      </button>
      <button className="icon-btn play" title="Play/Stop (Space)" onClick={() => engine.toggle()}>
        <Icon name={playing ? 'pause' : 'play'} size={18} />
      </button>
      <button className="icon-btn" title="Step Forward 1 Frame (Right)" onClick={() => stepFrames(1)}>
        <Icon name="stepFwd" />
      </button>
      <button className="icon-btn" title="Go to Next Edit (Down)" onClick={() => goToEdit(1)}>
        <Icon name="toOut" />
      </button>
      <span className="sep" />
      <button className="icon-btn" title="Lift (;)" onClick={() => liftExtract(false)}>
        <Icon name="lift" />
      </button>
      <button className="icon-btn" title="Extract (')" onClick={() => liftExtract(true)}>
        <Icon name="extract" />
      </button>
      <button className="icon-btn" title="Export Frame" onClick={exportFrame}>
        <Icon name="camera" />
      </button>
      <button className={'icon-btn' + (S().showSafe ? ' on' : '')} title="Safe Margins" onClick={() => setS({ showSafe: !S().showSafe })}>
        <Icon name="safe" />
      </button>
    </div>
  );
}

/** Direct manipulation of the selected visual clip's position/scale in the program monitor. */
function TransformOverlay({ box }: { box: { w: number; h: number; x: number; y: number } }) {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const drag = useRef<{ mode: 'move' | 'scale'; x0: number; y0: number; tx: number; ty: number; sc: number; cx: number; cy: number; d0: number } | null>(null);
  if (playing || !engine.comp) return null;
  const k = box.w / project.settings.width;
  const visible = layersAt(project, playhead).map((l) => l.clip);
  const c = [...visible].reverse().find((x) => selection.includes(x.id) && x.kind !== 'adjustment');
  const onBgDown = (e: React.PointerEvent) => {
    // click in monitor selects the top-most visual clip under the cursor
    const px = (e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left) / k;
    const py = (e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top) / k;
    const hit = [...visible].reverse().find((x) => {
      const b = engine.comp!.bounds(project, x, playhead);
      return b && Math.abs(px - b.cx) <= b.w / 2 && Math.abs(py - b.cy) <= b.h / 2;
    });
    setS({ selection: hit ? [hit.id] : [] });
  };
  const b = c ? engine.comp.bounds(project, c, playhead) : null;
  const start = (e: React.PointerEvent, mode: 'move' | 'scale') => {
    if (!c || !b) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const r = (e.currentTarget as HTMLElement).closest('.xform-layer')!.getBoundingClientRect();
    const cx = r.left + b.cx * k;
    const cy = r.top + b.cy * k;
    drag.current = { mode, x0: e.clientX, y0: e.clientY, tx: c.transform.x, ty: c.transform.y, sc: c.transform.scale, cx, cy, d0: Math.hypot(e.clientX - cx, e.clientY - cy) };
    beginGesture();
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !c) return;
    gesture((p) => {
      const cl = p.clips.find((x) => x.id === c.id)!;
      if (d.mode === 'move') {
        let nx = d.tx + (e.clientX - d.x0) / k;
        let ny = d.ty + (e.clientY - d.y0) / k;
        if (!e.shiftKey) {
          if (Math.abs(nx) < 8 / k) nx = 0;
          if (Math.abs(ny) < 8 / k) ny = 0;
        }
        cl.transform = { ...cl.transform, x: Math.round(nx), y: Math.round(ny) };
      } else {
        const dist = Math.hypot(e.clientX - d.cx, e.clientY - d.cy);
        cl.transform = { ...cl.transform, scale: Math.max(1, Math.round((d.sc * dist) / Math.max(1, d.d0) * 10) / 10) };
      }
    });
  };
  const up = () => {
    if (drag.current) endGesture(drag.current.mode === 'move' ? 'Position' : 'Scale');
    drag.current = null;
  };
  return (
    <div className="xform-layer" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} onPointerDown={onBgDown} onPointerMove={move} onPointerUp={up}>
      {c && b && (
        <div
          className="xform-box"
          style={{ left: (b.cx - b.w / 2) * k, top: (b.cy - b.h / 2) * k, width: b.w * k, height: b.h * k, transform: `rotate(${b.rot}deg)` }}
          onPointerDown={(e) => start(e, 'move')}
          onDoubleClick={() => c.kind === 'text' && setS({ leftTab: 'effectControls' })}
        >
          {['nw', 'ne', 'sw', 'se'].map((h) => (
            <div key={h} className={'xform-h ' + h} onPointerDown={(e) => start(e, 'scale')} />
          ))}
          <div className="xform-anchor" />
        </div>
      )}
    </div>
  );
}

void clipEnd;
