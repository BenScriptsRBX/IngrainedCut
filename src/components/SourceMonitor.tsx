import { mediaSrc } from '../webBridge';
import React, { useEffect, useRef, useState } from 'react';
import { S, setS, useEditor } from '../store';
import { fmtTC } from '../time';
import { Icon } from './Icons';
import { sourceToTimeline } from '../actions';

export function SourceMonitor() {
  const source = useEditor((s) => s.source);
  const media = useEditor((s) => s.project.media.find((m) => m.id === s.source.mediaId));
  const fps = useEditor((s) => (media?.fps && media.type === 'video' ? media.fps : s.project.settings.fps));
  const vref = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const dur = media?.duration || 0;

  useEffect(() => {
    const v = vref.current;
    if (v && media && media.type !== 'image') {
      v.currentTime = source.time || 0;
      setT(source.time || 0);
    }
  }, [media?.id]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const v = vref.current;
      if (v) {
        setT(v.currentTime);
        if (source.out != null && !v.paused && v.currentTime >= source.out) v.pause();
      }
      raf = requestAnimationFrame(loop);
    };
    if (playing) raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, source.out]);

  if (!media)
    return (
      <div className="monitor source empty">
        <div className="empty-hint">
          <Icon name="film" size={28} />
          <div>Double-click a clip in the Project panel to open it here.</div>
          <div className="dim">Mark In (I) / Out (O), then Insert (,) or Overwrite (.)</div>
        </div>
      </div>
    );

  const seek = (x: number) => {
    const v = vref.current;
    const nt = Math.max(0, Math.min(dur, x));
    if (v) v.currentTime = nt;
    setT(nt);
  };
  const mark = (which: 'in' | 'out') => setS({ source: { ...S().source, [which]: t } });

  return (
    <div
      className="monitor source"
      tabIndex={0}
      onKeyDown={(e) => {
        const k = e.key.toLowerCase();
        if (k === 'i') (e.stopPropagation(), mark('in'));
        else if (k === 'o') (e.stopPropagation(), mark('out'));
        else if (k === ' ') {
          e.preventDefault();
          e.stopPropagation();
          const v = vref.current!;
          if (v.paused) v.play();
          else v.pause();
        } else if (k === 'arrowleft') (e.stopPropagation(), e.preventDefault(), seek(t - 1 / fps));
        else if (k === 'arrowright') (e.stopPropagation(), e.preventDefault(), seek(t + 1 / fps));
        else if (k === ',') (e.stopPropagation(), sourceToTimeline('insert'));
        else if (k === '.') (e.stopPropagation(), sourceToTimeline('overwrite'));
      }}
    >
      <div className="monitor-view src-view">
        {media.type === 'image' ? (
          <img src={mediaSrc(media.url)} className="src-media" />
        ) : (
          <video
            ref={vref}
            src={mediaSrc(media.url)}
            className="src-media"
            crossOrigin="anonymous"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            draggable={false}
          />
        )}
        {media.type === 'audio' && media.peaks && <SourceWave peaks={media.peaks} />}
      </div>
      {media.type !== 'image' && (
        <div
          className="src-scrub"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            seek(((e.clientX - r.left) / r.width) * dur);
          }}
          onPointerMove={(e) => {
            if (!e.buttons) return;
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            seek(((e.clientX - r.left) / r.width) * dur);
          }}
        >
          {source.in != null && source.out != null && (
            <div className="src-range" style={{ left: `${(source.in / dur) * 100}%`, width: `${((source.out - source.in) / dur) * 100}%` }} />
          )}
          <div className="src-ph" style={{ left: `${(t / dur) * 100}%` }} />
        </div>
      )}
      <div className="monitor-bar">
        <span className="tc">{fmtTC(t, fps)}</span>
        <span className="src-name" title={media.path}>
          {media.name}
        </span>
        <span className="grow" />
        <span className="tc dim">
          {source.in != null || source.out != null ? fmtTC((source.out ?? dur) - (source.in ?? 0), fps) : fmtTC(dur, fps)}
        </span>
      </div>
      <div className="transport">
        <button className="icon-btn" title="Mark In (I)" onClick={() => mark('in')}>
          <Icon name="markIn" />
        </button>
        <button className="icon-btn" title="Mark Out (O)" onClick={() => mark('out')}>
          <Icon name="markOut" />
        </button>
        <span className="sep" />
        <button className="icon-btn" onClick={() => seek(source.in ?? 0)} title="Go to In">
          <Icon name="toIn" />
        </button>
        <button className="icon-btn" onClick={() => seek(t - 1 / fps)}>
          <Icon name="stepBack" />
        </button>
        <button
          className="icon-btn play"
          onClick={() => {
            const v = vref.current;
            if (!v) return;
            if (v.paused) v.play();
            else v.pause();
          }}
        >
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>
        <button className="icon-btn" onClick={() => seek(t + 1 / fps)}>
          <Icon name="stepFwd" />
        </button>
        <button className="icon-btn" onClick={() => seek(source.out ?? dur)} title="Go to Out">
          <Icon name="toOut" />
        </button>
        <span className="sep" />
        <button className="icon-btn" title="Insert (,)" onClick={() => sourceToTimeline('insert')}>
          <Icon name="insert" />
        </button>
        <button className="icon-btn" title="Overwrite (.)" onClick={() => sourceToTimeline('overwrite')}>
          <Icon name="overwrite" />
        </button>
        <div
          className="drag-handle"
          draggable
          title="Drag the marked range to the timeline"
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-icut-media', media.id);
            sessionStorage.setItem('icut-drag-dur', String((source.out ?? dur) - (source.in ?? 0) || 5));
          }}
        >
          <Icon name="film" size={14} />
        </div>
      </div>
    </div>
  );
}

function SourceWave({ peaks }: { peaks: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const w = (cv.width = cv.clientWidth);
    const h = (cv.height = cv.clientHeight);
    const g = cv.getContext('2d')!;
    g.fillStyle = '#2fb38c';
    const per = peaks.length / w;
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let i = Math.floor(x * per); i < Math.floor((x + 1) * per); i++) m = Math.max(m, peaks[i]);
      const v = (m / 255) * (h / 2 - 4);
      g.fillRect(x, h / 2 - v, 1, v * 2);
    }
  }, [peaks]);
  return <canvas ref={ref} className="src-wave" />;
}
