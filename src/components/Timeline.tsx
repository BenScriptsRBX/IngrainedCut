import { mediaSrc } from '../webBridge';
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Clip, MediaItem, Project, Track } from '../types';
import { S, setS, useEditor, beginGesture, gesture, endGesture, cancelGesture, commit, toast } from '../store';
import {
  clipEnd, clearRegion, ensureTrack, expandLinked, insertSpace, sequenceDuration, trackLabel, tracksOf, trimEnd, trimStart, maxSrc,
  splitWithLinks, razor, nid, nextAdjacent, prevAdjacent, DEFAULT_FX, linkedGroup, shiftClips,
} from '../ops';
import { engine } from '../engine';
import { fmtTC, parseTC, clamp, dbToGain, EPS } from '../time';
import { useShallow } from 'zustand/react/shallow';
import { Icon } from './Icons';
import { addMarker, addTextAt, applyTransition, importPaths, placeMediaAt, withLinks, filesToPaths } from '../actions';
import { openContextMenu } from './ContextMenu';
import { clipMenu } from './menus';
import { EFFECT_PRESETS } from './EffectsPanel';

export const HEADER_W = 172;
const RULER_H = 28;
const DIVIDER_H = 6;

let scrollEl: HTMLDivElement | null = null;

export function zoomTimeline(factor: number, anchorTime?: number) {
  const s = S();
  const z = clamp(s.zoom * factor, 1, 3000);
  if (!scrollEl) return setS({ zoom: z });
  const at = anchorTime ?? s.playhead;
  const xOnScreen = HEADER_W + at * s.zoom - scrollEl.scrollLeft;
  setS({ zoom: z });
  requestAnimationFrame(() => {
    if (scrollEl) scrollEl.scrollLeft = Math.max(0, HEADER_W + at * z - xOnScreen);
  });
}

/** Sequence time under a screen x position (for right-click menus on lanes and the ruler). */
export function timeAtClientX(clientX: number) {
  if (!scrollEl) return S().playhead;
  const r = scrollEl.getBoundingClientRect();
  return Math.max(0, (clientX - r.left + scrollEl.scrollLeft - HEADER_W) / S().zoom);
}

export function zoomToFit() {
  const s = S();
  const dur = Math.max(5, sequenceDuration(s.project));
  const w = (scrollEl?.clientWidth ?? 1000) - HEADER_W - 40;
  setS({ zoom: clamp(w / dur, 1, 3000) });
  requestAnimationFrame(() => scrollEl && (scrollEl.scrollLeft = 0));
}

const KIND_COLOR: Record<string, string> = {
  video: '#5468c4',
  audio: '#2b9478',
  image: '#9a68c9',
  text: '#c0538f',
  color: '#b8923f',
  adjustment: '#7d7d7d',
};

function pickInterval(zoom: number, fps: number) {
  const cands = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 3600];
  return cands.find((c) => c * zoom >= 80) ?? 3600;
}

interface DragState {
  type: 'move' | 'trim-l' | 'trim-r' | 'ripple-l' | 'ripple-r' | 'roll' | 'rate-l' | 'rate-r' | 'slip' | 'slide' | 'marquee' | 'scrub' | 'hand' | 'volume' | 'track-h';
  x0: number;
  y0: number;
  clipId?: string;
  ids?: string[];
  orig?: Map<string, { start: number; trackId: string; dur: number; in: number; speed: number; volume: number }>;
  scroll0?: number;
  t0?: number;
  dup?: boolean;
  insert?: boolean;
  trackId?: string;
  h0?: number;
  other?: string;
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const zoom = useEditor((s) => s.zoom);
  const tool = useEditor((s) => s.tool);
  const snapping = useEditor((s) => s.snapping);
  const linked = useEditor((s) => s.linkedSelection);
  const flash = useEditor((s) => s.flash);
  const targetVideo = useEditor((s) => s.targetVideo);
  const targetAudio = useEditor((s) => s.targetAudio);
  const ref = useRef<HTMLDivElement>(null);
  const [scrollX, setScrollX] = useState(0);
  const [viewW, setViewW] = useState(1200);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [ghost, setGhost] = useState<{ trackId: string; t: number; dur: number } | null>(null);
  const drag = useRef<DragState | null>(null);
  const fps = project.settings.fps;
  const dur = sequenceDuration(project);
  const contentW = HEADER_W + Math.max(dur + 60, (viewW - HEADER_W) / zoom + 10) * zoom;

  const vTracks = useMemo(() => tracksOf(project, 'video').slice().reverse(), [project.tracks]);
  const aTracks = useMemo(() => tracksOf(project, 'audio'), [project.tracks]);
  const contentH = RULER_H + vTracks.reduce((a, t) => a + t.height, 0) + DIVIDER_H + aTracks.reduce((a, t) => a + t.height, 0) + 60;

