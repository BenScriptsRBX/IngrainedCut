import React, { useEffect, useRef, useState } from 'react';
import { useEditor, setS } from './store';
import { useChat, agentName } from './chatStore';
import { Icon } from './components/Icons';
import { Tabs } from './components/Widgets';
import { MenuList } from './components/ContextMenu';
import { menubar } from './components/menus';
import { ProgramMonitor } from './components/ProgramMonitor';
import { SourceMonitor } from './components/SourceMonitor';
import { EffectControls } from './components/EffectControls';
import { ProjectPanel } from './components/ProjectPanel';
import { EffectsPanel } from './components/EffectsPanel';
import { Timeline } from './components/Timeline';
import { ToolsStrip, AudioMeters, AudioMixer, HistoryPanel, TOOL_HINT } from './components/SmallPanels';
import { ChatPanel } from './components/ChatPanel';
import { ColorPanel } from './components/ColorPanel';
import { Dialogs } from './components/Dialogs';
import { ContextMenuHost } from './components/ContextMenu';
import { isSite, isBrowserEngine } from './webBridge';
import { HelperChip } from './components/HelperConnect';

function usePersisted(key: string, initial: number): [number, (v: number) => void] {
  const [v, setV] = useState<number>(() => {
    try {
      const x = localStorage.getItem('icut.layout.' + key);
      return x ? Number(x) : initial;
    } catch {
      return initial;
    }
  });
  return [
    v,
    (n: number) => {
      setV(n);
      try {
        localStorage.setItem('icut.layout.' + key, String(n));
      } catch {}
    },
  ];
}

function Splitter({ dir, onDrag }: { dir: 'v' | 'h'; onDrag: (delta: number) => void }) {
  const last = useRef(0);
  return (
    <div
      className={'splitter ' + dir}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        last.current = dir === 'v' ? e.clientX : e.clientY;
      }}
      onPointerMove={(e) => {
        if (!e.buttons) return;
        const cur = dir === 'v' ? e.clientX : e.clientY;
        onDrag(cur - last.current);
        last.current = cur;
      }}
    />
  );
}

const WORKSPACES: { name: string; apply: () => void }[] = [
  { name: 'Assembly', apply: () => setS({ leftTab: 'source', bottomTab: 'project' }) },
  { name: 'Editing', apply: () => setS({ leftTab: 'effectControls', bottomTab: 'project' }) },
  { name: 'Color', apply: () => setS({ leftTab: 'color', bottomTab: 'project' }) },
  { name: 'Effects', apply: () => setS({ leftTab: 'effectControls', bottomTab: 'effects' }) },
  { name: 'Audio', apply: () => setS({ leftTab: 'mixer', bottomTab: 'effects' }) },
  { name: 'Captions', apply: () => setS({ showChat: true }) },
];

