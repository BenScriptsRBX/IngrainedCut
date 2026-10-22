import React, { useEffect, useRef } from 'react';
import type { ToolId } from '../types';
import { useEditor, setS, commit, revertTo } from '../store';
import { tracksOf, trackLabel } from '../ops';
import { engine } from '../engine';
import { Icon } from './Icons';

const TOOLS: { id: ToolId; icon: string; label: string; key: string }[] = [
  { id: 'select', icon: 'select', label: 'Selection Tool', key: 'V' },
  { id: 'trackfwd', icon: 'trackfwd', label: 'Track Select Forward Tool', key: 'A' },
  { id: 'ripple', icon: 'ripple', label: 'Ripple Edit Tool', key: 'B' },
  { id: 'rolling', icon: 'rolling', label: 'Rolling Edit Tool', key: 'N' },
  { id: 'rate', icon: 'rate', label: 'Rate Stretch Tool', key: 'R' },
  { id: 'razor', icon: 'razor', label: 'Razor Tool', key: 'C' },
  { id: 'slip', icon: 'slip', label: 'Slip Tool', key: 'Y' },
  { id: 'slide', icon: 'slide', label: 'Slide Tool', key: 'U' },
  { id: 'hand', icon: 'hand', label: 'Hand Tool', key: 'H' },
  { id: 'type', icon: 'type', label: 'Type Tool', key: 'T' },
];

export function ToolsStrip() {
  const tool = useEditor((s) => s.tool);
  return (
    <div className="tools-strip">
      {TOOLS.map((t) => (
        <button key={t.id} className={'tool-btn' + (tool === t.id ? ' on' : '')} title={`${t.label} (${t.key})`} onClick={() => setS({ tool: t.id })}>
          <Icon name={t.icon} size={16} />
        </button>
      ))}
    </div>
  );
}

export const TOOL_HINT: Record<ToolId, string> = {
  select: 'Click to select, drag to move (Ctrl = insert, Alt = duplicate). Drag clip edges to trim.',
  trackfwd: 'Click a clip to select it and everything after it on the track (Shift: all tracks).',
  ripple: 'Drag a clip edge to trim and shift everything after it.',
  rolling: 'Drag an edit point to move the cut between two adjacent clips.',
  rate: 'Drag a clip edge to change its speed to fit the new duration.',
  razor: 'Click to cut a clip (Shift: all tracks). Snaps to the playhead.',
  slip: 'Drag a clip to change which part of the source it shows.',
  slide: 'Drag a clip left/right, trimming its neighbours to keep the gap closed.',
  hand: 'Drag to scroll the timeline.',
  type: 'Click in the timeline or program monitor to add a text layer.',
};

export function AudioMeters() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const peak = [0, 0];
    const hold = [0, 0];
    const holdT = [0, 0];
    const draw = () => {
      const cv = ref.current;
      if (cv) {
        const w = (cv.width = cv.clientWidth);
        const h = (cv.height = cv.clientHeight);
        const g = cv.getContext('2d')!;
        g.clearRect(0, 0, w, h);
        const a = engine.audio;
        const now = performance.now();
        const bw = (w - 26) / 2 - 2;
        for (let i = 0; i < 2; i++) {
          const lvl = a ? a.level(i === 0 ? 'L' : 'R') : 0;
          peak[i] = Math.max(lvl, peak[i] * 0.9);
          if (lvl >= hold[i] || now - holdT[i] > 1200) {
            hold[i] = lvl;
            holdT[i] = now;
          }
          const db = 20 * Math.log10(Math.max(1e-5, peak[i]));
          const n = Math.max(0, Math.min(1, (db + 60) / 60));
          const x = 2 + i * (bw + 3);
          const grad = g.createLinearGradient(0, h, 0, 0);
          grad.addColorStop(0, '#1f9d55');
          grad.addColorStop(0.75, '#2ecc71');
          grad.addColorStop(0.87, '#f1c40f');
          grad.addColorStop(1, '#e74c3c');
          g.fillStyle = '#101010';
          g.fillRect(x, 0, bw, h);
          g.fillStyle = grad;
          g.fillRect(x, h - n * h, bw, n * h);
          const hdb = 20 * Math.log10(Math.max(1e-5, hold[i]));
          const hn = Math.max(0, Math.min(1, (hdb + 60) / 60));
          if (hn > 0) {
            g.fillStyle = hdb > -0.5 ? '#ff4d4d' : '#e8e8e8';
            g.fillRect(x, h - hn * h, bw, 2);
          }
        }
        g.fillStyle = '#7d7d7d';
        g.font = '9px Segoe UI';
        for (const db of [0, -6, -12, -18, -24, -30, -36, -42, -48, -54]) {
          const y = h - ((db + 60) / 60) * h;
          g.fillText(String(db), w - 20, Math.max(8, y + 3));
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="meters">
      <canvas ref={ref} />
      <div className="meters-foot">
        <span>L</span>
        <span>R</span>
      </div>
    </div>
  );
}

export function AudioMixer() {
  const project = useEditor((s) => s.project);
  const tracks = tracksOf(project, 'audio');
  const set = (id: string, patch: any, label: string) => commit(label, (d) => Object.assign(d.tracks.find((t) => t.id === id)!, patch));
  return (
    <div className="mixer">
      {tracks.map((t) => (
        <div key={t.id} className="mix-strip">
          <div className="mix-name">{trackLabel(project, t)}</div>
          <div className="mix-db">{t.volume.toFixed(1)} dB</div>
          <input
            className="mix-fader"
            type="range"
            min={-60}
            max={12}
            step={0.1}
            value={t.volume}
            onChange={(e) => setS((s) => ({ project: { ...s.project, tracks: s.project.tracks.map((x) => (x.id === t.id ? { ...x, volume: Number(e.target.value) } : x)) } }))}
            onPointerUp={(e) => set(t.id, { volume: Number((e.target as HTMLInputElement).value) }, 'Track Volume')}
            onDoubleClick={() => set(t.id, { volume: 0 }, 'Reset Track Volume')}
          />
          <div className="mix-btns">
            <button className={'tl-ms' + (t.muted ? ' mute' : '')} onClick={() => set(t.id, { muted: !t.muted }, 'Mute Track')}>
              M
            </button>
            <button className={'tl-ms' + (t.solo ? ' solo' : '')} onClick={() => set(t.id, { solo: !t.solo }, 'Solo Track')}>
              S
            </button>
          </div>
        </div>
      ))}
      <div className="mix-strip master">
        <div className="mix-name">Mix</div>
        <AudioMeters />
      </div>
    </div>
  );
}

export function HistoryPanel() {
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  return (
    <div className="history">
      <div className="hist-item" onClick={() => revertTo(0)}>
        <Icon name="folder" size={12} /> Open
      </div>
      {past.map((h, i) => (
        <div key={i} className={'hist-item' + (h.by === 'claude' ? ' claude' : '')} onClick={() => revertTo(i + 1)}>
          {h.by === 'claude' ? <Icon name="sparkle" size={11} /> : <Icon name="chevron" size={11} />} {h.label}
        </div>
      ))}
      <div className="hist-item current">● Current state</div>
      {future.map((h, i) => (
        <div key={'f' + i} className="hist-item future">
          {h.label}
        </div>
      ))}
    </div>
  );
}