  useLayoutEffect(() => {
    scrollEl = ref.current;
    const el = ref.current!;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // keep the playhead in view during playback
  useEffect(
    () =>
      useEditor.subscribe((s, prev) => {
        const el = ref.current;
        if (!el || s.playhead === prev.playhead || !s.playing) return;
        const x = HEADER_W + s.playhead * s.zoom;
        if (x > el.scrollLeft + el.clientWidth - 30 || x < el.scrollLeft + HEADER_W) el.scrollLeft = Math.max(0, x - HEADER_W - 40);
      }),
    [],
  );

  const timeAt = useCallback((clientX: number) => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    return (clientX - r.left + el.scrollLeft - HEADER_W) / S().zoom;
  }, []);

  const laneAt = (clientX: number, clientY: number): string | null => {
    const el = document.elementFromPoint(clientX, clientY)?.closest('[data-track]') as HTMLElement | null;
    return el?.dataset.track ?? null;
  };

  const snapPoints = (exclude: Set<string>) => {
    const s = S();
    const pts = [0, s.playhead];
    if (s.project.inPoint != null) pts.push(s.project.inPoint);
    if (s.project.outPoint != null) pts.push(s.project.outPoint);
    for (const m of s.project.markers) pts.push(m.time);
    for (const c of s.project.clips) {
      if (exclude.has(c.id)) continue;
      pts.push(c.start, clipEnd(c));
    }
    return pts;
  };
  const snapT = (cands: number[], pts: number[], force = false): { delta: number; at: number | null } => {
    if (!S().snapping && !force) return { delta: 0, at: null };
    const thr = 8 / S().zoom;
    let best = { delta: 0, at: null as number | null, d: thr };
    for (const c of cands)
      for (const p of pts) {
        const d = Math.abs(p - c);
        if (d < best.d) best = { delta: p - c, at: p, d };
      }
    return { delta: best.delta, at: best.at };
  };

  // ---------- pointer handling ----------
  const onClipDown = (e: React.PointerEvent, c: Clip, zone: 'l' | 'r' | 'body' | 'vol') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const s = S();
    const track = s.project.tracks.find((t) => t.id === c.trackId)!;
    const t = timeAt(e.clientX);
    const tool = s.tool;
    if (tool === 'hand') return startHand(e);
    if (tool === 'razor') {
      const pts = snapPoints(new Set());
      const sn = snapT([t], [s.playhead, ...pts.filter((p) => p > c.start && p < clipEnd(c))]);
      const at = Math.round((t + sn.delta) * fps) / fps;
      try {
        if (e.shiftKey) commit('Razor All Tracks', (d) => razor(d, at));
        else commit('Razor', (d) => splitWithLinks(d, s.linkedSelection ? [c.id] : [c.id], at));
      } catch (err: any) {
        toast(err.message, 'error');
      }
      return;
    }
    if (tool === 'type') return addTextAt(t);
    if (track.locked) return;
    if (tool === 'trackfwd') {
      const ids = s.project.clips.filter((x) => (e.shiftKey || x.trackId === c.trackId) && x.start >= c.start - EPS).map((x) => x.id);
      setS({ selection: ids });
      return;
    }
    // selection
    let sel = s.selection;
    const group = s.linkedSelection && !e.altKey ? expandLinked(s.project, [c.id]) : [c.id];
    if (e.shiftKey || e.ctrlKey) {
      sel = sel.includes(c.id) ? sel.filter((id) => !group.includes(id)) : [...new Set([...sel, ...group])];
      setS({ selection: sel });
      if (zone === 'body') return;
    } else if (!sel.includes(c.id)) {
      sel = group;
      setS({ selection: sel });
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const ids = zone === 'body' ? (s.linkedSelection ? expandLinked(s.project, sel) : sel) : s.linkedSelection && !e.altKey ? linkedGroup(s.project, c).map((x) => x.id) : [c.id];
    const orig = new Map(s.project.clips.filter((x) => ids.includes(x.id) || x.id === c.id).map((x) => [x.id, { start: x.start, trackId: x.trackId, dur: x.duration, in: x.in, speed: x.speed, volume: x.volume }]));
    let type: DragState['type'] = 'move';
    if (zone === 'vol') type = 'volume';
    else if (zone === 'l' || zone === 'r') {
      const side = zone;
      if (tool === 'ripple') type = side === 'l' ? 'ripple-l' : 'ripple-r';
      else if (tool === 'rate') type = side === 'l' ? 'rate-l' : 'rate-r';
      else if (tool === 'rolling') type = 'roll';
      else type = side === 'l' ? 'trim-l' : 'trim-r';
    } else if (tool === 'slip') type = 'slip';
    else if (tool === 'slide') type = 'slide';
    let other: string | undefined;
    if (type === 'roll') {
      const nb = zone === 'r' ? nextAdjacent(s.project, c, fps) : prevAdjacent(s.project, c, fps);
      if (!nb) type = zone === 'r' ? 'trim-r' : 'trim-l';
      else other = nb.id;
    }
    drag.current = { type, x0: e.clientX, y0: e.clientY, clipId: c.id, ids, orig, t0: t, dup: e.altKey && type === 'move', other };
    beginGesture();
  };

  const startHand = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { type: 'hand', x0: e.clientX, y0: e.clientY, scroll0: ref.current!.scrollLeft };
  };

  const onLaneDown = (e: React.PointerEvent, track: Track) => {
    if (e.button !== 0) return;
    const s = S();
    if (s.tool === 'hand') return startHand(e);
    if (s.tool === 'type' && track.kind === 'video') return addTextAt(timeAt(e.clientX));
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (!e.shiftKey) setS({ selection: [] });
    const r = ref.current!.getBoundingClientRect();
    drag.current = { type: 'marquee', x0: e.clientX - r.left + ref.current!.scrollLeft, y0: e.clientY - r.top + ref.current!.scrollTop };
  };