function TopBar() {
  const [open, setOpen] = useState<number | null>(null);
  const workspace = useEditor((s) => s.workspace);
  const showChat = useEditor((s) => s.showChat);
  const dirty = useEditor((s) => s.dirty);
  const name = useEditor((s) => s.project.name);
  const cloud = useEditor((s) => s.cloud);
  useEditor((s) => s.past.length + s.future.length + Number(s.snapping) + Number(s.linkedSelection) + s.previewScale);
  const menus = menubar();
  useEffect(() => {
    if (open == null) return;
    const close = (e: MouseEvent) => !(e.target as HTMLElement).closest('.menubar') && setOpen(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="topbar">
      {isSite ? (
        <a className="logo" title="Back to your projects" href="/projects">
          <span>Ic</span>
        </a>
      ) : (
        <div className="logo" title="IngrainedCut">
          <span>Ic</span>
        </div>
      )}
      <div className="menubar">
        {menus.map((m, i) => (
          <div key={m.label} className={'menubar-item' + (open === i ? ' open' : '')} onMouseDown={() => setOpen(open === i ? null : i)} onMouseEnter={() => open != null && setOpen(i)}>
            {m.label}
            {open === i && (
              <div className="menubar-drop" onMouseDown={(e) => e.stopPropagation()}>
                <MenuList items={m.items} onDone={() => setOpen(null)} />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="workspaces">
        {WORKSPACES.map((w) => (
          <button
            key={w.name}
            className={'ws' + (workspace === w.name ? ' on' : '')}
            onClick={() => {
              setS({ workspace: w.name });
              w.apply();
            }}
          >
            {w.name}
          </button>
        ))}
      </div>
      <div className="top-title">
        {name}
        {cloud ? <CloudStatus status={cloud.status} /> : dirty ? ' *' : ''}
      </div>
      <div className="top-right">
        <HelperChip />
        <button className="btn primary sm" onClick={() => setS({ dialog: 'export' })} title="Export Media (Ctrl+M)">
          <Icon name="export" size={12} /> Export
        </button>
        <button className="icon-btn" title="Settings" onClick={() => setS({ dialog: 'settings' })}>
          <Icon name="gear" size={15} />
        </button>
        <button className={'icon-btn claude-toggle' + (showChat ? ' on' : '')} title="Claude panel (Ctrl+J)" onClick={() => setS({ showChat: !showChat })}>
          <Icon name="sparkle" size={15} />
        </button>
      </div>
    </div>
  );
}

function CloudStatus({ status }: { status: 'saved' | 'saving' | 'pending' | 'error' }) {
  const label = { saved: 'Saved', saving: 'Saving…', pending: 'Saving…', error: 'Not saved — retrying on next change' }[status];
  return (
    <span className={'cloud-status ' + status} title="Timeline saved to your IngrainedCut account (media stays on this computer)">
      {status === 'saved' ? <Icon name="check" size={11} /> : status === 'error' ? <Icon name="close" size={11} /> : <span className="spinner" />} {label}
    </span>
  );
}

function StatusBar() {
  const tool = useEditor((s) => s.tool);
  const last = useEditor((s) => s.lastLabel);
  const busy = useChat((s) => s.busy);
  const info = useChat((s) => s.info);
  const name = agentName(useChat((s) => s.provider));
  return (
    <div className="statusbar">
      <span className="dim">{TOOL_HINT[tool]}</span>
      <span className="grow" />
      {last && <span className="dim">Last: {last}</span>}
      <span className={'st-claude' + (busy ? ' busy' : '')}>
        <Icon name="sparkle" size={10} />{' '}
        {isBrowserEngine() ? 'AI: connect the helper' : busy ? `${name} is editing…` : info ? `${name} ready · ${info.model ?? ''}` : `${name} idle`}
      </span>
    </div>
  );
}

export function App() {
  const leftTab = useEditor((s) => s.leftTab);
  const bottomTab = useEditor((s) => s.bottomTab);
  const showChat = useEditor((s) => s.showChat);
  const seqName = useEditor((s) => s.project.settings.name);
  const [chatW, setChatW] = usePersisted('chatW', 400);
  const [leftW, setLeftW] = usePersisted('leftW', 560);
  const [upperH, setUpperH] = usePersisted('upperH', 430);
  const [binW, setBinW] = usePersisted('binW', 330);

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <div className="editor">
          <div className="upper" style={{ height: upperH }}>
            <div className="panel" style={{ width: leftW }}>
              <Tabs
                tabs={[
                  { id: 'source', label: 'Source' },
                  { id: 'effectControls', label: 'Effect Controls' },
                  { id: 'color', label: 'Color Grading' },
                  { id: 'mixer', label: 'Audio Track Mixer' },
                ]}
                active={leftTab === 'info' ? 'effectControls' : leftTab}
                onChange={(t) => setS({ leftTab: t })}
              />
              <div className="panel-body">
                {leftTab === 'source' && <SourceMonitor />}
                {(leftTab === 'effectControls' || leftTab === 'info') && <EffectControls />}
                {leftTab === 'color' && <ColorPanel />}
                {leftTab === 'mixer' && <AudioMixer />}
              </div>
            </div>
            <Splitter dir="v" onDrag={(d) => setLeftW(Math.max(260, Math.min(window.innerWidth - 600, leftW + d)))} />
            <div className="panel grow">
              <Tabs tabs={[{ id: 'program', label: `Program: ${seqName}` }]} active="program" onChange={() => {}} />
              <div className="panel-body">
                <ProgramMonitor />
              </div>
            </div>
          </div>
          <Splitter dir="h" onDrag={(d) => setUpperH(Math.max(200, Math.min(window.innerHeight - 260, upperH + d)))} />
          <div className="lower">
            <div className="panel" style={{ width: binW }}>
              <Tabs
                tabs={[
                  { id: 'project', label: 'Project' },
                  { id: 'effects', label: 'Effects' },
                  { id: 'history', label: 'History' },
                ]}
                active={bottomTab}
                onChange={(t) => setS({ bottomTab: t })}
              />
              <div className="panel-body">
                {bottomTab === 'project' && <ProjectPanel />}
                {bottomTab === 'effects' && <EffectsPanel />}
                {bottomTab === 'history' && <HistoryPanel />}
              </div>
            </div>
            <Splitter dir="v" onDrag={(d) => setBinW(Math.max(200, Math.min(700, binW + d)))} />
            <div className="panel tools-panel">
              <ToolsStrip />
            </div>
            <div className="panel grow">
              <Tabs tabs={[{ id: 'tl', label: seqName }]} active="tl" onChange={() => {}} />
              <div className="panel-body">
                <Timeline />
              </div>
            </div>
            <div className="panel meters-panel">
              <AudioMeters />
            </div>
          </div>
        </div>
        {showChat && (
          <>
            <Splitter dir="v" onDrag={(d) => setChatW(Math.max(300, Math.min(760, chatW - d)))} />
            <div className="panel chat-panel" style={{ width: chatW }}>
              <ChatPanel />
            </div>
          </>
        )}
      </div>
      <StatusBar />
      <Dialogs />
      <ContextMenuHost />
    </div>
  );
}
