import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { HeroEditor } from '@/components/HeroEditor';
import { Reveal } from '@/components/Reveal';
import { SITE } from '@/lib/site';
import { HELPER_COMMAND } from '@/lib/helper';

const I = {
  chat: <path d="M4 5h16v11H8l-4 4z" />,
  cut: <path d="M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" />,
  eye: <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z" />,
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5" />,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  lock: <path d="M6 11h12v9H6zM8 11V8a4 4 0 018 0v3" />,
  wave: <path d="M3 12h2l2-6 3 12 3-9 2 5 2-2h4" />,
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />,
  agents: <path d="M7 8a3 3 0 100-6 3 3 0 000 6zM17 8a3 3 0 100-6 3 3 0 000 6zM2 21v-2a5 5 0 0110 0v2M12 21v-2a5 5 0 0110 0v2" />,
};
const Icon = ({ d }: { d: React.ReactNode }) => (
  <span className="icon-tile">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {d}
    </svg>
  </span>
);

const FEATURES = [
  { icon: I.chat, title: 'Edit by describing it', text: '“Tighten the intro”, “cut every um”, “make it vertical for Shorts”. Your AI agent makes the edit on the real timeline — every step is one undo away.' },
  { icon: I.eye, title: 'It sees what you see', text: 'Every message carries the full timeline: clips, tracks, effects, the playhead and your selection. It can look at frames of the program monitor to check its own work.' },
  { icon: I.cut, title: 'A real NLE underneath', text: 'Multi-track timeline, ripple, roll, slip, slide and rate-stretch tools, keyframes, colour, chroma key, transitions, titles and frame-accurate playback.' },
  { icon: I.layers, title: 'Motion graphics on demand', text: 'Ask for an intro, a lower third or animated captions: it builds a HyperFrames composition and drops the render straight onto your timeline — transparent where it should be.' },
  { icon: I.wave, title: 'Understands your footage', text: 'Silence and scene detection, loudness analysis and speech transcription, so it can cut by what was said, not just by guesswork.' },
  { icon: I.bolt, title: 'Fast, frame-accurate export', text: 'Hardware-accelerated decoding and encoding in your browser — a minute of 1080p in seconds — in H.264, HEVC, ProRes, VP9 or GIF.' },
];

const AGENTS = [
  { name: 'Claude', by: 'Anthropic', points: ['Uses your own Claude Code — your sign-in, skills and settings', 'Parallel sub-agents for big jobs', 'Continue an existing Claude Code chat inside the editor'] },
  { name: 'Codex', by: 'OpenAI', points: ['Sign in with your ChatGPT account or use an API key', 'Same editing tools, same timeline', 'Runs in a sandbox you control'] },
  { name: 'Cursor', by: 'Anysphere', points: ['Use your Cursor subscription', 'Pick any model your plan includes', 'Same editing tools, same timeline'] },
];