  const onRulerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { type: 'scrub', x0: e.clientX, y0: e.clientY };
    scrubTo(e);
  };

  const scrubTo = (e: React.PointerEvent | PointerEvent) => {
    let t = Math.max(0, timeAt(e.clientX));
    if (e.shiftKey || S().snapping) {
      const sn = snapT([t], snapPoints(new Set()).filter((p) => p !== S().playhead), e.shiftKey);
      if (sn.at != null && (e.shiftKey || Math.abs(sn.delta) * S().zoom < 5)) t = sn.at;
    }
    engine.seek(Math.round(t * fps) / fps);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const s = S();
    const z = s.zoom;
    const dx = e.clientX - d.x0;
    const dtRaw = dx / z;
    const quant = (x: number) => Math.round(x * fps) / fps;
    switch (d.type) {
      case 'hand':
        ref.current!.scrollLeft = d.scroll0! - dx;
        return;
      case 'scrub':
        return scrubTo(e);
      case 'marquee': {
        const r = ref.current!.getBoundingClientRect();
        const x = e.clientX - r.left + ref.current!.scrollLeft;
        const y = e.clientY - r.top + ref.current!.scrollTop;
        const m = { x: Math.min(d.x0, x), y: Math.min(d.y0, y), w: Math.abs(x - d.x0), h: Math.abs(y - d.y0) };
        setMarquee(m);
        const t0 = (m.x - HEADER_W) / z;
        const t1 = (m.x + m.w - HEADER_W) / z;
        const rows = rowLayout(s.project);
        const hit = s.project.clips.filter((c) => {
          const row = rows.get(c.trackId);
          if (!row) return false;
          return c.start < t1 && clipEnd(c) > t0 && row.top < m.y + m.h && row.top + row.h > m.y;
        });
        let ids = hit.map((c) => c.id);
        if (s.linkedSelection) ids = expandLinked(s.project, ids);
        setS({ selection: ids });
        return;
      }
      case 'track-h': {
        const h = clamp(d.h0! + (e.clientY - d.y0), 28, 200);
        setS((st) => ({ project: { ...st.project, tracks: st.project.tracks.map((t) => (t.id === d.trackId ? { ...t, height: h } : t)) } }));
        return;
      }
    }
    if (Math.abs(dx) < 2 && Math.abs(e.clientY - d.y0) < 3 && d.type !== 'volume') return;
    const orig = d.orig!;
    const ids = d.ids!;
    const moving = new Set(ids);
    const main = orig.get(d.clipId!)!;
    const pts = snapPoints(moving);
    let snapAt: number | null = null;

    if (d.type === 'move') {
      const sn = snapT([main.start + dtRaw, main.start + main.dur + dtRaw], pts);
      snapAt = sn.at;
      let dt = quant(dtRaw + sn.delta);
      const minStart = Math.min(...ids.map((id) => orig.get(id)!.start));
      dt = Math.max(dt, -minStart);
      const grabbedTrack = s.project.tracks.find((t) => t.id === main.trackId)!;
      const overLane = laneAt(e.clientX, e.clientY);
      const overTrack = s.project.tracks.find((t) => t.id === overLane);
      let dIdx = 0;
      if (overTrack && overTrack.kind === grabbedTrack.kind) {
        const list = tracksOf(s.project, grabbedTrack.kind);
        dIdx = list.indexOf(overTrack) - list.indexOf(grabbedTrack);
      }
      const insert = e.ctrlKey;
      gesture((p) => {
        const movers: Clip[] = [];
        const linkMap = new Map<string, string>();
        for (const id of ids) {
          let c = p.clips.find((x) => x.id === id)!;
          const o = orig.get(id)!;
          if (d.dup) {
            const copy = structuredClone(c);
            copy.id = nid(p, 'c');
            if (c.linkId) {
              if (!linkMap.has(c.linkId)) linkMap.set(c.linkId, nid(p, 'L'));
              copy.linkId = linkMap.get(c.linkId)!;
            }
            p.clips.push(copy);
            c = copy;
          }
          const ot = p.tracks.find((t) => t.id === o.trackId)!;
          const list = tracksOf(p, ot.kind);
          const idx = clamp(list.indexOf(ot) + (ot.kind === grabbedTrack.kind ? dIdx : 0), 0, 99);
          const nt = ensureTrack(p, ot.kind, idx);
          if (nt.locked) throw new Error('locked');
          c.trackId = nt.id;
          c.start = o.start + dt;
          movers.push(c);
        }
        const mset = new Set(movers.map((m) => m.id));
        if (insert) {
          const byTrack = new Map<string, Clip[]>();
          for (const m of movers) byTrack.set(m.trackId, [...(byTrack.get(m.trackId) || []), m]);
          const st = Math.min(...movers.map((m) => m.start));
          const span = Math.max(...movers.map(clipEnd)) - st;
          for (const tid of byTrack.keys()) {
            for (const c of [...p.clips]) if (c.trackId === tid && !mset.has(c.id) && c.start < st && clipEnd(c) > st) splitAt(p, c, st);
            shiftClips(p, [tid], st, span, mset);
          }
        } else for (const m of movers) clearRegion(p, m.trackId, m.start, clipEnd(m), mset);
      });
    } else if (d.type === 'trim-l' || d.type === 'trim-r' || d.type === 'ripple-l' || d.type === 'ripple-r') {
      const left = d.type.endsWith('-l');
      const ripple = d.type.startsWith('ripple');
      const edge = left ? main.start : main.start + main.dur;
      const sn = snapT([edge + dtRaw], pts);
      snapAt = sn.at;
      const target = quant(edge + dtRaw + sn.delta);
      gesture((p) => {
        const groupIds = ids.filter((id) => {
          const o = orig.get(id)!;
          return left ? Math.abs(o.start - main.start) < 1e-3 : Math.abs(o.start + o.dur - (main.start + main.dur)) < 1e-3;
        });
        let delta = 0;
        for (const id of groupIds) {
          const c = p.clips.find((x) => x.id === id)!;
          if (left) {
            let ns = target;
            if (!ripple) {
              const prev = p.clips.filter((x) => x.trackId === c.trackId && !groupIds.includes(x.id) && clipEnd(x) <= orig.get(id)!.start + 1e-6).sort((a, b) => clipEnd(b) - clipEnd(a))[0];
              if (prev) ns = Math.max(ns, clipEnd(prev));
            }
            trimStart(p, c, Math.max(0, ns));
            delta = c.start - orig.get(id)!.start;
          } else {
            let ne = target;
            if (!ripple) {
              const next = p.clips.filter((x) => x.trackId === c.trackId && !groupIds.includes(x.id) && x.start >= orig.get(id)!.start + orig.get(id)!.dur - 1e-6).sort((a, b) => a.start - b.start)[0];
              if (next) ne = Math.min(ne, next.start);
            }
            trimEnd(p, c, ne);
            delta = clipEnd(c) - (orig.get(id)!.start + orig.get(id)!.dur);
          }
        }
        if (ripple && Math.abs(delta) > 1e-6) {
          const unlocked = p.tracks.filter((t) => !t.locked).map((t) => t.id);
          const gset = new Set(groupIds);
          if (left) {
            for (const id of groupIds) p.clips.find((x) => x.id === id)!.start -= delta;
            shiftClips(p, unlocked, main.start + main.dur - 1e-6, -delta, gset);
          } else shiftClips(p, unlocked, main.start + main.dur - 1e-6, delta, gset);
        }
      });
    } else if (d.type === 'roll') {
      const rightSide = !!s.gestureBase?.clips.find((x) => x.id === d.other && Math.abs(x.start - (main.start + main.dur)) < 1e-3);
      const cut = rightSide ? main.start + main.dur : main.start;
      const sn = snapT([cut + dtRaw], pts.filter((p) => Math.abs(p - cut) > 1e-6));
      snapAt = sn.at;
      const target = quant(cut + dtRaw + sn.delta);
      gesture((p) => {
        const a = p.clips.find((x) => x.id === (rightSide ? d.clipId : d.other))!;
        const b = p.clips.find((x) => x.id === (rightSide ? d.other : d.clipId))!;
        const lo = Math.max(a.start + 1 / fps, b.start - b.in / b.speed);
        const hi = Math.min(clipEnd(b) - 1 / fps, a.start + (maxSrc(p, a) - a.in) / a.speed);
        const nt = clamp(target, lo, hi);
        trimEnd(p, a, nt);
        trimStart(p, b, nt);
      });
    } else if (d.type === 'rate-l' || d.type === 'rate-r') {
      gesture((p) => {
        const c = p.clips.find((x) => x.id === d.clipId)!;
        const srcSpan = main.dur * main.speed;
        if (d.type === 'rate-r') {
          // can't stretch over the next clip on any of the group's tracks
          let room = Infinity;
          for (const g of linkedGroup(p, c)) {
            const next = p.clips.filter((x) => x.trackId === g.trackId && x.id !== g.id && x.start >= main.start + main.dur - 1e-6).sort((a, b) => a.start - b.start)[0];
            if (next) room = Math.min(room, next.start - main.start);
          }
          const nd = clamp(Math.min(quant(main.dur + dtRaw), room), srcSpan / 16, srcSpan / 0.1);
          c.duration = nd;
          c.speed = srcSpan / nd;
        } else {
          const end = main.start + main.dur;
          let floor = 0;
          for (const g of linkedGroup(p, c)) {
            for (const x of p.clips) if (x.trackId === g.trackId && x.id !== g.id && clipEnd(x) <= main.start + 1e-6) floor = Math.max(floor, clipEnd(x));
          }
          const ns = clamp(Math.max(floor, quant(main.start + dtRaw)), end - srcSpan / 0.1, end - srcSpan / 16);
          c.start = Math.max(0, ns);
          c.duration = end - c.start;
          c.speed = srcSpan / c.duration;
        }
        for (const g of linkedGroup(p, c)) {
          if (g.id === c.id) continue;
          g.start = c.start;
          g.duration = c.duration;
          g.speed = c.speed;
        }
      });
    } else if (d.type === 'slip') {
      gesture((p) => {
        for (const id of ids) {
          const c = p.clips.find((x) => x.id === id)!;
          const o = orig.get(id)!;
          c.in = clamp(o.in - dtRaw * o.speed, 0, Math.max(0, maxSrc(p, c) - c.duration * c.speed));
        }
      });
    } else if (d.type === 'slide') {
      const sn = snapT([main.start + dtRaw, main.start + main.dur + dtRaw], pts);
      snapAt = sn.at;
      const dt = quant(dtRaw + sn.delta);
      gesture((p) => {
        const c = p.clips.find((x) => x.id === d.clipId)!;
        const prev = prevAdjacent(p, c, fps);
        const next = nextAdjacent(p, c, fps);
        let lo = -Infinity;
        let hi = Infinity;
        if (prev) lo = -(prev.duration - 1 / fps);
        if (next) hi = next.duration - 1 / fps;
        if (prev) hi = Math.min(hi, (maxSrc(p, prev) - prev.in) / prev.speed - prev.duration);
        if (next) lo = Math.max(lo, -next.in / next.speed);
        const dd = clamp(dt, lo, hi);
        if (prev) trimEnd(p, prev, clipEnd(prev) + dd);
        c.start += dd;
        if (next) trimStart(p, next, next.start + dd);
      });
    } else if (d.type === 'volume') {
      const dy = e.clientY - d.y0;
      const v = clamp(Math.round((main.volume - dy * 0.25) * 10) / 10, -60, 15);
      gesture((p) => {
        const c = p.clips.find((x) => x.id === d.clipId)!;
        c.volume = v;
      });
    }
    setSnapLine(snapAt);
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    setSnapLine(null);
    setMarquee(null);
    if (!d) return;
    const labels: Record<string, string> = {
      move: d.dup ? 'Duplicate' : 'Move', 'trim-l': 'Trim', 'trim-r': 'Trim', 'ripple-l': 'Ripple Trim', 'ripple-r': 'Ripple Trim', roll: 'Rolling Edit',
      'rate-l': 'Rate Stretch', 'rate-r': 'Rate Stretch', slip: 'Slip', slide: 'Slide', volume: 'Clip Volume',
    };
    if (d.type === 'track-h') return;
    if (labels[d.type]) endGesture(labels[d.type]);
  };

  // ---------- drag & drop from bins / OS ----------
  const onDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    if (!types.includes('application/x-icut-media') && !types.includes('Files') && !types.includes('application/x-icut-effect')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const lane = laneAt(e.clientX, e.clientY);
    if (types.includes('application/x-icut-media') && lane) {
      const t = Math.max(0, timeAt(e.clientX));
      const sn = snapT([t], snapPoints(new Set()));
      setGhost({ trackId: lane, t: Math.round((t + sn.delta) * fps) / fps, dur: Number(sessionStorage.getItem('icut-drag-dur') || 5) });
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setGhost(null);
    const lane = laneAt(e.clientX, e.clientY);
    const t = Math.max(0, timeAt(e.clientX));
    const sn = snapT([t], snapPoints(new Set()));
    const at = Math.round((t + sn.delta) * fps) / fps;
    const eff = e.dataTransfer.getData('application/x-icut-effect');
    if (eff) {
      const clipEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement)?.closest('[data-clip]') as HTMLElement | null;
      const id = clipEl?.dataset.clip;
      if (!id) return toast('Drop effects onto a clip', 'info');
      applyEffectDrop(JSON.parse(eff), id, e.clientX, clipEl!);
      return;
    }
    const mid = e.dataTransfer.getData('application/x-icut-media');
    if (mid) {
      placeMediaAt(mid, lane, at, e.ctrlKey ? 'insert' : 'overwrite');
      return;
    }
    if (e.dataTransfer.files.length) {
      const paths = await filesToPaths([...e.dataTransfer.files]);
      const items = await importPaths(paths);
      let cursor = at;
      for (const m of items) {
        const created = placeMediaAt(m.id, lane, cursor, 'overwrite');
        if (created.length) cursor = Math.max(...created.map(clipEnd));
      }
    }
  };

  const playheadPx = HEADER_W; // offset of time 0 in content coords
  const rows = [...vTracks.map((t) => ({ t })), { divider: true as const }, ...aTracks.map((t) => ({ t }))];

  return (
    <div className="timeline">
      <TimelineHeader />
      <div
        className={`tl-scroll tool-${tool}`}
        ref={ref}
        onScroll={(e) => setScrollX((e.target as HTMLDivElement).scrollLeft)}
        onWheel={(e) => {
          if (e.ctrlKey || e.altKey) {
            e.preventDefault();
            zoomTimeline(e.deltaY < 0 ? 1.2 : 1 / 1.2, timeAt(e.clientX));
          } else if (e.shiftKey) {
            ref.current!.scrollLeft += e.deltaY;
          }
        }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          drag.current = null;
          cancelGesture();
        }}
        onDragOver={onDragOver}
        onDragLeave={() => setGhost(null)}
        onDrop={onDrop}
      >
        <div className="tl-content" style={{ width: contentW, height: contentH }}>
          <div className="tl-ruler-row" style={{ width: contentW }}>
            <div className="tl-corner">
              <span className="tl-seqname">{project.settings.name}</span>
            </div>
            <Ruler project={project} zoom={zoom} scrollX={scrollX} viewW={viewW} onDown={onRulerDown} />
            {project.inPoint != null && project.outPoint != null && project.outPoint > project.inPoint && (
              <div className="tl-inout" style={{ left: playheadPx + project.inPoint * zoom, width: (project.outPoint - project.inPoint) * zoom }} />
            )}
            {project.markers.map((m) => (
              <div
                key={m.id}
                className="tl-marker"
                title={m.name + (m.note ? '\n' + m.note : '')}
                style={{ left: playheadPx + m.time * zoom, ['--mc' as any]: m.color }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  engine.seek(m.time);
                }}
                onDoubleClick={() => {
                  const name = window.prompt('Marker name', m.name);
                  if (name != null) commit('Rename Marker', (d) => void (d.markers.find((x) => x.id === m.id)!.name = name));
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openContextMenu(e.clientX, e.clientY, [
                    { label: 'Rename…', action: () => {
                      const name = window.prompt('Marker name', m.name);
                      if (name != null) commit('Rename Marker', (d) => void (d.markers.find((x) => x.id === m.id)!.name = name));
                    } },
                    { label: 'Delete Marker', action: () => commit('Delete Marker', (d) => void (d.markers = d.markers.filter((x) => x.id !== m.id))) },
                  ]);
                }}
              />
            ))}
            <PlayheadHead />
          </div>
          {rows.map((r, i) =>
            'divider' in r ? (
              <div key="div" className="tl-divider" style={{ width: contentW }} />
            ) : (
              <TrackRow
                key={r.t.id}
                project={project}
                track={r.t}
                zoom={zoom}
                scrollX={scrollX}
                viewW={viewW}
                selection={selection}
                flash={flash}
                targeted={r.t.id === targetVideo || r.t.id === targetAudio}
                onClipDown={onClipDown}
                onLaneDown={onLaneDown}
                onResizeDown={(e) => {
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  drag.current = { type: 'track-h', x0: e.clientX, y0: e.clientY, trackId: r.t.id, h0: r.t.height };
                }}
                ghost={ghost && ghost.trackId === r.t.id ? ghost : null}
                linked={linked}
              />
            ),
          )}
          <PlayheadLine height={contentH} />
          {snapLine != null && <div className="tl-snapline" style={{ left: playheadPx + snapLine * zoom, height: contentH }} />}
          {marquee && <div className="tl-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
        </div>
      </div>
    </div>
  );
}

