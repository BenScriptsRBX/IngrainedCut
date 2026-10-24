import React, { useEffect, useRef, useState } from 'react';
import {
  useChat, sendMessage, stop, newChat, setModel, answerPermission, revertTurn, MODELS, EFFORTS, modelLabel, setDraft, setBypass, setMultiAgent,
  attachChat, detachChat, continueChat, type ChatItem, PROVIDERS, setProvider, agentName, loadCatalog, type Provider,
} from '../chatStore';
import { useEditor, setS } from '../store';
import { sequenceDuration } from '../ops';
import { fmtTC } from '../time';
import { Icon } from './Icons';
import { ProviderAuth } from './Dialogs';
import { HelperNeeded, MCP_APPS, useMcpApp } from './HelperConnect';
import { isBrowserEngine } from '../webBridge';

const SUGGESTIONS = [
  'Remove the silences and dead air from my clips',
  'Add a title at the start that says "My Trip" with a fade in',
  'Cut this down to a punchy 30-second highlight reel',
  'Give everything a warm, cinematic color grade',
  'Transcribe the dialogue and add captions',
  'Put cross dissolves between every clip on V1',
];

const TOOL_META: Record<string, { label: string; icon: string }> = {
  get_project_state: { label: 'Read timeline', icon: 'list' },
  import_media: { label: 'Import media', icon: 'folder' },
  add_clip: { label: 'Add clip', icon: 'film' },
  add_text: { label: 'Add text', icon: 'text' },
  add_captions: { label: 'Add captions', icon: 'text' },
  add_color_matte: { label: 'Add color matte', icon: 'layers' },
  add_adjustment_layer: { label: 'Add adjustment layer', icon: 'layers' },
  move_clip: { label: 'Move clip', icon: 'select' },
  trim_clip: { label: 'Trim clip', icon: 'ripple' },
  split_clip: { label: 'Razor cut', icon: 'razor' },
  delete_clips: { label: 'Delete clips', icon: 'trash' },
  ripple_delete_range: { label: 'Ripple delete range', icon: 'scissors' },
  ripple_delete_ranges: { label: 'Cut out ranges', icon: 'scissors' },
  close_gaps: { label: 'Close gaps', icon: 'ripple' },
  set_clip_properties: { label: 'Adjust clip', icon: 'wand' },
  add_transition: { label: 'Add transition', icon: 'layers' },
  remove_transition: { label: 'Remove transition', icon: 'layers' },
  set_keyframes: { label: 'Animate', icon: 'diamond' },
  manage_tracks: { label: 'Tracks', icon: 'list' },
  markers: { label: 'Markers', icon: 'marker' },
  set_playhead: { label: 'Move playhead', icon: 'play' },
  select_clips: { label: 'Select clips', icon: 'select' },
  set_sequence_settings: { label: 'Sequence settings', icon: 'gear' },
  capture_frame: { label: 'Look at frame', icon: 'eye' },
  capture_contact_sheet: { label: 'Skim frames', icon: 'grid' },
  screenshot_editor: { label: 'Look at editor', icon: 'eye' },
  detect_silence: { label: 'Detect silence', icon: 'audio' },
  detect_scenes: { label: 'Detect scenes', icon: 'film' },
  transcribe: { label: 'Transcribe', icon: 'mic' },
  analyze_loudness: { label: 'Measure loudness', icon: 'speaker' },
  undo: { label: 'Undo', icon: 'undo' },
  redo: { label: 'Redo', icon: 'redo' },
  batch: { label: 'Batch edit', icon: 'layers' },
  export_video: { label: 'Export', icon: 'export' },
  save_project: { label: 'Save project', icon: 'folder' },
  sync_clips: { label: 'Synchronize', icon: 'link' },
  remove_silence: { label: 'Remove silence', icon: 'scissors' },
  auto_color: { label: 'Auto color', icon: 'wand' },
  render_composition: { label: 'Render composition', icon: 'film' },
  relink_media: { label: 'Relink media', icon: 'link' },
};

