'use client';
// The animated editor on the home page: a user asks for an edit, the agent's tool calls appear,
// and the timeline below cuts out the silences, closes the gaps and drops in a title — on a loop.
import { useEffect, useRef, useState } from 'react';

type Clip = { id: string; track: 'v' | 'a' | 't'; left: number; width: number; cut?: boolean; flash?: boolean };

const START: Clip[] = [
  { id: 'v1', track: 'v', left: 0, width: 26 },
  { id: 'v2', track: 'v', left: 30, width: 22 },
  { id: 'v3', track: 'v', left: 57, width: 30 },
  { id: 'a1', track: 'a', left: 0, width: 26 },
  { id: 'a2', track: 'a', left: 30, width: 22 },
  { id: 'a3', track: 'a', left: 57, width: 30 },
];
const PROMPT = 'Cut the silences and add a lower third for Maya';
const TOOLS = [
  { label: 'Detect silence', detail: '3 gaps found' },
  { label: 'Cut out ranges', detail: '−4.6s' },
  { label: 'HyperFrames render', detail: 'lower-third.webm' },
  { label: 'Look at frame', detail: '00:00:03:12' },
];

export function HeroEditor() {
  const [typed, setTyped] = useState('');
  const [sent, setSent] = useState(false);
  const [tools, setTools] = useState(0);
  const [clips, setClips] = useState<Clip[]>(START);
  const [title, setTitle] = useState(false);
  const [reply, setReply] = useState('');
  const [ph, setPh] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    const run = () => {
      setTyped('');
      setSent(false);
      setTools(0);
      setClips(START);
      setTitle(false);
      setReply('');
      setPh(0);
      if (reduce) {
        setTyped(PROMPT);
        setSent(true);
        setTools(TOOLS.length);
        setTitle(true);
        setReply('Done — removed 3 silences (4.6s) and added the lower third at 0:01.');
        return;
      }
      let t = 400;
      for (let i = 1; i <= PROMPT.length; i++) at((t += 32), () => setTyped(PROMPT.slice(0, i)));
      at((t += 400), () => setSent(true));
      at((t += 700), () => setTools(1));
      at((t += 800), () => {
        setTools(2);
        setClips((cs) => cs.map((c) => ({ ...c, flash: true })));
      });
      at((t += 500), () =>
        // close the gaps: clips slide left
        setClips([
          { id: 'v1', track: 'v', left: 0, width: 26, flash: true },
          { id: 'v2', track: 'v', left: 26, width: 22, flash: true },
          { id: 'v3', track: 'v', left: 48, width: 30, flash: true },
          { id: 'a1', track: 'a', left: 0, width: 26, flash: true },
          { id: 'a2', track: 'a', left: 26, width: 22, flash: true },
          { id: 'a3', track: 'a', left: 48, width: 30, flash: true },
        ]),
      );
      at((t += 900), () => {
        setTools(3);
        setClips((cs) => [...cs.map((c) => ({ ...c, flash: false })), { id: 't1', track: 't', left: 6, width: 18, flash: true }]);
      });
      at((t += 700), () => setTitle(true));
      at((t += 500), () => setTools(4));
      const msg = 'Done — removed 3 silences (4.6s) and added the lower third at 0:01.';
      for (let i = 1; i <= msg.length; i += 2) at((t += 18), () => setReply(msg.slice(0, i)));
      at((t += 200), () => setClips((cs) => cs.map((c) => ({ ...c, flash: false }))));
      // play the cut
      for (let i = 0; i <= 100; i++) at(t + i * 45, () => setPh(i * 0.78));
      at((t += 6200), run);
    };
    run();
    return () => timers.current.forEach(clearTimeout);
  }, []);

  const tc = `00:00:${String(Math.floor(ph / 6)).padStart(2, '0')}:${String(Math.floor((ph * 5) % 30)).padStart(2, '0')}`;
  return (
    <div className="mock-wrap" aria-hidden="true">
      <div className="mock">
        <div className="mock-bar">
          <i />
          <i />
          <i />
          <span>Interview — rough cut</span>
        </div>
        <div className="mock-body">
          <div className="mock-main">
            <div className="mock-monitor">
              <div className="mock-screen">
                <div className={'title' + (title ? ' on' : '')}>
                  Maya Chen<small>Founder, Northwind</small>
                </div>
              </div>
              <span className="mock-tc">{tc}</span>
            </div>
            <div className="mock-timeline">
              {(['t', 'v', 'a'] as const).map((tr) => (
                <div key={tr} className="mock-track" data-label={tr === 't' ? 'V2' : tr === 'v' ? 'V1' : 'A1'}>
                  {clips
                    .filter((c) => c.track === tr)
                    .map((c) => (
                      <div key={c.id} className={`mock-clip ${tr}${c.cut ? ' cut' : ''}${c.flash ? ' flash' : ''}`} style={{ left: `${c.left}%`, width: `${c.width}%` }} />
                    ))}
                </div>
              ))}
              <div className="mock-ph" style={{ left: `calc(60px + ${ph}% * 0.93)` }} />
            </div>
          </div>
          <div className="mock-chat">
            <div className="mock-chat-head">
              <span className="dot" />
              Your AI editor
            </div>
            <div className="mock-chat-body">
              {sent && <div className="bubble-u">{PROMPT}</div>}
              {TOOLS.slice(0, tools).map((t) => (
                <div key={t.label} className="tool">
                  <b>{t.label}</b> {t.detail}
                  <span className="ok">✓</span>
                </div>
              ))}
              {reply && <div className="bubble-a">{reply}</div>}
            </div>
            <div className="mock-input">
              {!sent ? (
                <>
                  {typed}
                  <span className="caret" />
                </>
              ) : (
                'Ask for another edit…'
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