const FAQ = [
  { q: 'Does my footage get uploaded?', a: 'No. Media you import stays on your computer — in your browser’s private storage, or on your disk when the helper is running. Only the project timeline (clip positions, effects, titles — no video) is saved to your account so you can reopen it.' },
  { q: 'Do I need to install anything?', a: 'Not to edit: import, cut, add titles and effects, and export all run in your browser. To edit with AI, run the free IngrainedCut helper on your computer with one command — Claude, Codex or Cursor then run locally with your own account. The helper also adds transcription, silence and scene detection, and ProRes / GIF / MP3 export.' },
  { q: 'Which AI do I need?', a: 'Any one of Claude, Codex or Cursor, using your own account or API key with that provider. IngrainedCut does not resell AI access; usage is billed (or counted against your plan) by the provider under their terms.' },
  { q: 'Can the AI change things on my computer?', a: 'Editing actions are always allowed. Anything else — like running a shell command — asks you first unless you switch on “Bypass permissions” for that session.' },
  { q: 'Which browsers are supported?', a: 'Chrome and Edge on Windows, macOS and Linux. They have the video decoding and encoding features the editor relies on.' },
  { q: 'How much does it cost?', a: 'IngrainedCut is free while in early access. You pay your AI provider for AI usage under your own plan.' },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="hero">
          <div className="hero-glow" />
          <div className="container" style={{ position: 'relative' }}>
            <span className="eyebrow">● Early access · works with Claude, Codex & Cursor</span>
            <h1>
              The video editor
              <br />
              <span className="grad-text">you can talk to.</span>
            </h1>
            <p className="lead">{SITE.description}</p>
            <div className="hero-ctas">
              <Link href="/login?next=/projects" className="btn primary">
                Start editing — it&rsquo;s free
              </Link>
              <Link href="#how" className="btn">
                See how it works
              </Link>
            </div>
            <p className="hero-note">Chrome or Edge · your footage never leaves your computer</p>
            <HeroEditor />
          </div>
        </section>

        <section className="block" id="features">
          <div className="container">
            <Reveal className="section-head">
              <span className="eyebrow">Features</span>
              <h2>A professional editor with an AI collaborator built in.</h2>
              <p>Everything you expect from a timeline editor — plus an agent that can read it, cut it and check its own work.</p>
            </Reveal>
            <div className="grid3">
              {FEATURES.map((f, i) => (
                <Reveal key={f.title} delay={i * 70}>
                  <div className="card" style={{ height: '100%' }}>
                    <Icon d={f.icon} />
                    <h3>{f.title}</h3>
                    <p>{f.text}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="block" id="how">
          <div className="container split">
            <Reveal>
              <span className="eyebrow">How it works</span>
              <h2 style={{ fontSize: 'clamp(30px,4vw,44px)', letterSpacing: '-0.03em', lineHeight: 1.1, margin: '14px 0 10px' }}>Three steps to your first AI edit.</h2>
              <p className="muted" style={{ fontSize: 18 }}>
                The editor runs in your browser — nothing is uploaded. Add the free helper when you want AI: your agent runs on your own computer.
              </p>
            </Reveal>
            <Reveal delay={120}>
              <div className="steps">
                <div className="step">
                  <div>
                    <h3>Sign in with Google</h3>
                    <p>Your projects are saved to your account and open from any computer.</p>
                  </div>
                </div>
                <div className="step">
                  <div>
                    <h3>Edit in your browser</h3>
                    <p>Import footage, cut, add titles and export — right away, no install.</p>
                  </div>
                </div>
                <div className="step">
                  <div>
                    <h3>Add AI with the helper</h3>
                    <p>One command on Windows, macOS or Linux, then pick Claude, Codex or Cursor and describe the edit you want:</p>
                    <div className="cmd">{HELPER_COMMAND}</div>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="block" id="agents">
          <div className="container">
            <Reveal className="section-head">
              <span className="eyebrow">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {I.agents}
                </svg>
                AI agents
              </span>
              <h2>Bring the agent you already use.</h2>
              <p>Switch between them at any time — they all drive the same timeline through the same editing tools. Run several sub-agents at once for big jobs.</p>
            </Reveal>
            <div className="grid3">
              {AGENTS.map((a, i) => (
                <Reveal key={a.name} delay={i * 90}>
                  <div className="card agent-card" style={{ height: '100%' }}>
                    <span className="tag">by {a.by}</span>
                    <div className="agent-name">{a.name}</div>
                    <ul>
                      {a.points.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                </Reveal>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 18 }}>
              AI usage runs on your own account with each provider and is subject to their terms and pricing. Also available as an MCP server for any Claude Code session.
            </p>
          </div>
        </section>

        <section className="block" id="privacy">
          <div className="container split">
            <Reveal>
              <span className="eyebrow">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {I.lock}
                </svg>
                Privacy by design
              </span>
              <h2 style={{ fontSize: 'clamp(30px,4vw,44px)', letterSpacing: '-0.03em', lineHeight: 1.1, margin: '14px 0 10px' }}>Your footage never leaves your computer.</h2>
              <p className="muted" style={{ fontSize: 18 }}>
                Media is read, previewed and exported locally. We store your account and your project timelines — nothing else.
              </p>
              <ul className="check-list">
                <li>No video, audio or images uploaded to our servers</li>
                <li>AI runs through your own provider account, from your computer</li>
                <li>Only essential cookies — no ads, no trackers</li>
                <li>Delete a project or your whole account any time</li>
              </ul>
            </Reveal>
            <Reveal delay={120}>
              <div className="card" style={{ padding: 30 }}>
                <Icon d={I.undo} />
                <h3>Every AI edit is undoable</h3>
                <p>Each change lands in your undo history and flashes on the timeline, and every reply has a one-click “Revert these edits”. You stay the editor.</p>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="block">
          <div className="container" style={{ maxWidth: 820 }}>
            <Reveal className="section-head">
              <span className="eyebrow">FAQ</span>
              <h2>Questions, answered.</h2>
            </Reveal>
            <div className="faq">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="cta-band">
          <div className="container">
            <h2>
              Describe it. <span className="grad-text">Watch it happen.</span>
            </h2>
            <p className="muted" style={{ fontSize: 18, marginBottom: 28 }}>
              Free during early access.
            </p>
            <Link href="/login?next=/projects" className="btn primary">
              Start editing
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