function toolInfo(name: string) {
  const short = name.replace(/^mcp__ingrainedcut__/, '');
  const meta = TOOL_META[short];
  if (meta && short !== name) return { ...meta, editor: true };
  return { label: name, icon: 'wrench', editor: false };
}

function summarizeInput(name: string, input: any): string {
  if (!input || typeof input !== 'object') return '';
  const short = name.replace(/^mcp__ingrainedcut__/, '');
  if (short === 'batch') return `${input.operations?.length ?? 0} operations: ${(input.operations || []).map((o: any) => o.tool).slice(0, 6).join(', ')}`;
  if (short === 'ripple_delete_ranges') return `${input.ranges?.length ?? 0} ranges`;
  if (name === 'Bash') return input.command;
  if (name === 'Read' || name === 'Write' || name === 'Edit') return input.file_path;
  const bits: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (v == null) continue;
    const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
    bits.push(`${k}: ${val.length > 60 ? val.slice(0, 60) + '…' : val}`);
    if (bits.length >= 4) break;
  }
  return bits.join(' · ');
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function md(src: string) {
  const blocks = src.split(/```/);
  return blocks
    .map((b, i) => {
      if (i % 2 === 1) return `<pre><code>${esc(b.replace(/^\w*\n/, ''))}</code></pre>`;
      let h = esc(b);
      h = h.replace(/^### (.*)$/gm, '<h4>$1</h4>').replace(/^## (.*)$/gm, '<h3>$1</h3>').replace(/^# (.*)$/gm, '<h3>$1</h3>');
      h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
      h = h.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
      h = h.replace(/^(\s*)[-*] (.*)$/gm, '$1<li>$2</li>').replace(/^(\s*)\d+\. (.*)$/gm, '$1<li class="ol">$2</li>');
      h = h.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
      h = h.replace(/\n{2,}/g, '<br/><br/>').replace(/\n/g, '<br/>');
      h = h.replace(/<\/li><br\/>/g, '</li>').replace(/<ul><br\/>/g, '<ul>');
      return h;
    })
    .join('');
}

export function ChatPanel() {
  const { items, busy, thinking, info, model, effort, attachFrame, draft, totalCost, bypass, attached, continuing, provider } = useChat();
  const name = agentName(provider);
  const scroller = useRef<HTMLDivElement>(null);
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const playhead = useEditor((s) => s.playhead);
  const [stick, setStick] = useState(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick) el.scrollTop = el.scrollHeight;
  }, [items, thinking, stick]);

  const send = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('', false);
    setStick(true);
    sendMessage(t);
  };

  const dur = sequenceDuration(project);
  if (isBrowserEngine())
    return (
      <div className="chat">
        <div className="chat-head">
          <div className="chat-title">
            <span className="claude-mark">
              <Icon name="sparkle" size={14} />
            </span>
            AI
          </div>
          <span className="grow" />
          <button className="icon-btn" title="Hide (Ctrl+J)" onClick={() => setS({ showChat: false })}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="chat-scroll">
          <HelperNeeded />
        </div>
      </div>
    );
  return (
    <div className="chat">
      <div className="chat-head">
        <div className="chat-title">
          <span className="claude-mark">
            <Icon name="sparkle" size={14} />
          </span>
          {name}
        </div>
        <AgentState title={info ? `Connected · ${provider === 'claude' ? 'Claude agent ' : ''}${info.version ?? ''} · tools ${info.mcpStatus ?? ''}` : 'Starts when you send a message'} />
        <AgentsIndicator />
        <span className="grow" />
        <ModelPicker model={model} effort={effort} provider={provider} />
        <PastChats />
        <button className="icon-btn" title="New conversation" onClick={newChat}>
          <Icon name="newchat" size={15} />
        </button>
        <button className="icon-btn" title="Hide (Ctrl+J)" onClick={() => setS({ showChat: false })}>
          <Icon name="close" size={14} />
        </button>
      </div>

      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
      >
        {items.length === 0 && (
          <div className="chat-welcome">
            <div className="welcome-mark">
              <Icon name="sparkle" size={28} />
            </div>
            <h3>Edit with {name}</h3>
            <p>
              {name} sees your whole timeline — every clip, track, effect and the playhead — with each message, and edits it live through the IngrainedCut
              tools. Every change lands in the timeline and in Undo history.
            </p>
            <AuthCallout />
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggestion" onClick={() => setDraft(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {items.map((it) => (
          <ChatRow key={it.id} item={it} />
        ))}
        <ActivityLine name={name} />
      </div>

      <div className="chat-context">
        <span className="ctx-chip" title="A snapshot of the timeline is attached to every message">
          <Icon name="layers" size={11} /> Timeline · {project.clips.length} clips · {fmtTC(dur, project.settings.fps)}
        </span>
        <span className="ctx-chip" title="Playhead position">
          <Icon name="play" size={10} /> {fmtTC(playhead, project.settings.fps)}
        </span>
        {selection.length > 0 && (
          <span className="ctx-chip sel" title="Selected clips are included">
            <Icon name="select" size={11} /> {selection.length > 3 ? `${selection.length} selected` : selection.join(', ')}
          </span>
        )}
        <button className={'ctx-chip toggle' + (attachFrame ? ' on' : '')} onClick={() => useChat.setState({ attachFrame: !attachFrame })} title="Attach the current program monitor frame as an image">
          <Icon name="camera" size={11} /> Frame
        </button>
        {continuing && (
          <span className="ctx-chip chat-ref" title="This conversation continues an existing Claude Code chat">
            <Icon name="newchat" size={11} /> Continuing: {continuing.title.slice(0, 32)}
          </span>
        )}
        {attached.map((a) => (
          <span key={a.sessionId} className="ctx-chip chat-ref" title={`${a.messages} messages from this Claude Code chat go with your next message`}>
            <Icon name="attach" size={11} /> {a.title.slice(0, 32)}
            <button className="chip-x" onClick={() => detachChat(a.sessionId)} title="Remove">
              <Icon name="close" size={9} />
            </button>
          </span>
        ))}
      </div>

      <div className="chat-input">
        <textarea
          placeholder={busy ? `${name} is working — you can queue another message…` : `Ask ${name} to edit… e.g. "trim the first 3 seconds and add a fade in"`}
          value={draft}
          rows={3}
          onChange={(e) => setDraft(e.target.value, false)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="chat-input-bar">
          <button
            className={'perm-toggle' + (bypass ? ' on' : '')}
            onClick={() => setBypass(!bypass)}
            title={
              bypass
                ? `${name} runs every action (shell, file edits) without asking. Click to require approval.`
                : provider === 'claude'
                  ? 'Claude asks before shell commands and file edits. Click to bypass permissions — also approves anything waiting now.'
                  : `${name} runs shell commands sandboxed to the project folder. Click to give it full access.`
            }
          >
            <Icon name={bypass ? 'wand' : 'lock'} size={11} /> {bypass ? 'Bypass permissions' : provider === 'claude' ? 'Ask before actions' : 'Sandboxed'}
          </button>
          <span className="dim tiny">{totalCost > 0 ? `Session $${totalCost.toFixed(3)}` : ''}</span>
          <span className="grow" />
          {busy && (
            <button className="btn danger sm" onClick={stop} title={`Stop ${name}`}>
              <Icon name="stop" size={11} /> Stop
            </button>
          )}
          <button className="btn primary sm" onClick={send} disabled={!draft.trim()}>
            <Icon name="send" size={12} /> Send
          </button>
        </div>
      </div>
    </div>
  );
}

function ModelPicker({ model, effort, provider }: { model: string; effort: string; provider: Provider }) {
  const [open, setOpen] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const [custom, setCustom] = useState('');
  const [status, setStatus] = useState<Partial<Record<Provider, ProviderStatus | null>>>({});
  const multiAgent = useChat((s) => s.multiAgent);
  const catalog = useChat((s) => s.catalog[provider]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    loadCatalog(provider);
    for (const p of PROVIDERS) {
      window.icut.providerStatus(p.id).then(
        (st) => setStatus((x) => ({ ...x, [p.id]: st })),
        () => setStatus((x) => ({ ...x, [p.id]: null })),
      );
    }
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open, provider]);
  const list: { id: string; label: string; desc?: string }[] =
    provider === 'claude'
      ? MODELS.filter((m) => !m.older || showOlder || m.id === model)
      : provider === 'relay'
        ? [] // your own app uses its own model
        : [
          { id: '', label: provider === 'cursor' ? 'Auto' : 'Default model', desc: provider === 'cursor' ? 'Cursor picks the model' : 'The model set in your Codex config' },
          ...(catalog ?? []),
        ];
  const known = provider === 'relay' || list.some((m) => m.id === model);
  // Codex: the reasoning levels the chosen model supports; Cursor has no effort setting
  const efforts =
    provider === 'claude'
      ? EFFORTS
      : provider === 'codex'
        ? (catalog?.find((m) => m.id === model)?.efforts ?? ['low', 'medium', 'high', 'xhigh', 'max']).map((id) => EFFORTS.find((x) => x.id === id) ?? { id, desc: id })
        : [];
  const pick = (id: string) => {
    setModel(id, effort);
    setOpen(false);
  };
  const statusText = (st: ProviderStatus | null | undefined) =>
    st === undefined
      ? '…'
      : st === null
        ? ''
        : 'app' in st // your own app
          ? st.ready ? `Connected · ${st.method}` : 'Not connected'
          : !st.installed ? 'Not installed' : st.loggedIn ? `Signed in${st.method ? ' · ' + st.method : ''}` : st.apiKey ? 'Using API key' : 'Not signed in';
  const cur = status[provider];
  return (
    <div className="model-picker" ref={ref}>
      <button className={'model-btn' + (open ? ' open' : '')} onClick={() => setOpen(!open)} title="Choose agent, model and effort">
        <span className="model-name">{modelLabel(model, provider)}</span>
        {provider !== 'cursor' && provider !== 'relay' && <span className="model-effort">{effort}</span>}
        <Icon name="chevronDown" size={11} />
      </button>
      {open && (
        <div className="model-pop" onKeyDown={(e) => e.stopPropagation()}>
          <div className="mp-h">Agent</div>
          <div className="mp-providers">
            {PROVIDERS.map((p) => (
              <button key={p.id} className={'mp-provider' + (p.id === provider ? ' on' : '')} title={p.desc} onClick={() => setProvider(p.id)}>
                <span className="mp-label">{p.name}</span>
                <span className={'mp-desc' + (status[p.id] && !status[p.id]!.ready ? ' warn-text' : '')}>{statusText(status[p.id])}</span>
              </button>
            ))}
          </div>
          {provider === 'relay' && cur && !cur.ready && <RelaySetup />}
          {provider !== 'claude' && provider !== 'relay' && cur && !cur.ready && <ProviderAuth provider={provider} compact />}
          {provider !== 'relay' && <div className="mp-h">Model</div>}
          {provider !== 'claude' && provider !== 'relay' && !catalog && <div className="ag-empty">Loading models…</div>}
          {list.map((m) => (
            <div key={m.id || 'default'} className={'mp-item' + (m.id === model ? ' on' : '')} onClick={() => pick(m.id)}>
              <span className="mp-check">{m.id === model && <Icon name="check" size={12} />}</span>
              <span className="mp-text">
                <span className="mp-label">{m.label}</span>
                {m.desc && <span className="mp-desc">{m.desc}</span>}
              </span>
            </div>
          ))}
          {!known && (
            <div className="mp-item on">
              <span className="mp-check">
                <Icon name="check" size={12} />
              </span>
              <span className="mp-text">
                <span className="mp-label mono">{model}</span>
                <span className="mp-desc">Custom model ID</span>
              </span>
            </div>
          )}
          {provider === 'claude' && !showOlder && (
            <button className="link-btn mp-more" onClick={() => setShowOlder(true)}>
              Show older models
            </button>
          )}
          <div className="mp-custom" hidden={provider === 'relay'}>
            <input
              placeholder={provider === 'claude' ? 'Custom model ID, e.g. claude-sonnet-5-5' : 'Custom model ID'}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && custom.trim()) pick(custom.trim());
              }}
            />
            <button className="btn sm" disabled={!custom.trim()} onClick={() => pick(custom.trim())}>
              Use
            </button>
          </div>
          {efforts.length > 0 && (
            <>
              <div className="mp-h">{provider === 'codex' ? 'Reasoning effort' : 'Effort'}</div>
              <div className="mp-efforts">
                {efforts.map((x) => (
                  <button key={x.id} className={'chip' + (x.id === effort ? ' on' : '')} title={x.desc} onClick={() => setModel(model, x.id)}>
                    {x.id}
                  </button>
                ))}
              </div>
              <div className="mp-note">{efforts.find((x) => x.id === effort)?.desc ?? effort}. Changes apply to your next message and keep the conversation.</div>
            </>
          )}
          {provider === 'claude' && (
            <>
              <div className="mp-h">Parallel agents</div>
              <label className="mp-toggle">
                <input type="checkbox" checked={multiAgent} onChange={(e) => setMultiAgent(e.target.checked)} />
                Let Claude split work across parallel subagents (footage analyst, timeline editor, QC reviewer)
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** What the agent is doing right now, from the chat items (null while idle). */
function useActivity() {
  const s = useChat();
  if (!s.busy) return null;
  if (s.items.some((i) => i.kind === 'permission' && i.status === 'pending')) return { kind: 'wait' as const, text: 'Waiting for your approval' };
  const tool = [...s.items].reverse().find((i): i is Extract<ChatItem, { kind: 'tool' }> => i.kind === 'tool' && i.status === 'running');
  if (tool) return { kind: 'tool' as const, text: tool.name === 'Agent' || tool.name === 'Task' ? 'Running a subagent' : `Running: ${toolInfo(tool.name).label}` };
  if (s.openAssistant) return { kind: 'write' as const, text: 'Writing a reply' };
  if (s.statusNote) return { kind: 'note' as const, text: s.statusNote };
  return { kind: 'think' as const, text: 'Thinking' };
}

/** "12s", "1m 05s": time since the turn started, ticking. */
function Elapsed() {
  const since = useChat((s) => s.busySince);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (!since) return null;
  const sec = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return <span className="agent-elapsed">{sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`}</span>;
}

