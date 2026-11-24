// Export settings: format (with ProRes / DNxHR flavours), size up to 8K, frame rate up to 240, quality or a target
// bitrate, GPU or CPU encoding, and audio settings. The last settings used are remembered.
import React, { useEffect, useMemo, useState } from 'react';
import { useEditor, toast } from '../store';
import { Modal } from './Widgets';
import { runExport, BROWSER_FORMATS, AUDIO_ONLY, bitrateFor, type ExportOptions, type ExportFormat } from '../exporter';
import { isBrowserEngine } from '../webBridge';
import { sequenceDuration } from '../ops';
import { fmtTC } from '../time';

const FORMATS: { id: ExportFormat; label: string; ext: string; group: string }[] = [
  { id: 'mp4-h264', label: 'H.264 (.mp4) — plays everywhere', ext: 'mp4', group: 'Video' },
  { id: 'mp4-h265', label: 'HEVC / H.265 (.mp4) — smaller files', ext: 'mp4', group: 'Video' },
  { id: 'mp4-av1', label: 'AV1 (.mp4) — smallest files', ext: 'mp4', group: 'Video' },
  { id: 'webm-vp9', label: 'VP9 (.webm)', ext: 'webm', group: 'Video' },
  { id: 'gif', label: 'Animated GIF (.gif)', ext: 'gif', group: 'Video' },
  { id: 'mov-prores', label: 'Apple ProRes (.mov)', ext: 'mov', group: 'Editing / master' },
  { id: 'mov-dnxhr', label: 'Avid DNxHR (.mov)', ext: 'mov', group: 'Editing / master' },
  { id: 'mp3', label: 'MP3 (.mp3)', ext: 'mp3', group: 'Audio only' },
  { id: 'm4a-aac', label: 'AAC (.m4a)', ext: 'm4a', group: 'Audio only' },
  { id: 'wav', label: 'WAV (.wav) — uncompressed', ext: 'wav', group: 'Audio only' },
  { id: 'flac', label: 'FLAC (.flac) — lossless', ext: 'flac', group: 'Audio only' },
];

/** sizes by their short side, so they fit any aspect ratio (16:9 → 7680×4320 for 8K; 9:16 → 4320×7680) */
const SIZES = [
  { id: '720', label: '720p HD', short: 720 },
  { id: '1080', label: '1080p Full HD', short: 1080 },
  { id: '1440', label: '1440p QHD / 2K', short: 1440 },
  { id: '2160', label: '2160p 4K UHD', short: 2160 },
  { id: '2880', label: '2880p 5K', short: 2880 },
  { id: '3240', label: '3240p 6K', short: 3240 },
  { id: '4320', label: '4320p 8K UHD', short: 4320 },
];
const FPS = [
  { v: 24000 / 1001, l: '23.976' },
  { v: 24, l: '24' },
  { v: 25, l: '25' },
  { v: 30000 / 1001, l: '29.97' },
  { v: 30, l: '30' },
  { v: 48, l: '48' },
  { v: 50, l: '50' },
  { v: 60000 / 1001, l: '59.94' },
  { v: 60, l: '60' },
  { v: 90, l: '90' },
  { v: 100, l: '100' },
  { v: 120000 / 1001, l: '119.88' },
  { v: 120, l: '120' },
  { v: 144, l: '144' },
  { v: 240, l: '240' },
];
const PRORES = [
  { v: 0, l: 'ProRes 422 Proxy', mbps: 45 },
  { v: 1, l: 'ProRes 422 LT', mbps: 102 },
  { v: 2, l: 'ProRes 422', mbps: 147 },
  { v: 3, l: 'ProRes 422 HQ', mbps: 220 },
  { v: 4, l: 'ProRes 4444', mbps: 330 },
];
const DNXHR = [
  { v: 'dnxhr_lb', l: 'DNxHR LB (low bandwidth)', mbps: 45 },
  { v: 'dnxhr_sq', l: 'DNxHR SQ (standard)', mbps: 145 },
  { v: 'dnxhr_hq', l: 'DNxHR HQ (high quality)', mbps: 220 },
  { v: 'dnxhr_hqx', l: 'DNxHR HQX (10-bit)', mbps: 220 },
  { v: 'dnxhr_444', l: 'DNxHR 444 (10-bit 4:4:4)', mbps: 440 },
];
const CODEC_FACTOR: Partial<Record<ExportFormat, number>> = { 'mp4-h264': 1, 'mp4-h265': 0.65, 'mp4-av1': 0.55, 'webm-vp9': 0.7 };

