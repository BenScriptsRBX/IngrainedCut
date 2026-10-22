import { mediaSrc, isBrowserEngine } from '../webBridge';
import { locateMedia } from '../cloud';
import React, { useState } from 'react';
import type { MediaItem } from '../types';
import { S, setS, useEditor, commit } from '../store';
import { fmtTC } from '../time';
import { Icon } from './Icons';
import { openContextMenu } from './ContextMenu';
import { addAdjustmentLayer, addColorMatte, addTextAt, importDialog, importPaths, placeMediaAt, removeMedia, revealMedia, filesToPaths } from '../actions';
import { setDraft } from '../chatStore';
import { engine } from '../engine';

const TYPE_ICON: Record<string, string> = { video: 'film', audio: 'audio', image: 'image' };

export function ProjectPanel() {
  const media = useEditor((s) => s.project.media);
  const projectName = useEditor((s) => s.project.name);
  const selected = useEditor((s) => s.selectedMediaId);
  const fps = useEditor((s) => s.project.settings.fps);
  const [view, setView] = useState<'icon' | 'list'>('icon');
  const [q, setQ] = useState('');
  const [over, setOver] = useState(false);
  const items = media.filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()));

  const open = (m: MediaItem) => setS({ source: { mediaId: m.id, in: null, out: null, time: 0 }, leftTab: 'source', selectedMediaId: m.id });
  const menu = (e: React.MouseEvent, m: MediaItem) => {
    e.preventDefault();
    setS({ selectedMediaId: m.id });
    openContextMenu(e.clientX, e.clientY, [
      { label: 'Open in Source Monitor', action: () => open(m) },
      { label: 'Insert at Playhead', action: () => placeMediaAt(m.id, null, S().playhead, 'insert') },
      { label: 'Overwrite at Playhead', action: () => placeMediaAt(m.id, null, S().playhead, 'overwrite') },
      { label: 'Append to End of Sequence', action: () => {
        const end = Math.max(0, ...S().project.clips.map((c) => c.start + c.duration));
        placeMediaAt(m.id, null, end, 'overwrite');
        engine.seek(end);
      } },
      { divider: true },
      { label: 'Rename…', action: () => {
        const n = window.prompt('Name', m.name);
        if (n) commit('Rename Media', (d) => void (d.media.find((x) => x.id === m.id)!.name = n));
      } },
      { label: 'Reveal in Explorer', action: () => revealMedia(m.id) },
      { label: 'Remove from Project', action: () => removeMedia([m.id]) },
      { divider: true },
      ...(m.composition
        ? [
            { label: 'Open Composition Folder', action: () => window.icut.reveal(m.composition + '/index.html') },
            { label: '✦ Ask Claude to revise this composition', action: () => setDraft(`Revise the HyperFrames composition ${m.id} ("${m.name}"): `) },
          ]
        : [{ label: '✦ Ask Claude to review this footage', action: () => setDraft(`Have a look at media ${m.id} ("${m.name}") and tell me what's in it and how you'd use it.`) }]),
    ]);
  };

  return (
    <div
      className={'project-panel' + (over ? ' drop-over' : '')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setOver(false);
        const paths = await filesToPaths([...e.dataTransfer.files]);
        if (paths.length) await importPaths(paths);
      }}
    >
      <div className="pp-head">
        <Icon name="folder" size={13} />
        <span className="pp-name">{projectName}.icut</span>
        <span className="dim">{media.length} items</span>
      </div>
      <OfflineBar />
      <div className="search-row">
        <Icon name="search" size={13} />
        <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      {media.length === 0 ? (
        <div className="pp-empty" onDoubleClick={importDialog}>
          <Icon name="export" size={26} />
          <div>Import media to start</div>
          <div className="dim">Double-click here, press Ctrl+I, or drop files</div>
          <button className="btn" onClick={importDialog}>
            Import Media…
          </button>
        </div>
      ) : view === 'icon' ? (
        <div className="pp-grid">
          {items.map((m) => (
            <div
              key={m.id}
              className={'pp-card' + (selected === m.id ? ' sel' : '')}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-icut-media', m.id);
                e.dataTransfer.effectAllowed = 'copy';
                sessionStorage.setItem('icut-drag-dur', String(m.type === 'image' ? 5 : m.duration));
              }}
              onClick={() => setS({ selectedMediaId: m.id })}
              onDoubleClick={() => open(m)}
              onContextMenu={(e) => menu(e, m)}
              title={`${m.name}\n${m.path}\nid: ${m.id}`}
            >
              <div className="pp-thumb">
                {m.thumb ? <img src={mediaSrc(m.thumb)} draggable={false} /> : m.type === 'audio' ? <AudioThumb m={m} /> : <Icon name={TYPE_ICON[m.type]} size={24} />}
                {m.type !== 'image' && <span className="pp-dur">{fmtTC(m.duration, fps)}</span>}
                {m.status === 'loading' && <span className="pp-loading" />}
                {m.status === 'missing' && <span className="pp-missing">Offline</span>}
                {m.composition && <span className="hf-badge pp-hf" title={`HyperFrames composition: ${m.composition}`}>HF</span>}
              </div>
              <div className="pp-label">
                <Icon name={TYPE_ICON[m.type]} size={11} />
                <span>{m.name}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="pp-list">
          <div className="pp-row head">
            <span>Name</span>
            <span>Duration</span>
            <span>Video Info</span>
            <span>Frame Rate</span>
          </div>
          {items.map((m) => (
            <div
              key={m.id}
              className={'pp-row' + (selected === m.id ? ' sel' : '')}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-icut-media', m.id);
                sessionStorage.setItem('icut-drag-dur', String(m.type === 'image' ? 5 : m.duration));
              }}
              onClick={() => setS({ selectedMediaId: m.id })}
              onDoubleClick={() => open(m)}
              onContextMenu={(e) => menu(e, m)}
            >
              <span className="pp-cell-name">
                <Icon name={TYPE_ICON[m.type]} size={12} /> {m.name}
              </span>
              <span>{m.type === 'image' ? '—' : fmtTC(m.duration, fps)}</span>
              <span>{m.width ? `${m.width} x ${m.height}` : '—'}</span>
              <span>{m.type === 'video' ? `${Math.round(m.fps * 100) / 100} fps` : '—'}</span>
            </div>
          ))}
        </div>
      )}
      <div className="pp-foot">
        <button className={'icon-btn' + (view === 'list' ? ' on' : '')} title="List View" onClick={() => setView('list')}>
          <Icon name="list" size={14} />
        </button>
        <button className={'icon-btn' + (view === 'icon' ? ' on' : '')} title="Icon View" onClick={() => setView('icon')}>
          <Icon name="grid" size={14} />
        </button>
        <span className="grow" />
        <button className="icon-btn" title="Import (Ctrl+I)" onClick={importDialog}>
          <Icon name="folder" size={14} />
        </button>
        <button
          className="icon-btn"
          title="New Item"
          onClick={(e) =>
            openContextMenu(e.clientX, e.clientY - 120, [
              { label: 'Text Layer', action: () => addTextAt() },
              { label: 'Color Matte…', action: () => addColorMatte() },
              { label: 'Adjustment Layer', action: addAdjustmentLayer },
              { divider: true },
              { label: 'Sequence Settings…', action: () => setS({ dialog: 'sequence' }) },
            ])
          }
        >
          <Icon name="plus" size={14} />
        </button>
        <button className="icon-btn" title="Remove Selected Media" disabled={!selected} onClick={() => selected && removeMedia([selected])}>
          <Icon name="trash" size={14} />
        </button>
      </div>
    </div>
  );
}