/** Header status: Idle / Working / Needs you, always visible. */
function AgentState({ title }: { title: string }) {
  const act = useActivity();
  const state = !act ? 'idle' : act.kind === 'wait' ? 'wait' : 'busy';
  return (
    <span className={'agent-state ' + state} title={act ? `${act.text} — ${title}` : title}>
      <span className="agent-state-dot" />
      {state === 'idle' ? 'Idle' : state === 'wait' ? 'Needs you' : 'Working'}
      {state !== 'idle' && <Elapsed />}
    </span>
  );
}

/** Bottom of the conversation while a turn runs: what the agent is doing and for how long. */
function ActivityLine({ name }: { name: string }) {
  const act = useActivity();
  if (!act) return null;
  return (
    <div className={'chat-thinking' + (act.kind === 'wait' ? ' wait' : '')}>
      <span className="dots">
        <i />
        <i />
        <i />
      </span>
      <span>
        <b>{name}</b> · {act.text}
      </span>
      <Elapsed />
    </div>
  );
}

const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};
const shortTool = (n?: string) => (n ? n.replace(/^mcp__ingrainedcut__/, '') : '');

/** Live count of everything working on this editor: the main Claude, its subagents, and external Claude Code sessions. */
function AgentsIndicator() {
  const busy = useChat((s) => s.busy);
  const agents = useChat((s) => s.agents);
  const externals = useChat((s) => s.externals);
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const subs = Object.values(agents);
  const running = subs.filter((a) => a.status === 'running' || a.status === 'pending');
  const extActive = externals.filter((e) => Date.now() - e.last < 90_000);
  const count = (busy ? 1 : 0) + running.length + extActive.length;
  if (!count && !subs.length) return null;
  return (
    <div className="agents-ind" ref={ref}>
      <button className={'agents-btn' + (count > 1 ? ' multi' : count ? ' one' : '')} onClick={() => setOpen(!open)} title="Agents working on this project">
        <span className="agents-pulse" />
        {count === 0 ? 'idle' : count === 1 ? '1 agent' : `${count} agents`}
      </button>
      {open && (
        <div className="agents-pop">
          <div className="mp-h">In this chat</div>
          <div className="ag-row">
            <span className={'ag-dot ' + (busy ? 'run' : 'idle')} />
            <span className="ag-main">
              <b>{agentName()}</b> <span className="dim">(main)</span>
            </span>
            <span className="dim tiny">{busy ? 'working' : 'idle'}</span>
          </div>
          {subs.map((a) => (
            <div key={a.taskId} className="ag-row">
              <span className={'ag-dot ' + (a.status === 'running' || a.status === 'pending' ? 'run' : a.status === 'completed' ? 'done' : 'fail')} />
              <span className="ag-main">
                <b>{a.type || 'agent'}</b> <span className="dim">{a.description}</span>
                <span className="ag-sub">
                  {a.status === 'running' ? `now: ${shortTool(a.lastTool) || 'starting'}` : a.status} · {a.toolUses} tools · {ago(a.started)}
                </span>
              </span>
            </div>
          ))}
          <div className="mp-h">Other Claude Code sessions (MCP)</div>
          {extActive.length ? (
            extActive.map((e) => (
              <div key={e.id} className="ag-row">
                <span className={'ag-dot ' + (Date.now() - e.last < 20_000 ? 'run' : 'idle')} />
                <span className="ag-main">
                  <b>{e.name}</b> <span className="dim">{e.id}</span>
                  <span className="ag-sub">
                    {e.calls} edits · last {shortTool(e.lastTool) || 'connected'} {ago(e.last)} ago
                  </span>
                </span>
              </div>
            ))
          ) : (
            <div className="ag-empty">None connected — see Help → Use your own Claude Code, Codex or Cursor.</div>
          )}
        </div>
      )}
    </div>
  );
}

