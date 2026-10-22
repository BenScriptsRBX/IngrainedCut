'use client';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export function DeleteAccount({ projects }: { projects: number }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const remove = async () => {
    setBusy(true);
    setError(null);
    const { error } = await authClient.deleteUser({ callbackURL: '/' });
    setBusy(false);
    if (!error) {
      location.href = '/?deleted=1';
      return;
    }
    // deleting needs a recent sign-in; older sessions must sign in again first
    if (error.code === 'SESSION_EXPIRED' || /fresh|expired/i.test(error.message ?? '')) setStale(true);
    else setError(error.message || 'Could not delete the account. Try again.');
  };

  const reauth = async () => {
    await authClient.signOut();
    location.href = '/login?next=/account';
  };

  if (stale)
    return (
      <div className="callout">
        <p>For your security, please sign in again before deleting your account.</p>
        <button className="btn primary" onClick={reauth}>
          Sign in again
        </button>
      </div>
    );

  return (
    <div className="danger-zone">
      <label htmlFor="confirm-delete">
        Type <b>delete</b> to confirm{projects ? ` (this also deletes ${projects} saved project${projects === 1 ? '' : 's'})` : ''}:
      </label>
      <div className="row">
        <input id="confirm-delete" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        <button className="btn danger" disabled={confirm.trim().toLowerCase() !== 'delete' || busy} onClick={remove}>
          {busy ? 'Deleting…' : 'Delete my account'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
