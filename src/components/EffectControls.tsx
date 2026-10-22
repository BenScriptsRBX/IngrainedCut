import React from 'react';
import type { Clip, KeyProp, TransitionType, BlendMode } from '../types';
import { useEditor, beginGesture, gesture, endGesture, commit, setS } from '../store';
import { propAt, upsertKeyframe, DEFAULT_FX, DEFAULT_TRANSFORM, mediaOf, clipEnd, setClipSpeed } from '../ops';
import { ScrubNumber, Section, ColorSwatch } from './Widgets';
import { Icon } from './Icons';
import { TRANSITIONS } from './EffectsPanel';
import { fmtTC } from '../time';

const FONTS = ['Inter, Segoe UI, Arial, sans-serif', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Impact', 'Verdana', 'Trebuchet MS', 'Courier New', 'Segoe UI', 'Bahnschrift', 'Consolas', 'Comic Sans MS'];

export function EffectControls() {
  const selection = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const sel = project.clips.filter((c) => selection.includes(c.id));
  const c = sel.find((x) => x.kind !== 'audio') ?? sel[0];
  if (!c)
    return (
      <div className="ec empty">
        <div className="empty-hint">
          <Icon name="wand" size={26} />
          <div>Select a clip in the timeline to edit its effects.</div>
        </div>
      </div>
    );
  const local = Math.min(Math.max(0, playhead - c.start), c.duration);
  const inClip = playhead >= c.start && playhead <= clipEnd(c);
  const media = mediaOf(project, c);
  const id = c.id;

  const live = (fn: (cl: Clip) => void) => gesture((d) => fn(d.clips.find((x) => x.id === id)!));
  const once = (label: string, fn: (cl: Clip) => void) => commit(label, (d) => fn(d.clips.find((x) => x.id === id)!));

  const animating = (p: KeyProp) => !!c.keyframes?.[p]?.length;
  const keyToggle = (p: KeyProp) => (
    <button
      className={'kf-btn' + (animating(p) ? ' on' : '')}
      title={animating(p) ? 'Turn off animation (removes keyframes)' : 'Toggle animation — adds a keyframe at the playhead'}
      onClick={() =>
        once(animating(p) ? 'Remove Keyframes' : 'Add Keyframe', (cl) => {
          if (animating(p)) delete cl.keyframes![p];
          else upsertKeyframe(cl, p, local, propAt(cl, p, local));
        })
      }
    >
      <Icon name="stopwatch" size={12} />
    </button>
  );
  const kfNav = (p: KeyProp) =>
    animating(p) ? (
      <span className="kf-nav">
        <button
          className="kf-add"
          title="Add/Remove keyframe at playhead"
          onClick={() =>
            once('Keyframe', (cl) => {
              const list = cl.keyframes![p]!;
              const hit = list.find((k) => Math.abs(k.t - local) < 0.5 / project.settings.fps);
              if (hit) cl.keyframes![p] = list.filter((k) => k !== hit);
              else upsertKeyframe(cl, p, local, propAt(cl, p, local));
            })
          }
        >
          <Icon name="diamond" size={9} />
        </button>
        <span className="dim tiny">{c.keyframes![p]!.length}</span>
      </span>
    ) : null;

  const numRow = (label: string, p: KeyProp, opts: { step?: number; min?: number; max?: number; precision?: number; suffix?: string } = {}) => {
    const v = propAt(c, p, local);
    return (
      <div className="ec-row">
        {keyToggle(p)}
        <span className="ec-label">{label}</span>
        <ScrubNumber
          value={v}
          {...opts}
          onBegin={beginGesture}
          onChange={(nv) =>
            live((cl) => {
              if (cl.keyframes?.[p]?.length) upsertKeyframe(cl, p, local, nv);
              else if (p === 'volume') cl.volume = nv;
              else cl.transform = { ...cl.transform, [p]: nv };
            })
          }
          onCommit={() => endGesture(label)}
        />
        {kfNav(p)}
      </div>
    );
  };

  const fxRow = (label: string, k: keyof Clip['fx'], min: number, max: number, step = 1) => (
    <div className="ec-row">
      <span className="kf-spacer" />
      <span className="ec-label">{label}</span>
      <ScrubNumber value={c.fx[k]} min={min} max={max} step={step} precision={step < 1 ? 1 : 0} onBegin={beginGesture} onChange={(v) => live((cl) => void (cl.fx = { ...cl.fx, [k]: v }))} onCommit={() => endGesture(label)} />
      <input
        type="range"
        className="ec-slider"
        min={min}
        max={max}
        step={step}
        value={c.fx[k]}
        onPointerDown={beginGesture}
        onChange={(e) => live((cl) => void (cl.fx = { ...cl.fx, [k]: Number(e.target.value) }))}
        onPointerUp={() => endGesture(label)}
      />
    </div>
  );

  const plainRow = (label: string, value: number, set: (cl: Clip, v: number) => void, opts: { step?: number; min?: number; max?: number; precision?: number; suffix?: string } = {}) => (
    <div className="ec-row">
      <span className="kf-spacer" />
      <span className="ec-label">{label}</span>
      <ScrubNumber value={value} {...opts} onBegin={beginGesture} onChange={(v) => live((cl) => set(cl, v))} onCommit={() => endGesture(label)} />
    </div>
  );

  const reset = (label: string, fn: (cl: Clip) => void) => (
    <button className="icon-btn sm" title={`Reset ${label}`} onClick={() => once(`Reset ${label}`, fn)}>
      <Icon name="reset" size={12} />
    </button>
  );

  const visual = c.kind !== 'audio';
  const sw = (on: boolean, label: string, fn: (cl: Clip) => void) => (
    <button className={'chip' + (on ? ' on' : '')} onClick={() => once(label, fn)}>
      {label}
    </button>
  );
  const trans = (edge: 'in' | 'out') => {
    const t = edge === 'in' ? c.transitionIn : c.transitionOut;
    return (
      <div className="ec-row">
        <span className="kf-spacer" />
        <span className="ec-label">{edge === 'in' ? 'Start' : 'End'}</span>
        <select
          className="mini-select"
          value={t?.type ?? ''}
          onChange={(e) =>
            once('Transition', (cl) => {
              const v = e.target.value as TransitionType | '';
              const tr = v ? { type: v, duration: t?.duration ?? Math.min(1, cl.duration) } : null;
              if (edge === 'in') cl.transitionIn = tr;
              else cl.transitionOut = tr;
            })
          }
        >
          <option value="">None</option>
          {TRANSITIONS.map((x) => (
            <option key={x.type} value={x.type}>
              {x.label}
            </option>
          ))}
        </select>
        {t && (
          <ScrubNumber
            value={t.duration}
            step={0.05}
            min={0.04}
            max={c.duration}
            precision={2}
            suffix="s"
            onBegin={beginGesture}
            onChange={(v) => live((cl) => void (edge === 'in' ? (cl.transitionIn = { ...cl.transitionIn!, duration: v }) : (cl.transitionOut = { ...cl.transitionOut!, duration: v })))}
            onCommit={() => endGesture('Transition Duration')}
          />
        )}
      </div>
    );
  };

  return (
    <div className="ec">
      <div className="ec-clip-head">
        <span className="ec-clip-title">
          {media ? media.name : c.kind === 'text' ? 'Graphic' : c.name} <span className="dim">· {c.id}</span>
        </span>
        <span className="dim tiny">
          {fmtTC(c.start, project.settings.fps)} – {fmtTC(clipEnd(c), project.settings.fps)}
        </span>
      </div>
      {!inClip && <div className="ec-note">Playhead is outside this clip — keyframe edits apply at the nearest edge.</div>}
      {sel.length > 1 && <div className="ec-note">{sel.length} clips selected — showing {c.id}</div>}

      {c.kind === 'text' && c.text && (
        <Section title="Text" fx>
          <textarea
            className="ec-text"
            value={c.text.content}
            onChange={(e) => {
              const v = e.target.value;
              commit('Edit Text', (d) => {
                const cl = d.clips.find((x) => x.id === id)!;
                cl.text = { ...cl.text!, content: v };
                cl.name = v.split('\n')[0].slice(0, 40) || 'Text';
              });
            }}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="ec-row">
            <span className="kf-spacer" />
            <select className="mini-select grow" value={c.text.font} onChange={(e) => once('Font', (cl) => void (cl.text = { ...cl.text!, font: e.target.value }))}>
              {[...new Set([c.text.font, ...FONTS])].map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>
                  {f.split(',')[0]}
                </option>
              ))}
            </select>
          </div>
          {plainRow('Font Size', c.text.size, (cl, v) => void (cl.text = { ...cl.text!, size: v }), { min: 4, max: 800, precision: 0 })}
          <div className="ec-row">
            <span className="kf-spacer" />
            <span className="ec-label">Style</span>
            {sw(c.text.bold, 'Bold', (cl) => void (cl.text = { ...cl.text!, bold: !cl.text!.bold }))}
            {sw(c.text.italic, 'Italic', (cl) => void (cl.text = { ...cl.text!, italic: !cl.text!.italic }))}
            {sw(c.text.shadow, 'Shadow', (cl) => void (cl.text = { ...cl.text!, shadow: !cl.text!.shadow }))}
          </div>
          <div className="ec-row">
            <span className="kf-spacer" />
            <span className="ec-label">Align</span>
            {(['left', 'center', 'right'] as const).map((a) => sw(c.text!.align === a, a[0].toUpperCase() + a.slice(1), (cl) => void (cl.text = { ...cl.text!, align: a })))}
          </div>
          <div className="ec-row">
            <span className="kf-spacer" />
            <span className="ec-label">Fill</span>
            <ColorSwatch value={c.text.color} onChange={(v) => once('Text Color', (cl) => void (cl.text = { ...cl.text!, color: v }))} />
          </div>
          <div className="ec-row">
            <span className="kf-spacer" />
            <span className="ec-label">Stroke</span>
            <ColorSwatch value={c.text.strokeColor} onChange={(v) => once('Stroke Color', (cl) => void (cl.text = { ...cl.text!, strokeColor: v }))} />
            <ScrubNumber value={c.text.strokeWidth} min={0} max={50} precision={0} onBegin={beginGesture} onChange={(v) => live((cl) => void (cl.text = { ...cl.text!, strokeWidth: v }))} onCommit={() => endGesture('Stroke Width')} />
          </div>
          <div className="ec-row">
            <span className="kf-spacer" />
            <span className="ec-label">Background</span>
            <ColorSwatch value={c.text.backgroundColor} onChange={(v) => once('Background', (cl) => void (cl.text = { ...cl.text!, backgroundColor: v, backgroundOpacity: cl.text!.backgroundOpacity || 60 }))} />
            <ScrubNumber value={c.text.backgroundOpacity} min={0} max={100} precision={0} suffix="%" onBegin={beginGesture} onChange={(v) => live((cl) => void (cl.text = { ...cl.text!, backgroundOpacity: v }))} onCommit={() => endGesture('Background Opacity')} />
          </div>
        </Section>
      )}

      {c.kind === 'color' && (
        <Section title="Color Matte">
          <div className="ec-row">
            <span className="kf-spacer" />
            <span className="ec-label">Color</span>
            <ColorSwatch value={c.color || '#000'} onChange={(v) => once('Matte Color', (cl) => void (cl.color = v))} />
          </div>
        </Section>
      )}

      {visual && c.kind !== 'adjustment' && (
        <Section title="Motion" fx right={reset('Motion', (cl) => void ((cl.transform = { ...DEFAULT_TRANSFORM, opacity: cl.transform.opacity }), cl.keyframes && (delete cl.keyframes.x, delete cl.keyframes.y, delete cl.keyframes.scale, delete cl.keyframes.rotation)))}>
          {numRow('Position X', 'x', { precision: 1 })}
          {numRow('Position Y', 'y', { precision: 1 })}
          {numRow('Scale', 'scale', { min: 0, max: 2000, precision: 1, step: 0.5 })}
          {numRow('Rotation', 'rotation', { precision: 1, suffix: '°' })}
        </Section>
      )}

      {visual && (
        <Section title="Opacity" fx>
          {numRow('Opacity', 'opacity', { min: 0, max: 100, precision: 1, suffix: '%' })}
          {c.kind !== 'adjustment' && (
            <div className="ec-row">
              <span className="kf-spacer" />
              <span className="ec-label">Blend Mode</span>
              <select className="mini-select" value={c.blend} onChange={(e) => once('Blend Mode', (cl) => void (cl.blend = e.target.value as BlendMode))}>
                {['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'add', 'difference'].map((b) => (
                  <option key={b} value={b}>
                    {b[0].toUpperCase() + b.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {plainRow('Fade In', c.fadeIn, (cl, v) => void (cl.fadeIn = v), { min: 0, max: c.duration, step: 0.05, precision: 2, suffix: 's' })}
          {plainRow('Fade Out', c.fadeOut, (cl, v) => void (cl.fadeOut = v), { min: 0, max: c.duration, step: 0.05, precision: 2, suffix: 's' })}
        </Section>
      )}

      {(c.kind === 'video' || c.kind === 'audio') && (
        <Section title="Time Remapping">
          <div className="ec-row">
            <span className="kf-spacer" />
            <span className="ec-label">Speed</span>
            <ScrubNumber value={c.speed * 100} min={5} max={2000} precision={1} suffix="%" onBegin={beginGesture} onChange={(v) => gesture((d) => setClipSpeed(d, id, v / 100))} onCommit={() => endGesture('Speed')} />
            <span className="dim tiny">{c.duration.toFixed(2)}s</span>
          </div>
        </Section>
      )}

      {visual && (
        <Section
          title="Basic Color"
          fx
          defaultOpen={c.kind === 'adjustment' || JSON.stringify(c.fx) !== JSON.stringify(DEFAULT_FX)}
          right={
            <>
              <button className="link-btn" title="Curves, wheels, looks, LUTs and scopes" onClick={() => setS({ leftTab: 'color' })}>
                Color Grading…
              </button>
              {reset('Color', (cl) => void (cl.fx = { ...DEFAULT_FX, blur: cl.fx.blur }))}
            </>
          }
        >
          {fxRow('Exposure', 'brightness', -100, 100)}
          {fxRow('Contrast', 'contrast', -100, 100)}
          {fxRow('Saturation', 'saturation', 0, 300)}
          {fxRow('Temperature', 'temperature', -100, 100)}
          {fxRow('Tint', 'tint', -100, 100)}
          {fxRow('Hue', 'hue', -180, 180)}
          {fxRow('Vignette', 'vignette', 0, 100)}
        </Section>
      )}

      {visual && (
        <Section title="Effects" fx defaultOpen={!!(c.fx.blur || c.fx.grayscale || c.fx.sepia || c.fx.invert)}>
          {fxRow('Gaussian Blur', 'blur', 0, 100, 0.5)}
          {fxRow('Black & White', 'grayscale', 0, 100)}
          {fxRow('Sepia', 'sepia', 0, 100)}
          {fxRow('Invert', 'invert', 0, 100)}
        </Section>
      )}

      {(c.kind === 'video' || c.kind === 'image' || c.kind === 'color') && (
        <Section title="Crop" fx defaultOpen={!!(c.crop.left || c.crop.right || c.crop.top || c.crop.bottom)}>
          {(['left', 'right', 'top', 'bottom'] as const).map((k) =>
            plainRow(k[0].toUpperCase() + k.slice(1), c.crop[k], (cl, v) => void (cl.crop = { ...cl.crop, [k]: v }), { min: 0, max: 100, precision: 1, suffix: '%' }),
          )}
        </Section>
      )}

      {(c.kind === 'video' || c.kind === 'image') && (
        <Section title="Chroma Key" fx defaultOpen={!!c.chromaKey?.enabled}>
          <div className="ec-row">
            <span className="kf-spacer" />
            <span className="ec-label">Enabled</span>
            {sw(!!c.chromaKey?.enabled, c.chromaKey?.enabled ? 'On' : 'Off', (cl) => void (cl.chromaKey = { color: '#00ff00', tolerance: 30, softness: 15, ...(cl.chromaKey || {}), enabled: !cl.chromaKey?.enabled }))}
          </div>
          {c.chromaKey?.enabled && (
            <>
              <div className="ec-row">
                <span className="kf-spacer" />
                <span className="ec-label">Key Color</span>
                <ColorSwatch value={c.chromaKey.color} onChange={(v) => once('Key Color', (cl) => void (cl.chromaKey = { ...cl.chromaKey!, color: v }))} />
              </div>
              {plainRow('Tolerance', c.chromaKey.tolerance, (cl, v) => void (cl.chromaKey = { ...cl.chromaKey!, tolerance: v }), { min: 0, max: 100, precision: 0 })}
              {plainRow('Softness', c.chromaKey.softness, (cl, v) => void (cl.chromaKey = { ...cl.chromaKey!, softness: v }), { min: 0, max: 100, precision: 0 })}
            </>
          )}
        </Section>
      )}

      {c.kind === 'audio' && (
        <Section title="Volume" fx right={reset('Volume', (cl) => void ((cl.volume = 0), cl.keyframes && delete cl.keyframes.volume))}>
          {numRow('Level', 'volume', { min: -60, max: 15, step: 0.1, precision: 1, suffix: ' dB' })}
          {plainRow('Pan', c.pan, (cl, v) => void (cl.pan = v), { min: -100, max: 100, precision: 0 })}
          {plainRow('Fade In', c.fadeIn, (cl, v) => void (cl.fadeIn = v), { min: 0, max: c.duration, step: 0.05, precision: 2, suffix: 's' })}
          {plainRow('Fade Out', c.fadeOut, (cl, v) => void (cl.fadeOut = v), { min: 0, max: c.duration, step: 0.05, precision: 2, suffix: 's' })}
        </Section>
      )}

      {c.kind !== 'adjustment' && (
        <Section title="Transitions" defaultOpen={!!(c.transitionIn || c.transitionOut)}>
          {trans('in')}
          {trans('out')}
        </Section>
      )}
    </div>
  );
}

