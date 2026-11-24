'use client';
import { useEffect, useState } from 'react';

/** Whether the IngrainedCut extension is in this browser (its content script marks <html data-icut-extension>). */
export function ExtensionStatus() {
  const [v, setV] = useState<string | null | undefined>(undefined);
  useEffect(() => setV(document.documentElement.getAttribute('data-icut-extension')), []);
  if (v === undefined) return null;
  return (
    <p className={`helper-pill ${v ? 'on' : 'off'}`} style={{ textDecoration: 'none' }}>
      <span className="d" />
      {v ? `The IngrainedCut extension is installed (version ${v})` : 'The extension isn’t in this browser yet'}
    </p>
  );
}