function splitAt(p: Project, c: Clip, t: number) {
  const right = structuredClone(c);
  right.id = nid(p, 'c');
  const leftDur = t - c.start;
  right.start = t;
  right.duration = c.duration - leftDur;
  right.in = c.in + leftDur * c.speed;
  right.linkId = null;
  c.duration = leftDur;
  p.clips.push(right);
}

function rowLayout(p: Project) {
  const map = new Map<string, { top: number; h: number }>();
  let y = RULER_H;
  for (const t of tracksOf(p, 'video').slice().reverse()) {
    map.set(t.id, { top: y, h: t.height });
    y += t.height;
  }
  y += DIVIDER_H;
  for (const t of tracksOf(p, 'audio')) {
    map.set(t.id, { top: y, h: t.height });
    y += t.height;
  }
  return map;
}

function applyEffectDrop(eff: any, clipId: string, clientX: number, el: HTMLElement) {
  const s = S();
  const c = s.project.clips.find((x) => x.id === clipId);
  if (!c) return;
  if (eff.kind === 'transition') {
    const r = el.getBoundingClientRect();
    const edge = clientX - r.left < r.width / 2 ? 'in' : 'out';
    const ids = withLinks([clipId]).filter((id) => {
      const x = s.project.clips.find((y) => y.id === id)!;
      return eff.audio ? x.kind === 'audio' : x.kind !== 'audio';
    });
    applyTransition(ids, edge, eff.type, 1);
    return;
  }
  const preset = EFFECT_PRESETS.find((p) => p.id === eff.id);
  if (!preset) return;
  if (preset.audio !== (c.kind === 'audio')) return toast(`${preset.label} applies to ${preset.audio ? 'audio' : 'video'} clips`, 'info');
  commit(`Apply ${preset.label}`, (d) => preset.apply(d.clips.find((x) => x.id === clipId)!, d));
  setS({ selection: [clipId], leftTab: 'effectControls' });
}

