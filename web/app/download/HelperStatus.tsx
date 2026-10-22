'use client';
import { useHelper } from '../projects/ProjectsClient';

export function HelperStatus() {
  const s = useHelper(true);
  return (
    <p className={`helper-pill ${s === 'on' ? 'on' : s === 'off' ? 'off' : ''}`} style={{ textDecoration: 'none' }}>
      <span className="d" />
      {s === 'on' ? 'The helper is running on this computer' : s === 'off' ? 'Helper not detected on this computer yet' : 'Checking for the helper…'}
    </p>
  );
}