function AudioThumb({ m }: { m: MediaItem }) {
  if (!m.peaks) return <Icon name="audio" size={24} />;
  const n = 48;
  const per = Math.max(1, Math.floor(m.peaks.length / n));
  const bars = Array.from({ length: n }, (_, i) => {
    let mx = 0;
    for (let j = i * per; j < (i + 1) * per && j < m.peaks!.length; j++) mx = Math.max(mx, m.peaks![j]);
    return mx / 255;
  });
  return (
    <svg className="pp-audio" viewBox={`0 0 ${n} 20`} preserveAspectRatio="none">
      {bars.map((v, i) => (
        <rect key={i} x={i + 0.15} width={0.7} y={10 - v * 9} height={Math.max(0.3, v * 18)} />
      ))}
    </svg>
  );
}

/**
 * Website without the helper: media that has no copy in this browser yet is offline. Pick the files (any folder, e.g.
 * Documents/IngrainedCut/Imported) and they are matched by name, copied into the browser and relinked.
 */
function OfflineBar() {
  const offline = useEditor((s) => s.project.media.filter((m) => m.status === 'missing').length);
  const input = React.useRef<HTMLInputElement>(null);
  if (!offline || !isBrowserEngine()) return null;
  return (
    <div className="pp-offline">
      <span>
        {offline} file{offline === 1 ? '' : 's'} offline in this browser
      </span>
      <button className="btn sm" title="Pick the original files; they are matched by name and copied into this browser" onClick={() => input.current?.click()}>
        Locate files…
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) locateMedia(files);
        }}
      />
    </div>
  );
}
