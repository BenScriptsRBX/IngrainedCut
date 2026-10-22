import React, { useState } from 'react';
import type { Clip, Project, TransitionType } from '../types';
import { S, commit, setS, toast } from '../store';
import { applyTransition, withLinks } from '../actions';
import { Icon } from './Icons';

export interface EffectPreset {
  id: string;
  label: string;
  category: string;
  audio: boolean;
  apply: (c: Clip, p?: Project) => void;
}

const fx = (patch: Partial<Clip['fx']>) => (c: Clip) => void (c.fx = { ...c.fx, ...patch });

export const EFFECT_PRESETS: EffectPreset[] = [
  { id: 'bc', label: 'Brightness & Contrast', category: 'Color Correction', audio: false, apply: fx({ brightness: 10, contrast: 15 }) },
  { id: 'warm', label: 'Look: Warm', category: 'Color Correction', audio: false, apply: fx({ temperature: 35, saturation: 112 }) },
  { id: 'cool', label: 'Look: Cool', category: 'Color Correction', audio: false, apply: fx({ temperature: -35, saturation: 105 }) },
  { id: 'punchy', label: 'Look: Punchy', category: 'Color Correction', audio: false, apply: fx({ contrast: 25, saturation: 130 }) },
  { id: 'faded', label: 'Look: Faded Film', category: 'Color Correction', audio: false, apply: fx({ contrast: -18, saturation: 80, sepia: 15, brightness: 5 }) },
  { id: 'teal', label: 'Look: Teal & Orange', category: 'Color Correction', audio: false, apply: fx({ temperature: 18, tint: -12, contrast: 18, saturation: 118 }) },
  { id: 'bw', label: 'Black & White', category: 'Image Control', audio: false, apply: fx({ saturation: 0 }) },
  { id: 'sepia', label: 'Sepia', category: 'Image Control', audio: false, apply: fx({ sepia: 80 }) },
  { id: 'invert', label: 'Invert', category: 'Channel', audio: false, apply: fx({ invert: 100 }) },
  { id: 'vignette', label: 'Vignette', category: 'Stylize', audio: false, apply: fx({ vignette: 55 }) },
  { id: 'blur', label: 'Gaussian Blur', category: 'Blur & Sharpen', audio: false, apply: fx({ blur: 10 }) },
  { id: 'keyg', label: 'Chroma Key (Green)', category: 'Keying', audio: false, apply: (c) => void (c.chromaKey = { enabled: true, color: '#00ff00', tolerance: 30, softness: 15 }) },
  { id: 'keyb', label: 'Chroma Key (Blue)', category: 'Keying', audio: false, apply: (c) => void (c.chromaKey = { enabled: true, color: '#0040ff', tolerance: 30, softness: 15 }) },
  { id: 'zoom120', label: 'Punch-in 120%', category: 'Transform', audio: false, apply: (c) => void (c.transform = { ...c.transform, scale: 120 }) },
  {
    id: 'pip', label: 'Picture in Picture', category: 'Transform', audio: false,
    apply: (c, p) => void (c.transform = { ...c.transform, scale: 33, x: (p?.settings.width ?? 1920) * 0.3, y: -(p?.settings.height ?? 1080) * 0.28 }),
  },
  {
    id: 'kenburns', label: 'Ken Burns (slow zoom)', category: 'Presets', audio: false,
    apply: (c) => void (c.keyframes = { ...(c.keyframes || {}), scale: [{ t: 0, v: 100, ease: 'linear' }, { t: c.duration, v: 115, ease: 'linear' }] }),
  },
  { id: 'fadeio', label: 'Fade In / Out (0.5s)', category: 'Presets', audio: false, apply: (c) => void ((c.fadeIn = 0.5), (c.fadeOut = 0.5)) },
  { id: 'gain6', label: 'Gain +6 dB', category: 'Amplitude', audio: true, apply: (c) => void (c.volume = Math.min(15, c.volume + 6)) },
  { id: 'gainm6', label: 'Gain −6 dB', category: 'Amplitude', audio: true, apply: (c) => void (c.volume = Math.max(-60, c.volume - 6)) },
  { id: 'afade', label: 'Fade In / Out (1s)', category: 'Amplitude', audio: true, apply: (c) => void ((c.fadeIn = 1), (c.fadeOut = 1)) },
  { id: 'panl', label: 'Pan Left', category: 'Stereo', audio: true, apply: (c) => void (c.pan = -80) },
  { id: 'panr', label: 'Pan Right', category: 'Stereo', audio: true, apply: (c) => void (c.pan = 80) },
  { id: 'duck', label: 'Duck (−12 dB)', category: 'Amplitude', audio: true, apply: (c) => void (c.volume = -12) },
];

