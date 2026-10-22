// Playback controller: owns the program monitor compositor + audio engine and the play clock.
import { AudioEngine, Compositor } from './compositor';
import { S, setS, useEditor } from './store';
import { sequenceDuration } from './ops';

class Engine {
  comp: Compositor | null = null;
  audio: AudioEngine | null = null;
  private raf = 0;
  private startPerf = 0;
  private startT = 0;
  rate = 1;
  private pending = false;

  attach(canvas: HTMLCanvasElement) {
    this.comp?.dispose();
    this.comp = new Compositor(canvas);
    this.resize();
    this.requestRender();
  }

  getAudio() {
    if (!this.audio) this.audio = new AudioEngine();
    return this.audio;
  }

  resize() {
    if (!this.comp) return;
    const { project, previewScale } = S();
    this.comp.setSize(project.settings.width * previewScale, project.settings.height * previewScale);
    this.requestRender();
  }

  play(rate = 1) {
    const s = S();
    const end = s.project.outPoint ?? sequenceDuration(s.project);
    let t = s.playhead;
    if (rate > 0 && t >= end - 1e-3) t = s.project.inPoint ?? 0;
    this.rate = rate;
    this.startT = t;
    this.startPerf = performance.now();
    setS({ playing: true, playhead: t });
    this.getAudio().ctx.resume();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
  }

  pause() {
    cancelAnimationFrame(this.raf);
    setS({ playing: false });
    this.comp?.pauseAll();
    this.audio?.stopAll();
    this.requestRender();
  }

  toggle() {
    if (S().playing) this.pause();
    else this.play(1);
  }

  shuttle(dir: 1 | -1) {
    const s = S();
    if (!s.playing || Math.sign(this.rate) !== dir) return this.play(dir);
    const next = Math.max(-8, Math.min(8, this.rate * 2));
    this.startT = s.playhead;
    this.startPerf = performance.now();
    this.rate = next;
  }

  private loop = () => {
    const s = S();
    if (!s.playing) return;
    const p = s.project;
    let t = this.startT + ((performance.now() - this.startPerf) / 1000) * this.rate;
    const end = p.outPoint != null && s.playhead <= p.outPoint ? p.outPoint : sequenceDuration(p);
    let stop = false;
    if (this.rate > 0 && t >= end) {
      t = end;
      stop = true;
    }
    if (this.rate < 0 && t <= 0) {
      t = 0;
      stop = true;
    }
    setS({ playhead: t });
    if (this.rate > 0 && this.rate <= 4) {
      this.comp?.playStep(p, t, this.rate);
      this.getAudio().sync(p, t, true, this.rate);
    } else {
      this.comp?.render(p, t, 'seek');
      this.audio?.stopAll();
    }
    if (stop) return this.pause();
    this.raf = requestAnimationFrame(this.loop);
  };

  seek(t: number) {
    t = Math.max(0, t);
    setS({ playhead: t });
    if (S().playing) {
      this.startT = t;
      this.startPerf = performance.now();
    } else this.requestRender();
  }

  requestRender() {
    if (this.pending || S().playing) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      const s = S();
      this.comp?.render(s.project, s.playhead, 'seek');
    });
  }
}

export const engine = new Engine();

useEditor.subscribe((s, prev) => {
  const dimsChanged =
    s.project.settings.width !== prev.project.settings.width ||
    s.project.settings.height !== prev.project.settings.height ||
    s.previewScale !== prev.previewScale;
  if (dimsChanged) engine.resize();
  else if (!s.playing && (s.project !== prev.project || s.playhead !== prev.playhead)) engine.requestRender();
});