interface Saved {
  format: ExportFormat;
  quality: number;
  size: string;
  customW: number;
  fps: number;
  rateMode: 'quality' | 'bitrate';
  mbps: number;
  encoder: 'auto' | 'cpu';
  prores: number;
  dnxhr: string;
  audioKbps: number;
  sampleRate: number;
  bitDepth: 16 | 24;
}
const KEY = 'icut.export';
function loadSaved(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

const fmtSize = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1)} MB`);

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const seq = project.settings;
  const inBrowser = isBrowserEngine();
  const formats = inBrowser ? FORMATS.filter((f) => BROWSER_FORMATS.includes(f.id)) : FORMATS;
  const saved = useMemo(loadSaved, []);
  const [format, setFormat] = useState<ExportFormat>(formats.some((f) => f.id === saved.format) ? saved.format! : 'mp4-h264');
  const [quality, setQuality] = useState(saved.quality ?? 18);
  const [size, setSize] = useState(saved.size ?? 'seq');
  const [customW, setCustomW] = useState(saved.customW ?? seq.width);
  const [fps, setFps] = useState<number>(saved.fps ?? 0); // 0 = the sequence's
  const [rateMode, setRateMode] = useState<'quality' | 'bitrate'>(saved.rateMode ?? 'quality');
  const [mbps, setMbps] = useState(saved.mbps ?? 40);
  const [encoder, setEncoder] = useState<'auto' | 'cpu'>(saved.encoder ?? 'auto');
  const [prores, setProres] = useState(saved.prores ?? 3);
  const [dnxhr, setDnxhr] = useState(saved.dnxhr ?? 'dnxhr_hq');
  const [audioKbps, setAudioKbps] = useState(saved.audioKbps ?? 256);
  const [sampleRate, setSampleRate] = useState(saved.sampleRate ?? 48000);
  const [bitDepth, setBitDepth] = useState<16 | 24>(saved.bitDepth ?? 16);
  const hasInOut = project.inPoint != null && project.outPoint != null && project.outPoint > project.inPoint;
  const [range, setRange] = useState<'all' | 'in-out'>(hasInOut ? 'in-out' : 'all');
  const [path, setPath] = useState('');
  const fmt = FORMATS.find((f) => f.id === format)!;
  const ext = fmt.ext;
  const audioOnly = AUDIO_ONLY.includes(format);
  const isIntermediate = format === 'mov-prores' || format === 'mov-dnxhr';
  const hasRate = !audioOnly && !isIntermediate && format !== 'gif';
  const lossyAudio = format !== 'gif' && !['wav', 'flac'].includes(format) && !isIntermediate;
  const pcmAudio = ['wav', 'flac'].includes(format) || isIntermediate;

  useEffect(() => {
    if (inBrowser) return setPath(`${seq.name}.${ext}`);
    window.icut.appInfo().then((i) => {
      const dir = project.path ? project.path.replace(/[\\/][^\\/]+$/, '') : i.documents + '\\IngrainedCut';
      setPath(`${dir}\\${seq.name}.${ext}`);
    });
  }, []);
  useEffect(() => setPath((p) => p.replace(/\.[a-z0-9]+$/i, '.' + ext)), [ext]);

  // the output size: the sequence's, a preset (by its short side), a percentage, or a custom width
  const short = Math.min(seq.width, seq.height);
  const scale =
    size === 'seq' ? 1 : size.startsWith('pct') ? Number(size.slice(3)) / 100 : size === 'custom' ? Math.max(16, customW) / seq.width : (SIZES.find((x) => x.id === size)?.short ?? short) / short;
  const W = Math.round((seq.width * scale) / 2) * 2;
  const H = Math.round((seq.height * scale) / 2) * 2;
  const outFps = fps || seq.fps;
  const fpsLabel = (v: number) => FPS.find((f) => Math.abs(f.v - v) < 0.001)?.l ?? String(Math.round(v * 1000) / 1000);
  const tooBig = W > 8192 || H > 8192;
  const dur = range === 'in-out' && hasInOut ? project.outPoint! - project.inPoint! : sequenceDuration(project);

  // a rough size estimate, so 8K at 120 fps doesn't come as a surprise
  const videoBps = audioOnly
    ? 0
    : format === 'mov-prores'
      ? (PRORES.find((x) => x.v === prores)!.mbps * 1e6 * (W * H)) / (1920 * 1080) * (outFps / 29.97)
      : format === 'mov-dnxhr'
        ? (DNXHR.find((x) => x.v === dnxhr)!.mbps * 1e6 * (W * H)) / (1920 * 1080) * (outFps / 29.97)
        : format === 'gif'
          ? W * H * outFps * 0.6
          : rateMode === 'bitrate'
            ? mbps * 1e6
            : bitrateFor(quality, W, H, outFps, CODEC_FACTOR[format] ?? 1);
  const audioBps = format === 'gif' ? 0 : lossyAudio ? audioKbps * 1000 : format === 'flac' ? sampleRate * 2 * bitDepth * 0.6 : sampleRate * 2 * bitDepth;
  const estimate = ((videoBps + audioBps) / 8) * dur;

  const start = async () => {
    let out = path;
    if (inBrowser) {
      // the save picker must open inside this click
      const p = await window.icut.saveDialog({ title: 'Export', defaultPath: path, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
      if (!p) return;
      out = p;
    }
    const keep: Saved = { format, quality, size, customW, fps, rateMode, mbps, encoder, prores, dnxhr, audioKbps, sampleRate, bitDepth };
    try {
      localStorage.setItem(KEY, JSON.stringify(keep));
    } catch {}
    onClose();
    const o: ExportOptions = {
      path: out,
      format,
      quality,
      range,
      scale,
      fps: outFps,
      bitrate: hasRate && rateMode === 'bitrate' ? mbps * 1e6 : undefined,
      encoder,
      proresProfile: prores,
      dnxhrProfile: dnxhr,
      audioBitrate: audioKbps,
      sampleRate,
      bitDepth,
    };
    try {
      await runExport(o);
    } catch (e: any) {
      toast(e.message, 'error', 8000);
    }
  };

  const groups = [...new Set(formats.map((f) => f.group))];
  return (
    <Modal
      title="Export Settings"
      onClose={onClose}
      width={600}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={start} disabled={!path || dur <= 0 || tooBig}>
            Export
          </button>
        </>
      }
    >
      <div className="form">
        <label>Format</label>
        <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {formats
                .filter((f) => f.group === g)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        {format === 'mov-prores' && (
          <>
            <label>Profile</label>
            <select value={prores} onChange={(e) => setProres(Number(e.target.value))}>
              {PRORES.map((x) => (
                <option key={x.v} value={x.v}>
                  {x.l}
                </option>
              ))}
            </select>
          </>
        )}
        {format === 'mov-dnxhr' && (
          <>
            <label>Profile</label>
            <select value={dnxhr} onChange={(e) => setDnxhr(e.target.value)}>
              {DNXHR.map((x) => (
                <option key={x.v} value={x.v}>
                  {x.l}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {!audioOnly && (
        <>
          <div className="form-h">Video</div>
          <div className="form">
            <label>Resolution</label>
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="seq">
                Match sequence ({seq.width}×{seq.height})
              </option>
              <optgroup label="Presets">
                {SIZES.map((x) => {
                  const k = x.short / short;
                  return (
                    <option key={x.id} value={x.id}>
                      {x.label} — {Math.round((seq.width * k) / 2) * 2}×{Math.round((seq.height * k) / 2) * 2}
                    </option>
                  );
                })}
              </optgroup>
              <optgroup label="Scale">
                <option value="pct75">75%</option>
                <option value="pct50">50%</option>
                <option value="pct25">25%</option>
              </optgroup>
              <option value="custom">Custom width…</option>
            </select>
            {size === 'custom' && (
              <>
                <label>Width</label>
                <div className="row">
                  <input type="number" min={16} max={8192} step={2} value={customW} onChange={(e) => setCustomW(Number(e.target.value) || seq.width)} style={{ width: 100 }} />
                  <span className="dim">× {H} px (keeps the sequence's shape)</span>
                </div>
              </>
            )}
            <label>Frame rate</label>
            <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
              <option value={0}>Match sequence ({fpsLabel(seq.fps)} fps)</option>
              {FPS.map((f) => (
                <option key={f.l} value={f.v}>
                  {f.l} fps
                </option>
              ))}
            </select>
            {hasRate && (
              <>
                <label>Rate control</label>
                <select value={rateMode} onChange={(e) => setRateMode(e.target.value as any)}>
                  <option value="quality">Quality target</option>
                  <option value="bitrate">Bitrate (Mbps)</option>
                </select>
                {rateMode === 'quality' ? (
                  <>
                    <label>Quality</label>
                    <select value={quality} onChange={(e) => setQuality(Number(e.target.value))}>
                      <option value={14}>Maximum (large file)</option>
                      <option value={18}>High</option>
                      <option value={22}>Medium</option>
                      <option value={27}>Low (small file)</option>
                    </select>
                  </>
                ) : (
                  <>
                    <label>Bitrate</label>
                    <div className="row">
                      <input type="number" min={1} max={800} value={mbps} onChange={(e) => setMbps(Math.max(1, Number(e.target.value) || 1))} style={{ width: 100 }} />
                      <span className="dim">Mbps (YouTube 4K60 ≈ 50, 8K60 ≈ 150)</span>
                    </div>
                  </>
                )}
                {!inBrowser && (
                  <>
                    <label>Encoder</label>
                    <select value={encoder} onChange={(e) => setEncoder(e.target.value as any)}>
                      <option value="auto">Auto — GPU when available (fast)</option>
                      <option value="cpu">CPU — x264 / x265 / AV1 software (slower, best quality per MB)</option>
                    </select>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}

      {format !== 'gif' && (
        <>
          <div className="form-h">Audio</div>
          <div className="form">
            {lossyAudio && (
              <>
                <label>Bitrate</label>
                <select value={audioKbps} onChange={(e) => setAudioKbps(Number(e.target.value))}>
                  {[128, 192, 256, 320].map((k) => (
                    <option key={k} value={k}>
                      {k} kbps
                    </option>
                  ))}
                </select>
              </>
            )}
            <label>Sample rate</label>
            <select value={sampleRate} onChange={(e) => setSampleRate(Number(e.target.value))}>
              <option value={44100}>44.1 kHz</option>
              <option value={48000}>48 kHz</option>
              <option value={96000}>96 kHz</option>
            </select>
            {pcmAudio && (
              <>
                <label>Bit depth</label>
                <select value={bitDepth} onChange={(e) => setBitDepth(Number(e.target.value) as 16 | 24)}>
                  <option value={16}>16-bit</option>
                  <option value={24}>24-bit</option>
                </select>
              </>
            )}
          </div>
        </>
      )}

      <div className="form-h">Output</div>
      <div className="form">
        <label>Range</label>
        <select value={range} onChange={(e) => setRange(e.target.value as any)}>
          <option value="all">Entire Sequence</option>
          <option value="in-out" disabled={!hasInOut}>
            Sequence In/Out {hasInOut ? '' : '(not set)'}
          </option>
        </select>
        <label>{inBrowser ? 'File Name' : 'Output Name'}</label>
        <div className="row">
          <input className="grow" value={path} onChange={(e) => setPath(e.target.value)} />
          {!inBrowser && (
            <button
              className="btn"
              onClick={async () => {
                const p = await window.icut.saveDialog({ title: 'Export', defaultPath: path, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
                if (p) setPath(p);
              }}
            >
              Browse…
            </button>
          )}
        </div>
      </div>
      {inBrowser && <div className="hint">Encoded right here in your browser. ProRes, DNxHR, GIF and audio formats other than WAV need the IngrainedCut helper.</div>}
      {tooBig && <div className="hint" style={{ color: 'var(--danger)' }}>The largest export is 8K (8192 pixels on the long side).</div>}
      {!audioOnly && W * H >= 3840 * 2160 && outFps > 60 && (
        <div className="hint">4K and above at more than 60 fps renders slowly and makes very large files. Most GPUs can't hardware-encode H.264 past 4K, so those exports fall back to the CPU encoder.</div>
      )}
      <div className="export-summary">
        <div>
          <b>Video:</b> {audioOnly ? 'none' : `${W}×${H}, ${fpsLabel(outFps)} fps`}
        </div>
        <div>
          <b>Audio:</b> {format === 'gif' ? 'none' : `${sampleRate / 1000} kHz stereo${lossyAudio ? `, ${audioKbps} kbps` : `, ${bitDepth}-bit`}`}
        </div>
        <div>
          <b>Duration:</b> {fmtTC(dur, seq.fps)}
        </div>
        <div>
          <b>Estimated size:</b> about {fmtSize(estimate)}
        </div>
      </div>
    </Modal>
  );
}
