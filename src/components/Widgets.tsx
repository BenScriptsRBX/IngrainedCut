import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons';

/** Premiere-style "scrubby" blue number: drag horizontally to change, click to type. */
export function ScrubNumber({
  value, onChange, onCommit, onBegin, step = 1, min = -Infinity, max = Infinity, precision = 1, suffix = '', width = 52, disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  onBegin?: () => void;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  suffix?: string;
  width?: number;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  const clampV = (v: number) => Math.min(max, Math.max(min, v));
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(precision) : '—');

  if (editing)
    return (
      <input
        className="scrub-input"
        style={{ width }}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = parseFloat(text);
          if (!isNaN(v)) {
            onBegin?.();
            onChange(clampV(v));
            onCommit?.();
          }
          setEditing(false);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  return (
    <span
      className={'scrub' + (disabled ? ' disabled' : '')}
      style={{ minWidth: width }}
      onPointerDown={(e) => {
        if (disabled) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, v: value, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) > 2) {
          d.moved = true;
          onBegin?.();
        }
        if (d.moved) {
          const mult = e.shiftKey ? 10 : e.ctrlKey ? 0.1 : 1;
          onChange(clampV(Math.round((d.v + dx * step * mult) / step) * step));
        }
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        if (d.moved) onCommit?.();
        else {
          setText(fmt(value));
          setEditing(true);
        }
      }}
    >
      {fmt(value)}
      {suffix}
    </span>
  );
}

export function ColorSwatch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="swatch" style={{ background: value }}>
      <input type="color" value={toHex(value)} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function toHex(c: string) {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map((x) => x + x).join('');
  const el = document.createElement('canvas').getContext('2d')!;
  el.fillStyle = c;
  return el.fillStyle as string;
}

export function Section({ title, children, defaultOpen = true, right, fx }: { title: string; children: React.ReactNode; defaultOpen?: boolean; right?: React.ReactNode; fx?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ec-section">
      <div className="ec-head" onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevronDown' : 'chevron'} size={11} />
        {fx && <span className="fx-badge">fx</span>}
        <span className="ec-title">{title}</span>
        <span className="grow" />
        <span onClick={(e) => e.stopPropagation()}>{right}</span>
      </div>
      {open && <div className="ec-body">{children}</div>}
    </div>
  );
}

export function Toggle({ on, onClick, icon, title, className = '' }: { on: boolean; onClick: () => void; icon: string; title?: string; className?: string }) {
  return (
    <button className={`icon-btn ${on ? 'on' : ''} ${className}`} title={title} onClick={onClick}>
      <Icon name={icon} size={14} />
    </button>
  );
}

export function Modal({ title, onClose, children, width = 520, footer }: { title: string; onClose: () => void; children: React.ReactNode; width?: number; footer?: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} onKeyDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, active, onChange, right }: { tabs: { id: T; label: string }[]; active: T; onChange: (t: T) => void; right?: React.ReactNode }) {
  return (
    <div className="panel-tabs">
      {tabs.map((t) => (
        <div key={t.id} className={'panel-tab' + (t.id === active ? ' active' : '')} onMouseDown={() => onChange(t.id)}>
          {t.label}
        </div>
      ))}
      <span className="grow" />
      {right}
    </div>
  );
}
