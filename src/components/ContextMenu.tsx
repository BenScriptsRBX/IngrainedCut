import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Icon } from './Icons';

export interface MenuItem {
  label?: string;
  action?: () => void;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  divider?: boolean;
  submenu?: MenuItem[];
  color?: string;
}

const useCtx = create<{ x: number; y: number; items: MenuItem[] | null }>(() => ({ x: 0, y: 0, items: null }));

export function openContextMenu(x: number, y: number, items: MenuItem[]) {
  useCtx.setState({ x, y, items });
}
export function closeContextMenu() {
  useCtx.setState({ items: null });
}

export function MenuList({ items, onDone }: { items: MenuItem[]; onDone: () => void }) {
  const [sub, setSub] = useState<number | null>(null);
  return (
    <div className="menu-list">
      {items.map((it, i) =>
        it.divider ? (
          <div key={i} className="menu-div" />
        ) : (
          <div
            key={i}
            className={'menu-item' + (it.disabled ? ' disabled' : '')}
            onMouseEnter={() => setSub(it.submenu ? i : null)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (it.disabled || it.submenu) return;
              onDone();
              it.action?.();
            }}
          >
            <span className="menu-check">{it.checked ? <Icon name="check" size={12} /> : it.color ? <span className="menu-color" style={{ background: it.color }} /> : null}</span>
            <span className="menu-label">{it.label}</span>
            {it.shortcut && <span className="menu-sc">{it.shortcut}</span>}
            {it.submenu && <Icon name="chevron" size={11} />}
            {it.submenu && sub === i && (
              <div className="menu-sub">
                <MenuList items={it.submenu} onDone={onDone} />
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}

export function ContextMenuHost() {
  const { x, y, items } = useCtx();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    if (!items || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 6), y: Math.min(y, window.innerHeight - r.height - 6) });
  }, [x, y, items]);
  useEffect(() => {
    if (!items) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeContextMenu();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeContextMenu();
    window.addEventListener('mousedown', close, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('keydown', key);
    };
  }, [items]);
  if (!items) return null;
  return (
    <div className="ctx-menu" ref={ref} style={{ left: pos.x, top: pos.y }}>
      <MenuList items={items} onDone={closeContextMenu} />
    </div>
  );
}