function AgentCard({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  const run = useChat((s) => Object.values(s.agents).find((a) => a.toolUseId === item.id));
  const [open, setOpen] = useState(false);
  const status = run?.status ?? (item.status === 'running' ? 'running' : item.status === 'error' ? 'failed' : 'completed');
  const live = status === 'running' || status === 'pending';
  return (
    <div className={'tool-card agent-card ' + (live ? 'running' : status)} data-chat-id={item.id}>
      <div className="tool-head" onClick={() => setOpen(!open)}>
        <span className="tool-ico">{live ? <span className="spinner" /> : <Icon name={status === 'completed' ? 'check' : 'close'} size={12} />}</span>
        <span className="tool-name">{item.input?.subagent_type || run?.type || 'Agent'}</span>
        <span className="tool-sum">{item.input?.description || run?.description}</span>
        <Icon name={open ? 'chevronDown' : 'chevron'} size={10} />
      </div>
      {run && (
        <div className="agent-live">
          {live ? `Working · ${shortTool(run.lastTool) || 'starting'}` : status} · {run.toolUses} tools{run.steps.length ? ' · ' + run.steps.map(shortTool).join(' → ') : ''}
        </div>
      )}
      {open && (
        <div className="tool-body">
          <pre>{item.input?.prompt}</pre>
          {(run?.summary || item.result) && <pre className="tool-result">{item.result || run?.summary}</pre>}
        </div>
      )}
    </div>
  );
}

/** Pick an existing Claude Code conversation to attach as context or continue here. */
function PastChats() {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Awaited<ReturnType<typeof window.icut.listSessions>> | null>(null);
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    window.icut.listSessions().then(setList).catch(() => setList([]));
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const shown = (list ?? []).filter((s) => !q || (s.title + ' ' + (s.cwd ?? '')).toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  const run = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    try {
      await fn();
      setOpen(false);
    } finally {
      setBusyId(null);
    }
  };
  return (
    <div className="past-chats" ref={ref}>
      <button className={'icon-btn' + (open ? ' on' : '')} title="Use context from your Claude Code chats" onClick={() => setOpen(!open)}>
        <Icon name="attach" size={15} />
      </button>
      {open && (
        <div className="model-pop chats-pop" onKeyDown={(e) => e.stopPropagation()}>
          <div className="mp-h">Your Claude Code chats</div>
          <div className="search-row">
            <Icon name="search" size={12} />
            <input autoFocus placeholder="Search by title or folder" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="chats-list">
            {!list && <div className="ag-empty">Loading…</div>}
            {list && !shown.length && <div className="ag-empty">No conversations found.</div>}
            {shown.map((s) => (
              <div key={s.sessionId} className="chat-pick">
                <div className="cp-title">{s.title}</div>
                <div className="cp-meta">
                  {(s.cwd ?? '').split(/[\\/]/).slice(-2).join('/')} · {ago(s.lastModified)} ago
                </div>
                <div className="cp-btns">
                  <button className="btn sm" disabled={!!busyId} onClick={() => run(s.sessionId, () => attachChat(s.sessionId, s.title))} title="Send this chat's messages as context with your next message">
                    {busyId === s.sessionId ? '…' : 'Attach as context'}
                  </button>
                  <button className="btn sm" disabled={!!busyId} onClick={() => run(s.sessionId, () => continueChat(s.sessionId, s.title))} title="Continue that conversation here, with its full history (works on a copy)">
                    Continue here
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** "Your own app": connect a Claude Code, Codex or Cursor session the user runs, so it takes its prompts from this panel. */
function RelaySetup() {
  // the helper is already running (its command connected the app), so all that's left is starting a session
  const [app] = useMcpApp();
  return (
    <div>
      Open a {MCP_APPS[app]} session and say <b>connect to IngrainedCut</b>. Then type here.
    </div>
  );
}

function AuthCallout() {
  const provider = useChat((s) => s.provider);
  const [ready, setReady] = useState(true);
  useEffect(() => void window.icut.providerStatus(provider).then((s) => setReady(s.ready), () => setReady(true)), [provider]);
  // your own app connects (or drops) while the panel is open
  useEffect(() => window.icut.onRelayStatus((st) => provider === 'relay' && setReady(st.ready)), [provider]);
  if (ready) return null;
  if (provider === 'relay')
    return (
      <div className="auth-callout">
        <b>Almost there</b>
        <RelaySetup />
      </div>
    );
  if (provider === 'cursor')
    return (
      <div className="auth-callout">
        <b>Connect {agentName(provider)}</b>
        <ProviderAuth provider={provider} compact />
      </div>
    );
  // the built-in Claude / Codex chat runs on an API key; without one, messages go to the user's own app
  return (
    <div className="auth-callout">
      <b>Almost there</b>
      <RelaySetup />
      <div className="hint">
        Or add your own {provider === 'codex' ? 'OpenAI' : 'Anthropic'} API key in <a onClick={() => setS({ dialog: 'settings' })}>Settings</a> to use the
        built-in chat.
      </div>
    </div>
  );
}

function ChatRow({ item }: { item: ChatItem }) {
  const [open, setOpen] = useState(false);
  switch (item.kind) {
    case 'user':
      return (
        <div className="msg user" data-chat-id={item.id}>
          {item.frame && <img className="msg-frame" src={`data:image/jpeg;base64,${item.frame}`} />}
          <div className="bubble">{item.text}</div>
        </div>
      );
    case 'assistant':
      return (
        <div className="msg assistant" data-chat-id={item.id}>
          <div className="bubble md" dangerouslySetInnerHTML={{ __html: md(item.text) }} />
        </div>
      );
    case 'note':
      return (
        <div className="chat-note">
          <Icon name="newchat" size={12} /> {item.text}
        </div>
      );
    case 'tool': {
      if (item.name === 'Agent' || item.name === 'Task') return <AgentCard item={item} />;
      const ti = toolInfo(item.name);
      return (
        <div className={`tool-card ${item.status} ${ti.editor ? 'editor' : ''}`} data-chat-id={item.id}>
          <div className="tool-head" onClick={() => setOpen(!open)}>
            <span className="tool-ico">
              {item.status === 'running' ? <span className="spinner" /> : <Icon name={item.status === 'error' ? 'close' : ti.icon} size={12} />}
            </span>
            <span className="tool-name">{ti.label}</span>
            <span className="tool-sum">{summarizeInput(item.name, item.input)}</span>
            {item.images ? <span className="tool-img">🖼</span> : null}
            <Icon name={open ? 'chevronDown' : 'chevron'} size={10} />
          </div>
          {open && (
            <div className="tool-body">
              <pre>{JSON.stringify(item.input, null, 1)}</pre>
              {item.result && <pre className="tool-result">{item.result}</pre>}
            </div>
          )}
        </div>
      );
    }
    case 'permission':
      return (
        <div className={'perm-card ' + item.status}>
          <div className="perm-title">
            <Icon name="wrench" size={13} /> Claude wants to use <b>{item.toolName}</b>
          </div>
          <pre className="perm-input">{summarizeInput(item.toolName, item.input) || JSON.stringify(item.input, null, 1)}</pre>
          {item.status === 'pending' ? (
            <div className="perm-btns">
              <button className="btn primary sm" onClick={() => answerPermission(item.id, item.reqId, true)}>
                Allow once
              </button>
              <button className="btn sm" onClick={() => answerPermission(item.id, item.reqId, true, true)}>
                Always allow {item.toolName}
              </button>
              <button className="btn danger sm" onClick={() => answerPermission(item.id, item.reqId, false)}>
                Deny
              </button>
            </div>
          ) : (
            <div className="dim tiny">{item.status === 'allowed' ? 'Allowed' : 'Denied'}</div>
          )}
        </div>
      );
    case 'error':
      return (
        <div className="msg error">
          <Icon name="close" size={12} /> <span dangerouslySetInnerHTML={{ __html: md(item.text) }} />
          {/authenticat|api key|login/i.test(item.text) && (
            <button className="btn sm" onClick={() => setS({ dialog: 'settings' })}>
              Open Settings
            </button>
          )}
        </div>
      );
    case 'result':
      return (
        <div className="turn-foot">
          <span>
            {item.ok ? '✓' : '⚠'} {item.edits} edit{item.edits === 1 ? '' : 's'}
            {item.durationMs ? ` · ${(item.durationMs / 1000).toFixed(1)}s` : ''}
            {item.cost ? ` · $${item.cost.toFixed(3)}` : ''}
            {item.error && !item.ok ? ` · ${item.error}` : ''}
          </span>
          {item.edits > 0 && (
            <button className="link-btn" onClick={() => revertTurn(item.snapshot)}>
              <Icon name="undo" size={11} /> Revert these edits
            </button>
          )}
        </div>
      );
  }
}