function TimelineHeader() {
  const s = useEditor(useShallow((st) => ({ playhead: st.playhead, fps: st.project.settings.fps, snapping: st.snapping, linked: st.linkedSelection, zoom: st.zoom })));
  const [edit, setEdit] = useState<string | null>(null);
  return (
    <div className="tl-header">
      {edit != null ? (
        <input
          className="tc-input big"
          autoFocus
          value={edit}
          onChange={(e) => setEdit(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              const t = parseTC(edit, s.fps, s.playhead);
              if (t != null) engine.seek(t);
              setEdit(null);
            }
            if (e.key === 'Escape') setEdit(null);
          }}
          onBlur={() => setEdit(null)}
        />
      ) : (
        <span className="tc big" onClick={() => setEdit(fmtTC(s.playhead, s.fps))} title="Click to type a timecode">
          {fmtTC(s.playhead, s.fps)}
        </span>
      )}
      <div className="tl-tools">
        <button className={'icon-btn' + (s.snapping ? ' on' : '')} title="Snap in Timeline (S)" onClick={() => setS({ snapping: !s.snapping })}>
          <Icon name="magnet" />
        </button>
        <button className={'icon-btn' + (s.linked ? ' on' : '')} title="Linked Selection" onClick={() => setS({ linkedSelection: !s.linked })}>
          <Icon name="link" />
        </button>
        <button className="icon-btn" title="Add Marker (M)" onClick={() => addMarker()}>
          <Icon name="marker" />
        </button>
        <button className="icon-btn" title="Zoom to sequence (\)" onClick={zoomToFit}>
          <Icon name="fit" />
        </button>
      </div>
      <span className="grow" />
      <Icon name="zoomOut" size={13} className="dim" />
      <input
        className="zoom-slider"
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={Math.log(s.zoom) / Math.log(3000)}
        onChange={(e) => zoomTimeline(Math.pow(3000, Number(e.target.value)) / S().zoom)}
      />
      <Icon name="zoomIn" size={13} className="dim" />
    </div>
  );
}

