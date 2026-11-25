// Synchronize…, Remove Silence… and Import from Link… dialogs.
import React, { useMemo, useState } from 'react';
import { useEditor, toast } from '../store';
import { Modal } from './Widgets';
import { synchronizeSelection, type SyncMethod } from '../sync';
import { findSilences, removeSilence } from '../cutTools';
import { expandLinked } from '../ops';
import { engineMode } from '../webBridge';

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


/** File → Import from Link: download a video (or its audio) with yt-dlp through the helper / desktop app, or the extension in the browser. */
export function LinkDialog({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [quality, setQuality] = useState('1080');
  const [part, setPart] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [place, setPlace] = useState(true);
  const secs = (v: string) => {
    const t = v.trim();
    if (!t) return undefined;
    // 90, 1:30 or 1:02:30
    const n = t.split(':').reduce((a, x) => a * 60 + Number(x), 0);
    return Number.isFinite(n) ? n : undefined;
  };
  const ok = /^https?:\/\/\S+$/i.test(url.trim());
  const go = () => {
    if (!ok) return;
    onClose();
    const audioOnly = quality === 'audio';
    window.icut
      .downloadMedia({ url: url.trim(), audio_only: audioOnly, max_height: audioOnly ? undefined : Number(quality), start: part ? secs(from) : undefined, end: part ? secs(to) : undefined, place })
      .then((r) => toast(`Imported “${r.title}”`, 'success'))
      .catch((e: any) => toast(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error', 9000));
  };
  return (
    <Modal
      title="Import from Link"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ok} onClick={go}>
            Download
          </button>
        </>
      }
    >
      <div className="form">
        <label>Link</label>
        <input autoFocus placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        <label>Quality</label>
        <select value={quality} onChange={(e) => setQuality(e.target.value)}>
          <option value="720">720p</option>
          <option value="1080">1080p</option>
          <option value="1440">1440p</option>
          <option value="2160">4K</option>
          <option value="audio">Audio only</option>
        </select>
        <label>Part</label>
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={part} onChange={(e) => setPart(e.target.checked)} />
            Only part of it
          </label>
          {part && (
            <>
              <input style={{ width: 80 }} placeholder="from 1:30" value={from} onChange={(e) => setFrom(e.target.value)} />
              <input style={{ width: 80 }} placeholder="to 2:10" value={to} onChange={(e) => setTo(e.target.value)} />
            </>
          )}
        </div>
        <label>Timeline</label>
        <label className="check">
          <input type="checkbox" checked={place} onChange={(e) => setPlace(e.target.checked)} />
          Put it on the timeline at the playhead
        </label>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        YouTube, Twitch, X, TikTok, Reddit, Instagram, Vimeo and most other video sites.{' '}
        {engineMode() === 'browser'
          ? 'The IngrainedCut extension downloads it with yt-dlp right in this browser, into its storage. The whole video is downloaded; a part becomes the clip’s in and out points.'
          : 'It downloads on this computer with yt-dlp (fetched the first time) into the project’s Downloads folder.'}{' '}
        Only download videos you have the right to use.
      </div>
    </Modal>
  );
}
