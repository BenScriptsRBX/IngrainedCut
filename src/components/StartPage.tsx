// The start page (desktop): new / open, recent projects, and autosaves with their earlier versions — including the
// copy of a project file kept just before a Save replaced it, so a save over the wrong project can be undone.
import React, { useEffect, useState } from 'react';
import { useEditor, setS } from '../store';
import { newProjectAction, openProject, openAutosave } from '../actions';
import { Icon } from './Icons';

function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
}
const when = (t: number) => `${ago(t)} · ${new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
const len = (d?: number) => (d ? `${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, '0')}` : '0:00');
const stats = (x: Partial<ProjectSummary>) => `${x.clips ?? 0} clips · ${x.media ?? 0} media · ${len(x.duration)}`;
const folder = (p: string) => p.replace(/[\\/][^\\/]*$/, '');

export function StartPage() {
  const show = useEditor((s) => s.startPage);
  const current = useEditor((s) => s.project);
  const [info, setInfo] = useState<StartInfo | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!show) return;
    setInfo(null);
    window.icut.startInfo().then(setInfo).catch(() => setInfo({ recent: [], autosaves: [] }));
  }, [show]);
  useEffect(() => {
    if (!show) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setS({ startPage: false });
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [show]);
  if (!show) return null;
  const hasCurrent = current.clips.length > 0 || current.media.length > 0;
  return (
    <div className="start-page">
      <div className="start-inner">
        <div className="start-head">
          <div className="logo big">
            <span>Ic</span>
          </div>
          <div className="start-title">IngrainedCut</div>
          <span className="grow" />
          {hasCurrent && (
            <button className="btn" onClick={() => setS({ startPage: false })} title="Back to the open project (Esc)">
              Continue “{current.name}”
            </button>
          )}
          <button className="btn" onClick={() => openProject()}>
            <Icon name="folder" size={13} /> Open project…
          </button>
          <button className="btn primary" onClick={newProjectAction}>
            <Icon name="plus" size={13} /> New project
          </button>
        </div>
        <div className="start-cols">
          <section>
            <h3>Recent projects</h3>
            {!info && <div className="dim">Loading…</div>}
            {info && !info.recent.length && <div className="dim start-empty">No recent projects yet.</div>}
            {info?.recent.map((r) => (
              <button key={r.path} className="start-item" onClick={() => openProject(r.path)} title={r.path}>
                <div className="si-name">{r.path.split(/[\\/]/).pop()!.replace(/\.icut$/i, '')}</div>
                <div className="si-sub dim">{folder(r.path)}</div>
                <div className="si-sub">
                  <span className="dim">{when(r.time)}</span>
                  <span className="grow" />
                  <span className="dim">{stats(r)}</span>
                </div>
              </button>
            ))}
          </section>
          <section>
            <h3>Autosaves</h3>
            <div className="dim tiny start-note">Kept automatically while you edit, and before a Save replaces a project file. Opening one doesn't change any file until you save.</div>
            {info && !info.autosaves.length && <div className="dim start-empty">No autosaves yet.</div>}
            {info?.autosaves.map((a) => {
              const latest = a.versions[0];
              const newer = a.fileTime != null && a.latest > a.fileTime + 1000;
              const emptied = a.fileClips === 0 && a.versions.some((v) => (v.clips ?? 0) > 0);
              const replaced = latest.kind === 'replaced';
              const [status, warn] = !a.path
                ? ['Never saved', true]
                : !a.fileExists
                  ? ['Project file is missing', true]
                  : emptied
                    ? ['Saved file is empty — an earlier version is kept here', true]
                    : newer
                      ? ['Has changes that were never saved', true]
                      : replaced
                        ? ['Saved over — the earlier version is kept here', false]
                        : ['Saved file is up to date', false];
              return (
                <div key={a.key} className="start-item as">
                  <div className="si-row">
                    <div className="si-name">{a.name}</div>
                    <span className={'si-badge' + (warn ? ' warn' : '')}>{status}</span>
                  </div>
                  {a.path && <div className="si-sub dim">{folder(a.path)}</div>}
                  <div className="si-sub">
                    <span className="dim">{when(a.latest)}</span>
                    <span className="grow" />
                    <span className="dim">{stats(latest)}</span>
                  </div>
                  <div className="si-actions">
                    <button className="btn sm primary" onClick={() => openAutosave(a, latest)}>
                      Open latest
                    </button>
                    <button className="btn sm" onClick={() => setOpen(open === a.key ? null : a.key)}>
                      Versions ({a.versions.length}) <Icon name={open === a.key ? 'chevronDown' : 'chevron'} size={11} />
                    </button>
                  </div>
                  {open === a.key && (
                    <div className="si-versions">
                      {a.versions.map((v) => (
                        <div key={v.file} className="si-version">
                          <span className={'si-kind ' + v.kind}>{v.kind === 'replaced' ? 'Before a save replaced it' : 'Autosave'}</span>
                          <span className="dim">{when(v.time)}</span>
                          <span className="grow" />
                          <span className="dim">{stats(v)}</span>
                          <button className="btn sm" onClick={() => openAutosave(a, v)}>
                            Open
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
}