const Ruler = memo(function Ruler({ project, zoom, scrollX, viewW, onDown }: { project: Project; zoom: number; scrollX: number; viewW: number; onDown: (e: React.PointerEvent) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = Math.max(10, viewW - HEADER_W);
  const fps = project.settings.fps;
  useEffect(() => {
    const cv = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr;
    cv.height = RULER_H * dpr;
    const g = cv.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, RULER_H);
    const t0 = scrollX / zoom;
    const t1 = (scrollX + w) / zoom;
    const iv = pickInterval(zoom, fps);
    const minor = iv / (iv >= 1 ? (iv % 5 === 0 ? 5 : iv % 2 === 0 ? 4 : 2) : 5);
    g.strokeStyle = '#5b5b5b';
    g.fillStyle = '#9b9b9b';
    g.font = '10px Segoe UI, sans-serif';
    g.beginPath();
    for (let t = Math.floor(t0 / minor) * minor; t <= t1; t += minor) {
      const x = Math.round((t - t0) * zoom) + 0.5;
      const isMajor = Math.abs(t / iv - Math.round(t / iv)) < 1e-6;
      g.moveTo(x, RULER_H);
      g.lineTo(x, RULER_H - (isMajor ? 12 : 5));
      if (isMajor) g.fillText(fmtTC(t, fps), x + 3, 11);
    }
    g.stroke();
  }, [zoom, scrollX, w, fps]);
  return <canvas ref={ref} className="tl-ruler" style={{ left: HEADER_W + scrollX, width: w, height: RULER_H }} onPointerDown={onDown} />;
});

function PlayheadHead() {
  const ph = useEditor((s) => s.playhead);
  const zoom = useEditor((s) => s.zoom);
  return <div className="tl-ph-head" style={{ left: HEADER_W + ph * zoom }} />;
}
function PlayheadLine({ height }: { height: number }) {
  const ph = useEditor((s) => s.playhead);
  const zoom = useEditor((s) => s.zoom);
  return <div className="tl-ph-line" style={{ left: HEADER_W + ph * zoom, height: height - RULER_H }} />;
}