export const TRANSITIONS: { type: TransitionType; label: string; category: string }[] = [
  { type: 'cross-dissolve', label: 'Cross Dissolve', category: 'Dissolve' },
  { type: 'dip-to-black', label: 'Dip to Black', category: 'Dissolve' },
  { type: 'dip-to-white', label: 'Dip to White', category: 'Dissolve' },
  { type: 'blur-dissolve', label: 'Blur Dissolve', category: 'Dissolve' },
  { type: 'wipe-left', label: 'Wipe Left', category: 'Wipe' },
  { type: 'wipe-right', label: 'Wipe Right', category: 'Wipe' },
  { type: 'slide-left', label: 'Slide Left', category: 'Slide' },
  { type: 'slide-right', label: 'Slide Right', category: 'Slide' },
  { type: 'push-left', label: 'Push', category: 'Slide' },
  { type: 'zoom-in', label: 'Zoom In', category: 'Zoom' },
];

export function applyPresetToSelection(id: string) {
  const s = S();
  const preset = EFFECT_PRESETS.find((p) => p.id === id)!;
  const targets = s.project.clips.filter((c) => s.selection.includes(c.id) && (c.kind === 'audio') === preset.audio);
  if (!targets.length) return toast(`Select ${preset.audio ? 'an audio' : 'a video'} clip first, or drag the effect onto a clip`, 'info');
  commit(`Apply ${preset.label}`, (d) => {
    for (const c of d.clips) if (targets.some((t) => t.id === c.id)) preset.apply(c, d);
  });
  setS({ leftTab: 'effectControls' });
}

function Folder({ title, children, open: o = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(o);
  return (
    <div className="fx-folder">
      <div className="fx-folder-head" onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevronDown' : 'chevron'} size={11} />
        <Icon name="folder" size={13} />
        {title}
      </div>
      {open && <div className="fx-folder-body">{children}</div>}
    </div>
  );
}

function Item({ label, data, onApply, icon = 'wand' }: { label: string; data: object; onApply: () => void; icon?: string }) {
  return (
    <div
      className="fx-item"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-icut-effect', JSON.stringify(data));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDoubleClick={onApply}
      title="Drag onto a clip, or double-click to apply to the selected clip"
    >
      <Icon name={icon} size={12} />
      {label}
    </div>
  );
}

export function EffectsPanel() {
  const [q, setQ] = useState('');
  const match = (l: string) => !q || l.toLowerCase().includes(q.toLowerCase());
  const group = (audio: boolean) => {
    const cats = [...new Set(EFFECT_PRESETS.filter((p) => p.audio === audio).map((p) => p.category))];
    return cats.map((cat) => {
      const items = EFFECT_PRESETS.filter((p) => p.audio === audio && p.category === cat && match(p.label));
      if (!items.length) return null;
      return (
        <Folder key={cat} title={cat} open={!!q}>
          {items.map((p) => (
            <Item key={p.id} label={p.label} data={{ kind: 'effect', id: p.id }} onApply={() => applyPresetToSelection(p.id)} />
          ))}
        </Folder>
      );
    });
  };
  const trans = (audio: boolean) => {
    const cats = [...new Set(TRANSITIONS.map((t) => t.category))];
    return cats.map((cat) => {
      const items = TRANSITIONS.filter((t) => t.category === cat && match(t.label));
      if (!items.length) return null;
      return (
        <Folder key={cat} title={cat} open={!!q}>
          {items.map((t) => (
            <Item
              key={t.type}
              icon="layers"
              label={t.label}
              data={{ kind: 'transition', type: t.type, audio }}
              onApply={() => {
                const s = S();
                if (!s.selection.length) return toast('Select a clip, or drag the transition onto a clip edge', 'info');
                applyTransition(withLinks(s.selection).filter((id) => s.project.clips.find((c) => c.id === id)!.kind !== 'audio'), 'in', t.type, 1);
              }}
            />
          ))}
        </Folder>
      );
    });
  };
  return (
    <div className="effects-panel">
      <div className="search-row">
        <Icon name="search" size={13} />
        <input placeholder="Search effects" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      <div className="fx-tree">
        <Folder title="Video Effects" open>
          {group(false)}
        </Folder>
        <Folder title="Video Transitions" open>
          {trans(false)}
        </Folder>
        <Folder title="Audio Effects">{group(true)}</Folder>
        <Folder title="Audio Transitions">
          <Folder title="Crossfade" open>
            <Item
              label="Constant Power"
              icon="layers"
              data={{ kind: 'transition', type: 'cross-dissolve', audio: true }}
              onApply={() => {
                const s = S();
                applyTransition(withLinks(s.selection).filter((id) => s.project.clips.find((c) => c.id === id)!.kind === 'audio'), 'in', 'cross-dissolve', 1);
              }}
            />
          </Folder>
        </Folder>
      </div>
    </div>
  );
}
