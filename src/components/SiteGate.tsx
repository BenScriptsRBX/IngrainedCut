// Website mode: pick the engine (the helper on this computer if it's running, otherwise the browser itself),
// then load the account project and show the editor. The helper is optional — it adds the AI agents.
import React, { useEffect, useState } from 'react';
import { chooseEngine } from '../webBridge';
import { cloudProjectId, loadCloudProject } from '../cloud';

type Phase = 'starting' | 'ready' | 'notfound' | 'error';

export function SiteGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('starting');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!cloudProjectId) {
      location.href = '/projects';
      return;
    }
    chooseEngine()
      .then(() => loadCloudProject())
      .then((r) => setPhase(r === 'notfound' ? 'notfound' : 'ready'))
      .catch((e) => {
        setErr(e.message);
        setPhase('error');
      });
  }, []);

  if (phase === 'ready') return <>{children}</>;
  return (
    <div className="gate">
      <div className="gate-card">
        <a href="/projects" className="gate-back">
          ← Projects
        </a>
        <div className="gate-logo">Ic</div>
        {phase === 'starting' && (
          <div className="gate-wait">
            <span className="gate-spin" /> Opening your project…
          </div>
        )}
        {phase === 'notfound' && (
          <>
            <h2>Project not found</h2>
            <p>It may have been deleted, or it belongs to another account.</p>
            <a href="/projects" className="gate-link">
              Back to your projects
            </a>
          </>
        )}
        {phase === 'error' && (
          <>
            <h2>Couldn’t open the project</h2>
            <p>{err}</p>
            <button className="btn primary" onClick={() => location.reload()}>
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