interface RowProps {
  project: Project;
  track: Track;
  zoom: number;
  scrollX: number;
  viewW: number;
  selection: string[];
  flash: Record<string, number>;
  targeted: boolean;
  linked: boolean;
  ghost: { t: number; dur: number } | null;
  onClipDown: (e: React.PointerEvent, c: Clip, zone: 'l' | 'r' | 'body' | 'vol') => void;
  onLaneDown: (e: React.PointerEvent, t: Track) => void;
  onResizeDown: (e: React.PointerEvent) => void;
}

function TrackRow({ project, track, zoom, scrollX, viewW, selection, flash, targeted, onClipDown, onLaneDown, onResizeDown, ghost }: RowProps) {
  const label = trackLabel(project, track);
  const clips = project.clips.filter((c) => c.trackId === track.id);
  const anySolo = project.tracks.some((t) => t.kind === 'audio' && t.solo);
  const setTrack = (patch: Partial<Track>, lbl: string) => commit(lbl, (d) => Object.assign(d.tracks.find((t) => t.id === track.id)!, patch));
  const visL = scrollX / zoom;
  const visR = (scrollX + viewW) / zoom;
  return (
    <div className={`tl-row ${track.kind} ${track.locked ? 'locked' : ''}`} style={{ height: track.height }}>
      <div className="tl-th">
        <button
          className={'tl-target' + (targeted ? ' on' : '')}
          title="Target track (source patching)"
          onClick={() => setS(track.kind === 'video' ? { targetVideo: track.id } : { targetAudio: track.id })}
        >
          {label}
        </button>
        <button className={'icon-btn sm' + (track.locked ? ' on warn' : '')} title="Toggle Track Lock" onClick={() => setTrack({ locked: !track.locked }, 'Lock Track')}>
          <Icon name={track.locked ? 'lock' : 'unlock'} size={12} />
        </button>
        {track.kind === 'video' ? (
          <button className={'icon-btn sm' + (track.hidden ? ' on warn' : '')} title="Toggle Track Output" onClick={() => setTrack({ hidden: !track.hidden }, 'Toggle Track Output')}>
            <Icon name={track.hidden ? 'eyeOff' : 'eye'} size={12} />
          </button>
        ) : (
          <>
            <button className={'tl-ms' + (track.muted ? ' mute' : '')} title="Mute Track" onClick={() => setTrack({ muted: !track.muted }, 'Mute Track')}>
              M
            </button>
            <button className={'tl-ms' + (track.solo ? ' solo' : '')} title="Solo Track" onClick={() => setTrack({ solo: !track.solo }, 'Solo Track')}>
              S
            </button>
          </>
        )}
        <span className="tl-tname">{track.name || (track.kind === 'video' ? 'Video ' : 'Audio ') + label.slice(1)}</span>
        {track.kind === 'audio' && anySolo && !track.solo && <span className="dim tiny">(muted by solo)</span>}
        <div className="tl-th-resize" onPointerDown={onResizeDown} />
      </div>
      <div className="tl-lane" data-track={track.id} onPointerDown={(e) => onLaneDown(e, track)}>
        {clips.map((c) =>
          clipEnd(c) < visL - 1 || c.start > visR + 1 ? null : (
            <ClipView
              key={c.id}
              clip={c}
              media={c.mediaId ? project.media.find((m) => m.id === c.mediaId) : undefined}
              zoom={zoom}
              visL={visL}
              visR={visR}
              height={track.height}
              selected={selection.includes(c.id)}
              flashTs={flash[c.id]}
              fps={project.settings.fps}
              onDown={onClipDown}
              project={project}
            />
          ),
        )}
        {ghost && <div className="tl-ghost" style={{ left: ghost.t * zoom, width: ghost.dur * zoom }} />}
      </div>
    </div>
  );
}

