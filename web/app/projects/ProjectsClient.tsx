'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface P {
  id: string;
  name: string;
  duration: number;
  clips: number;
  updated: string;
}

const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Is the IngrainedCut helper running on this computer? Only asked when this browser has used it before (the editor
 * sets the flag), because reaching 127.0.0.1 makes the browser ask for local network access.
 */
export function useHelper(always = false) {
  const [state, setState] = useState<'checking' | 'on' | 'off' | 'unused'>('checking');
  useEffect(() => {
    let used = always;
    try {
      used = !!localStorage.getItem('icut-helper-used');
    } catch {}
    if (!used) {
      setState('unused');
      return;
    }
    let stop = false;
    const check = async () => {
      try {
        const r = await fetch('http://127.0.0.1:5310/hello', { cache: 'no-store' });
        if (!stop) setState(r.ok ? 'on' : 'off');
        if (r.ok)
          try {
            localStorage.setItem('icut-helper-used', '1');
          } catch {}
      } catch {
        if (!stop) setState('off');
      }
    };
    check();
    const t = setInterval(check, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  return state;
}

export function ProjectsClient({ initial, firstName }: { initial: P[]; firstName: string }) {
  const [projects, setProjects] = useState(initial);
  const [creating, setCreating] = useState(false);
  const helper = useHelper();
  const router = useRouter();

  const open = (id: string) => (location.href = `/editor/?project=${encodeURIComponent(id)}`);

  const create = async () => {
    setCreating(true);
    const r = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Untitled Project' }) });
    const j = await r.json();
    if (r.ok) open(j.id);
    else setCreating(false);
  };
  const rename = async (p: P) => {
    const name = window.prompt('Project name', p.name)?.trim();
    if (!name || name === p.name) return;
    const r = await fetch(`/api/projects/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (r.ok) setProjects((ps) => ps.map((x) => (x.id === p.id ? { ...x, name } : x)));
  };
  const remove = async (p: P) => {
    if (!window.confirm(`Delete “${p.name}”? This removes the timeline from your account. Your media files on your computer are not touched.`)) return;
    const r = await fetch(`/api/projects/${p.id}`, { method: 'DELETE' });
    if (r.ok) setProjects((ps) => ps.filter((x) => x.id !== p.id));
    router.refresh();
  };

  return (
    <>
      <div className="app-head">
        <div>
          <h1>{firstName ? `${firstName}’s projects` : 'Your projects'}</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Timelines are saved to your account. Media stays on your computer — nothing is uploaded.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link
            href="/download"
            className={`helper-pill ${helper === 'on' ? 'on' : helper === 'off' ? 'off' : ''}`}
            title="Optional: the helper runs the AI agents on your computer"
          >
            <span className="d" />
            {helper === 'on' ? 'AI helper connected' : helper === 'off' ? 'AI helper not running' : helper === 'unused' ? 'Add AI with the helper' : 'Looking for helper…'}
          </Link>
          <button className="btn primary sm" onClick={create} disabled={creating}>
            {creating ? 'Creating…' : '+ New project'}
          </button>
        </div>
      </div>
      {projects.length === 0 ? (
        <div className="empty">
          <h2 style={{ color: 'var(--text)', margin: '0 0 8px' }}>No projects yet</h2>
          <p>Create a project, import footage from your computer and ask your AI editor for the first cut.</p>
          <button className="btn primary" onClick={create} disabled={creating} style={{ marginTop: 10 }}>
            Create your first project
          </button>
        </div>
      ) : (
        <div className="proj-grid">
          <button className="proj new" onClick={create} disabled={creating}>
            + New project
          </button>
          {projects.map((p) => (
            <div key={p.id} className="proj">
              <button className="proj-thumb" onClick={() => open(p.id)} aria-label={`Open ${p.name}`} style={{ border: 'none', cursor: 'pointer' }}>
                <div className="bars">
                  {[60, 35, 80, 50, 70, 40].map((h, i) => (
                    <i key={i} style={{ height: `${h}%` }} />
                  ))}
                </div>
              </button>
              <div className="proj-info">
                <b title={p.name}>{p.name}</b>
                <span>
                  {fmtDur(p.duration)} · {p.clips} clips · edited {ago(p.updated)}
                </span>
              </div>
              <div className="proj-actions">
                <button className="btn" onClick={() => open(p.id)}>
                  Open
                </button>
                <button className="btn ghost" onClick={() => rename(p)}>
                  Rename
                </button>
                <button className="btn ghost danger" onClick={() => remove(p)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
