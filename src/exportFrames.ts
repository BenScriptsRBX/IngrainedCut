// Frame-accurate, sequential WebCodecs decoding for export. Instead of seeking a <video> element for every
// exported frame, each video clip gets a hardware decoder that is fed the exact list of source timestamps the
// export will ask for, and streams the decoded frames in order. Clips are opened just before they are needed
// and closed right after, so sequences with hundreds of clips stay within decoder limits.
import { ALL_FORMATS, Input, UrlSource, VideoSampleSink, type VideoSample } from 'mediabunny';
import type { Clip, Project } from './types';
import { layersAt, srcTime } from './compositor';
import { mediaOf } from './ops';
import { mediaSrc } from './webBridge';

interface Plan {
  clip: Clip;
  url: string;
  times: number[]; // source times (seconds), one per frame the clip is drawn in, in export order
  first: number; // first export frame index
  last: number; // last export frame index
}

interface Stream {
  input: Input;
  gen: AsyncGenerator<VideoSample | null, void, unknown>;
  current: VideoSample | null;
  rotated: OffscreenCanvas | null;
  ready: boolean;
}

export interface FrameImage {
  img: CanvasImageSource;
  w: number;
  h: number;
}

const OPEN_AHEAD = 20; // frames of lead time to open a decoder before its clip appears

export class ExportFrames {
  private plans = new Map<string, Plan>();
  private streams = new Map<string, Promise<Stream | null>>();
  private resolved = new Map<string, Stream | null>();
  /** clips that could not be decoded with WebCodecs; the compositor falls back to <video> seeking for these */
  readonly fallback = new Set<string>();

  constructor(p: Project, frameTimes: number[]) {
    frameTimes.forEach((t, i) => {
      for (const l of layersAt(p, t)) {
        if (l.clip.kind !== 'video') continue;
        const m = mediaOf(p, l.clip);
        if (!m) continue;
        let plan = this.plans.get(l.clip.id);
        if (!plan) {
          plan = { clip: l.clip, url: new URL(mediaSrc(m.url), location.href).href, times: [], first: i, last: i };
          this.plans.set(l.clip.id, plan);
        }
        plan.times.push(srcTime(p, l.clip, l.local));
        plan.last = i;
      }
    });
  }

  /** Call once per export frame before rendering it: opens upcoming decoders, closes finished ones. */
  async beforeFrame(i: number) {
    for (const [id, plan] of this.plans) {
      if (!this.streams.has(id) && plan.first <= i + OPEN_AHEAD && plan.last >= i) this.streams.set(id, this.open(id, plan));
      if (plan.last < i && this.streams.has(id)) this.closeStream(id);
    }
    // the clips drawn in this frame must be ready before rendering
    const needed = [...this.plans].filter(([, pl]) => pl.first <= i && pl.last >= i).map(([id]) => this.streams.get(id));
    await Promise.all(needed);
  }

  private async open(id: string, plan: Plan): Promise<Stream | null> {
    try {
      const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(plan.url) });
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) {
        input.dispose();
        this.fallback.add(id);
        this.resolved.set(id, null);
        return null;
      }
      // <video>.currentTime 0 is the first frame; align decoder timestamps to that
      const offset = await track.getFirstTimestamp();
      const gen = new VideoSampleSink(track).samplesAtTimestamps(plan.times.map((t) => t + offset));
      const s: Stream = { input, gen, current: null, rotated: null, ready: true };
      this.resolved.set(id, s);
      return s;
    } catch (e) {
      console.warn('WebCodecs decode unavailable for clip', id, e);
      this.fallback.add(id);
      this.resolved.set(id, null);
      return null;
    }
  }

  /** True if this clip's frames come from WebCodecs (else the compositor seeks its <video>). */
  handles(clipId: string) {
    return !!this.resolved.get(clipId);
  }

  /** Decode the next frame of a clip (exactly one call per frame the clip is drawn in). */
  async advance(clipId: string) {
    const s = this.resolved.get(clipId);
    if (!s) return;
    const r = await s.gen.next();
    s.current?.close();
    s.current = r.done ? null : r.value ?? null;
    s.rotated = null;
  }

  /** The decoded frame to draw for a clip, with rotation metadata applied like a <video> element would. */
  image(clipId: string): FrameImage | null {
    const s = this.resolved.get(clipId);
    const smp = s?.current;
    if (!s || !smp) return null;
    if (smp.rotation) {
      if (!s.rotated) {
        const swap = smp.rotation === 90 || smp.rotation === 270;
        const w = swap ? smp.displayHeight : smp.displayWidth;
        const h = swap ? smp.displayWidth : smp.displayHeight;
        s.rotated = new OffscreenCanvas(w, h);
        smp.drawWithFit(s.rotated.getContext('2d')!, { fit: 'fill', rotation: smp.rotation });
      }
      return { img: s.rotated, w: s.rotated.width, h: s.rotated.height };
    }
    const img = smp.toCanvasImageSource();
    return { img, w: smp.displayWidth, h: smp.displayHeight };
  }

  private closeStream(id: string) {
    const p = this.streams.get(id);
    this.streams.delete(id);
    this.plans.delete(id);
    p?.then((s) => {
      if (!s) return;
      s.current?.close();
      s.gen.return(undefined).catch(() => {});
      s.input.dispose();
      this.resolved.delete(id);
    });
  }

  close() {
    for (const id of [...this.streams.keys()]) this.closeStream(id);
  }
}