const ClipView = memo(function ClipView({
  clip: c, media, zoom, visL, visR, height, selected, flashTs, fps, onDown, project,
}: {
  clip: Clip; media?: MediaItem; zoom: number; visL: number; visR: number; height: number; selected: boolean; flashTs?: number; fps: number;
  onDown: RowProps['onClipDown']; project: Project;
}) {
  const left = c.start * zoom;
  const width = Math.max(2, c.duration * zoom);
  const color = c.label || KIND_COLOR[c.kind];
  const hasFx = JSON.stringify(c.fx) !== JSON.stringify(DEFAULT_FX) || (c.kind !== 'audio' && (c.transform.scale !== 100 || c.transform.x || c.transform.y || c.transform.rotation || c.transform.opacity !== 100)) || !!c.chromaKey?.enabled;
  const flashing = flashTs && Date.now() - flashTs < 2500;
  const zone = (e: React.PointerEvent): 'l' | 'r' | 'body' | 'vol' => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - r.left;
    const edge = Math.min(8, width / 4);
    if (x < edge) return 'l';
    if (x > r.width - edge) return 'r';
    if (c.kind === 'audio') {
      const y = e.clientY - r.top;
      const lineY = volY(c.volume, r.height);
      if (Math.abs(y - lineY) < 4) return 'vol';
    }
    return 'body';
  };
  return (
    <div
      className={`clip k-${c.kind} ${selected ? 'sel' : ''} ${c.enabled ? '' : 'disabled'}`}
      data-clip={c.id}
      style={{ left, width, ['--cc' as any]: color }}
      onPointerDown={(e) => onDown(e, c, zone(e))}
      onPointerMove={(e) => {
        const z = zone(e);
        const tool = S().tool;
        const el = e.currentTarget as HTMLElement;
        const cur = tool === 'razor' ? 'crosshair' : z === 'l' || z === 'r' ? (tool === 'ripple' ? 'col-resize' : 'ew-resize') : z === 'vol' ? 'ns-resize' : tool === 'hand' ? 'grab' : tool === 'slip' || tool === 'slide' ? 'ew-resize' : 'default';
        if (el.style.cursor !== cur) el.style.cursor = cur;
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const s = S();
        if (!s.selection.includes(c.id)) setS({ selection: s.linkedSelection ? expandLinked(s.project, [c.id]) : [c.id] });
        openContextMenu(e.clientX, e.clientY, clipMenu(c));
      }}
      onDoubleClick={() => {
        if (c.mediaId) setS({ source: { mediaId: c.mediaId, in: c.in, out: c.in + c.duration * c.speed, time: c.in }, leftTab: 'source' });
      }}
    >
      {c.kind === 'video' && media?.sprite && height > 34 && <Filmstrip clip={c} media={media} zoom={zoom} visL={visL} visR={visR} height={height} />}
      {(c.kind === 'image') && media?.thumb && height > 34 && <div className="clip-img" style={{ backgroundImage: `url("${mediaSrc(media.thumb)}")` }} />}
      {c.kind === 'audio' && media?.peaks && <Waveform clip={c} media={media} zoom={zoom} visL={visL} visR={visR} height={height} />}
      {c.kind === 'color' && <div className="clip-swatch" style={{ background: c.color }} />}
      <div className="clip-name">
        {hasFx && <span className="fx-badge">fx</span>}
        {c.speed !== 1 && <span className="speed-badge">{Math.round(c.speed * 100)}%</span>}
        {c.kind === 'text' && <Icon name="text" size={10} />}
        <span>{c.kind === 'text' ? c.text?.content.split('\n')[0] : c.name}</span>
      </div>
      {(c.fadeIn > 0 || c.fadeOut > 0) && (
        <svg className="clip-fades" width={width} height={height} preserveAspectRatio="none">
          {c.fadeIn > 0 && <polygon points={`0,${height} ${c.fadeIn * zoom},0 0,0`} />}
          {c.fadeOut > 0 && <polygon points={`${width},${height} ${width - c.fadeOut * zoom},0 ${width},0`} />}
        </svg>
      )}
      {c.transitionIn && <div className="clip-trans in" style={{ width: Math.min(width, c.transitionIn.duration * zoom) }} title={c.transitionIn.type}><span>{tLabel(c.transitionIn.type)}</span></div>}
      {c.transitionOut && <div className="clip-trans out" style={{ width: Math.min(width, c.transitionOut.duration * zoom) }} title={c.transitionOut.type}><span>{tLabel(c.transitionOut.type)}</span></div>}
      {c.kind === 'audio' && <div className="clip-vol" style={{ top: volY(c.volume, height) }} title={`${c.volume.toFixed(1)} dB — drag to change`} />}
      {c.keyframes && Object.values(c.keyframes).some((k) => k && k.length) && <span className="kf-badge">◆</span>}
      {flashing && <div key={flashTs} className="clip-flash" />}
      {media?.status === 'missing' && <div className="clip-missing">Media Offline</div>}
    </div>
  );
});

function tLabel(t: string) {
  return t.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function volY(db: number, h: number) {
  // 0 dB around 40% from top, -60 at bottom, +15 near top
  const n = (clamp(db, -60, 15) + 60) / 75;
  return clamp(h - n * h * 0.9 - 4, 14, h - 3);
}

function Filmstrip({ clip: c, media, zoom, visL, visR, height }: { clip: Clip; media: MediaItem; zoom: number; visL: number; visR: number; height: number }) {
  const sp = media.sprite!;
  const h = height - 16;
  const tw = (sp.tileW * h) / sp.tileH;
  const x0 = Math.max(0, (visL - c.start) * zoom);
  const x1 = Math.min(c.duration * zoom, (visR - c.start) * zoom);
  const tiles: React.ReactNode[] = [];
  const first = Math.floor(x0 / tw);
  for (let i = first; i * tw < x1 && tiles.length < 200; i++) {
    const src = c.in + ((i * tw) / zoom) * c.speed;
    const idx = clamp(Math.floor(src / sp.interval), 0, sp.tiles - 1);
    tiles.push(
      <div
        key={i}
        className="film-tile"
        style={{ left: i * tw, width: tw, height: h, backgroundImage: `url("${mediaSrc(sp.url)}")`, backgroundSize: `${sp.tiles * tw}px ${h}px`, backgroundPosition: `${-idx * tw}px 0` }}
      />,
    );
  }
  return <div className="filmstrip">{tiles}</div>;
}

function Waveform({ clip: c, media, zoom, visL, visR, height }: { clip: Clip; media: MediaItem; zoom: number; visL: number; visR: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const x0 = Math.max(0, (visL - c.start) * zoom);
  const x1 = Math.min(c.duration * zoom, (visR - c.start) * zoom);
  const w = Math.max(1, Math.ceil(x1 - x0));
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    cv.width = w;
    cv.height = height;
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, w, height);
    const peaks = media.peaks!;
    const gain = Math.min(2.5, dbToGain(c.volume));
    g.fillStyle = 'rgba(190,255,230,0.75)';
    const mid = height / 2 + 6;
    const amp = (height - 18) / 2;
    const perPx = (c.speed / zoom) * 100;
    for (let px = 0; px < w; px++) {
      const src = c.in + ((x0 + px) / zoom) * c.speed;
      const i0 = Math.floor(src * 100);
      const i1 = Math.max(i0 + 1, Math.floor(i0 + perPx));
      let m = 0;
      for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
      const v = Math.min(1, (m / 255) * gain) * amp;
      if (v > 0.3) g.fillRect(px, mid - v, 1, v * 2);
    }
  }, [w, height, x0, zoom, c.in, c.speed, c.volume, media.peaks]);
  return <canvas ref={ref} className="waveform" style={{ left: x0, width: w, height }} />;
}
