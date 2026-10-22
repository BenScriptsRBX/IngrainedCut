// Synchronize… and Remove Silence… dialogs.
import React, { useMemo, useState } from 'react';
import { useEditor } from '../store';
import { Modal } from './Widgets';
import { synchronizeSelection, type SyncMethod } from '../sync';
import { findSilences, removeSilence } from '../cutTools';
import { expandLinked } from '../ops';

export function SyncDialog({ onClose }: { onClose: () => void }) {
  const selection = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const [method, setMethod] = useState<SyncMethod>('audio');
  const [link, setLink] = useState(true);
  const groups = new Set(project.clips.filter((c) => selection.includes(c.id)).map((c) => c.linkId || c.id)).size;
  return (
    <Modal
      title="Synchronize Clips"
      onClose={onClose}
      width={480}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={groups < 2}
            onClick={() => {
              onClose();
              synchronizeSelection(method, link);
            }}
          >
            Synchronize
          </button>
        </>
      }
    >
      <div className="form">
        <label>Sync by</label>
        <div className="radio-col">
          {(
            [
              ['audio', 'Audio', 'Match the sound of each clip (camera audio with a separate mic, multiple cameras).'],
              ['start', 'Clip Start', 'Line up the start of every clip.'],
              ['end', 'Clip End', 'Line up the end of every clip.'],
            ] as const
          ).map(([v, label, hint]) => (
            <label key={v} className="check">
              <input type="radio" name="sync" checked={method === v} onChange={() => setMethod(v)} />
              <span>
                <b>{label}</b> <span className="dim">— {hint}</span>
              </span>
            </label>
          ))}
        </div>
        <label>After syncing</label>
        <label className="check">
          <input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} /> Link the synced clips so they move together
        </label>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        {groups < 2
          ? 'Select two or more clips first (linked clips count as one).'
          : `${groups} clip groups selected. The one on the lowest track that starts first stays put; the others move to match it.`}
      </div>
    </Modal>
  );
}

export function SilenceDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const [thresholdDb, setThreshold] = useState(-40);
  const [minDuration, setMin] = useState(0.6);
  const [padding, setPadding] = useState(0.12);
  const [onlySelected, setOnlySelected] = useState(selection.length > 0);
  const clipIds = onlySelected ? expandLinked(project, selection) : [];
  const ranges = useMemo(() => findSilences(project, { thresholdDb, minDuration, padding, clipIds }), [project, thresholdDb, minDuration, padding, onlySelected, selection]);
  const total = ranges.reduce((a, r) => a + r.end - r.start, 0);
  const slider = (label: string, value: number, set: (v: number) => void, min: number, max: number, step: number, unit: string) => (
    <>
      <label>{label}</label>
      <div className="row">
        <input type="range" className="grow" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />
        <span className="mono" style={{ width: 70, textAlign: 'right' }}>
          {value}
          {unit}
        </span>
      </div>
    </>
  );
  return (
    <Modal
      title="Remove Silence"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!ranges.length}
            onClick={() => {
              onClose();
              removeSilence({ thresholdDb, minDuration, padding, clipIds });
            }}
          >
            Remove {ranges.length || ''} silence{ranges.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className="form">
        {slider('Silent below', thresholdDb, setThreshold, -70, -15, 1, ' dB')}
        {slider('Longer than', minDuration, setMin, 0.1, 3, 0.05, ' s')}
        {slider('Keep around speech', padding, setPadding, 0, 0.5, 0.01, ' s')}
        <label>Listen to</label>
        <label className="check">
          <input type="checkbox" checked={onlySelected} disabled={!selection.length} onChange={(e) => setOnlySelected(e.target.checked)} />
          Only the selected clips {selection.length ? '' : '(nothing selected — all audio is used)'}
        </label>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        {ranges.length
          ? `Found ${ranges.length} silence${ranges.length === 1 ? '' : 's'} totalling ${total.toFixed(1)} s. They are ripple-deleted on every track, so picture and sound stay in sync. One undo step.`
          : 'No silences with these settings. Try a higher threshold or a shorter minimum.'}
      </div>
      {ranges.length > 0 && (
        <div className="silence-list mono tiny">
          {ranges.slice(0, 60).map((r, i) => (
            <span key={i}>
              {r.start.toFixed(2)}–{r.end.toFixed(2)}
            </span>
          ))}
          {ranges.length > 60 && <span>…</span>}
        </div>
      )}
    </Modal>
  );
}

