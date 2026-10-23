import { create } from 'zustand';
import type { Project } from './types';
import { S, commit, toast } from './store';
import { contextBlock } from './claudeTools';
import { engine } from './engine';

export type ChatItem =
  | { kind: 'user'; id: string; text: string; frame?: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'tool'; id: string; name: string; input: any; status: 'running' | 'done' | 'error'; result?: string; images?: number }
  | { kind: 'permission'; id: string; reqId: number; toolName: string; input: any; status: 'pending' | 'allowed' | 'denied' }
  | { kind: 'error'; id: string; text: string }
  | { kind: 'result'; id: string; ok: boolean; cost?: number; durationMs?: number; edits: number; snapshot: Project; error?: string }
  | { kind: 'note'; id: string; text: string };

export interface AgentRun {
  taskId: string;
  toolUseId?: string;
  description: string;
  type?: string;
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'killed' | 'pending' | 'paused';
  lastTool?: string;
  steps: string[];
  toolUses: number;
  tokens: number;
  started: number;
  ended?: number;
  summary?: string;
}

export interface ExternalAgent {
  id: string;
  name: string;
  since: number;
  last: number;
  lastTool?: string;
  calls: number;
}

export interface AttachedChat {
  sessionId: string;
  title: string;
  text: string;
  messages: number;
}

export type Provider = 'claude' | 'codex' | 'cursor' | 'relay';

export const PROVIDERS: { id: Provider; name: string; short: string; desc: string }[] = [
  { id: 'claude', name: 'Claude', short: 'Claude', desc: 'Anthropic Claude with your Claude account or API key' },
  { id: 'codex', name: 'Codex', short: 'Codex', desc: 'OpenAI Codex with your ChatGPT account or OpenAI API key' },
  { id: 'cursor', name: 'Cursor', short: 'Cursor', desc: 'Cursor Agent with your Cursor account' },
  { id: 'relay', name: 'Your own app', short: 'Your app', desc: 'Your own Claude Code, Codex or Cursor session, on your own plan, taking prompts from here' },
];

/** settings keys holding each provider's model and effort (Cursor has no effort setting) */
const MODEL_KEYS: Record<Provider, [string, string | null]> = { claude: ['model', 'effort'], codex: ['codexModel', 'codexEffort'], cursor: ['cursorModel', null], relay: ['relayModel', null] };

export const agentName = (p: Provider = useChat.getState().provider) => PROVIDERS.find((x) => x.id === p)?.short ?? 'Claude';

interface ChatState {
  provider: Provider;
  /** when the current turn started (null while idle) */
  busySince: number | null;
  /** the agent's latest progress note (retries, reconnects…) for this turn */
  statusNote: string | null;
  /** model lists fetched from the Codex / Cursor CLIs */
  catalog: Partial<Record<Provider, ProviderModel[]>>;
  items: ChatItem[];
  busy: boolean;
  thinking: boolean;
  openAssistant: string | null;
  info: { model?: string; mcpStatus?: string; apiKeySource?: string; version?: string } | null;
  model: string;
  effort: string;
  attachFrame: boolean;
  turnStart: { snapshot: Project; historyLen: number } | null;
  totalCost: number;
  draft: string;
  bypass: boolean;
  multiAgent: boolean;
  agents: Record<string, AgentRun>;
  externals: ExternalAgent[];
  attached: AttachedChat[];
  continuing: { sessionId: string; title: string } | null;
}

export const useChat = create<ChatState>()(() => ({
  provider: 'claude',
  busySince: null,
  statusNote: null,
  catalog: {},
  bypass: false,
  multiAgent: true,
  agents: {},
  externals: [],
  attached: [],
  continuing: null,
  items: [],
  busy: false,
  thinking: false,
  openAssistant: null,
  info: null,
  model: 'claude-opus-5-5',
  effort: 'medium',
  attachFrame: false,
  turnStart: null,
  totalCost: 0,
  draft: '',
}));

export function setDraft(draft: string, focus = true) {
  useChat.setState({ draft });
  if (focus) setTimeout(() => (document.querySelector('.chat-input textarea') as HTMLTextAreaElement | null)?.focus(), 30);
}

const C = () => useChat.getState();
const setC = (p: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => useChat.setState(p as any);
let seq = 0;
const nid = () => `i${++seq}`;

export const MODELS: { id: string; label: string; desc: string; older?: boolean }[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', desc: 'Recommended. Strong reasoning at a good speed for editing.' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', desc: 'Most capable. Best for big, open-ended edits; slower and pricier.' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', desc: 'Fast and capable. Great for everyday edits.' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', desc: 'Fastest and cheapest. Good for quick, simple changes.' },
  { id: 'claude-opus-5', label: 'Opus 5', desc: 'Previous Opus.', older: true },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', desc: 'Previous Sonnet.', older: true },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', desc: 'Older Opus.', older: true },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', desc: 'Older Haiku.', older: true },
];

export const EFFORTS = [
  { id: 'low', desc: 'Quickest replies' },
  { id: 'medium', desc: 'Balanced (default)' },
  { id: 'high', desc: 'Thinks harder about complex edits' },
  { id: 'xhigh', desc: 'Very thorough' },
  { id: 'max', desc: 'Maximum reasoning, slowest' },
];

export function modelLabel(id: string, provider: Provider = C().provider) {
  if (provider === 'relay') return 'Your own app';
  if (provider === 'claude') return MODELS.find((m) => m.id === id)?.label ?? id;
  if (!id) return provider === 'cursor' ? 'Auto' : 'Default model';
  return C().catalog[provider]?.find((m) => m.id === id)?.label ?? id;
}

export async function loadCatalog(p: Provider) {
  if (p === 'claude' || p === 'relay' || C().catalog[p]?.length) return;
  const list = await window.icut.providerModels(p).catch(() => []);
  setC((s) => ({ catalog: { ...s.catalog, [p]: list } }));
}

function applyProviderSettings(st: any) {
  const provider: Provider = PROVIDERS.some((p) => p.id === st.provider) ? st.provider : 'claude';
  const [mk, ek] = MODEL_KEYS[provider];
  setC({ provider, model: st[mk] || (provider === 'claude' ? 'claude-opus-5-5' : ''), effort: (ek && st[ek]) || 'medium' });
}

/** Switch the chat to Claude, Codex or Cursor. Starts a fresh conversation with that agent. */
export async function setProvider(p: Provider) {
  if (p === C().provider) return;
  if (C().busy) return toast(`Wait for ${agentName()} to finish, or press Stop first`, 'info');
  applyProviderSettings(await window.icut.agentSetProvider(p));
  setC({ items: [], agents: {}, turnStart: null, attached: [], continuing: null, info: null, openAssistant: null });
  push({ kind: 'note', id: nid(), text: `Now chatting with ${PROVIDERS.find((x) => x.id === p)!.name}. It sees your timeline and edits it with the same IngrainedCut tools.` });
  loadCatalog(p);
}

function push(item: ChatItem) {
  setC((s) => ({ items: [...s.items, item] }));
}
function patch(id: string, fn: (i: any) => any) {
  setC((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...fn(i) } : i)) }));
}

export async function grabFrame(width = 1024): Promise<string | null> {
  const c = engine.comp?.canvas;
  if (!c) return null;
  const tmp = document.createElement('canvas');
  tmp.width = Math.min(width, c.width);
  tmp.height = Math.round((tmp.width * c.height) / c.width);
  tmp.getContext('2d')!.drawImage(c, 0, 0, tmp.width, tmp.height);
  return tmp.toDataURL('image/jpeg', 0.85).split(',')[1];
}

function attachedBlock() {
  const a = C().attached;
  if (!a.length) return '';
  return a
    .map(
      (x) =>
        `<claude_code_chat title=${JSON.stringify(x.title)} session=${x.sessionId}>\nThe user attached this earlier Claude Code conversation for context:\n${x.text}\n</claude_code_chat>`,
    )
    .join('\n\n');
}

export async function sendMessage(text: string) {
  const t = text.trim();
  if (!t) return;
  const s = C();
  const frame = s.attachFrame ? await grabFrame() : null;
  push({ kind: 'user', id: nid(), text: t, frame: frame || undefined });
  if (!s.busy) setC({ turnStart: { snapshot: S().project, historyLen: S().past.length } });
  setC((st) => ({ busy: true, thinking: true, openAssistant: null, busySince: st.busySince ?? Date.now() }));
  const context = [attachedBlock(), contextBlock()].filter(Boolean).join('\n\n');
  // attached chats are sent once; Claude keeps them in its context from then on
  if (s.attached.length) setC({ attached: [] });
  try {
    await window.icut.agentSend({ text: t, context, images: frame ? [{ mediaType: 'image/jpeg', data: frame }] : [] });
  } catch (e: any) {
    push({ kind: 'error', id: nid(), text: e.message });
    setC({ busy: false, thinking: false });
  }
}

export function stop() {
  window.icut.agentInterrupt();
}

export function newChat() {
  window.icut.agentReset();
  setC({ items: [], busy: false, thinking: false, openAssistant: null, turnStart: null, agents: {}, continuing: null });
}

export function setModel(model: string, effort = C().effort) {
  setC({ model, effort });
  window.icut.agentSetModel({ model, effort });
}

export async function setBypass(on: boolean) {
  setC({ bypass: on });
  await window.icut.agentSetBypass(on);
  const n = agentName();
  const ask = C().provider === 'claude' ? `${n} will ask before running non-editor actions` : `${n} runs shell commands sandboxed to the project folder`;
  toast(on ? `Bypass permissions on: ${n} runs every action without asking` : ask, on ? 'info' : 'success');
}

export async function setMultiAgent(on: boolean) {
  setC({ multiAgent: on });
  await window.icut.setSettings({ multiAgent: on });
  toast(`Parallel agents ${on ? 'on' : 'off'} — applies from your next new conversation`, 'info');
}

export async function attachChat(sessionId: string, title: string) {
  const r = await window.icut.sessionTranscript(sessionId);
  if (!r.text) return toast('That conversation has no readable messages', 'error');
  setC((s) => ({ attached: [...s.attached.filter((a) => a.sessionId !== sessionId), { sessionId, title, text: r.text, messages: r.messages }] }));
}

export function detachChat(sessionId: string) {
  setC((s) => ({ attached: s.attached.filter((a) => a.sessionId !== sessionId) }));
}

export async function continueChat(sessionId: string, title: string) {
  if (C().busy) return toast(`Wait for ${agentName()} to finish, or press Stop first`, 'info');
  await window.icut.sessionContinue(sessionId);
  if (C().provider !== 'claude') applyProviderSettings(await window.icut.getSettings());
  setC({ items: [], agents: {}, turnStart: null, attached: [], continuing: { sessionId, title } });
  push({ kind: 'note', id: nid(), text: `Continuing your Claude Code chat "${title}" (on a copy — the original is untouched). Claude has its full history plus your timeline.` });
}

export function answerPermission(itemId: string, reqId: number, allow: boolean, always = false) {
  window.icut.permissionReply({ id: reqId, allow, always });
  patch(itemId, () => ({ status: allow ? 'allowed' : 'denied' }));
}

export function revertTurn(snapshot: Project) {
  commit('Revert Claude changes', (d) => Object.assign(d, structuredClone(snapshot)));
  toast("Reverted Claude's changes from that turn (Ctrl+Z to restore)", 'info');
}

function patchAgent(taskId: string, fn: (a: AgentRun) => Partial<AgentRun>) {
  setC((s) => {
    const a = s.agents[taskId];
    if (!a) return {};
    return { agents: { ...s.agents, [taskId]: { ...a, ...fn(a) } } };
  });
}

export function runningAgents() {
  return Object.values(C().agents).filter((a) => a.status === 'running' || a.status === 'pending');
}

export function installChatBridge() {
  window.icut.getSettings().then((st) => {
    applyProviderSettings(st);
    setC({ bypass: !!st.autoApproveAll, multiAgent: st.multiAgent !== false });
    loadCatalog(C().provider);
  });
  window.icut.onExternalAgents((list) => setC({ externals: list }));
  return window.icut.onAgentEvent((ev) => {
    const s = C();
    switch (ev.type) {
      case 'busy':
        setC((st) => ({ busy: true, busySince: st.busySince ?? Date.now() }));
        break;
      case 'provider':
        // no API key for the built-in agent: the message went to the user's own app instead
        setC({ provider: ev.provider, model: '', effort: 'medium' });
        push({ kind: 'note', id: nid(), text: 'This goes to your own Claude Code: in Claude Code, say “connect to IngrainedCut” and it answers here. (No API key is set for the built-in chat.)' });
        break;
      case 'status':
        if (s.busy && ev.status) setC({ statusNote: String(ev.status).slice(0, 120) });
        break;
      case 'init':
        setC({ info: { model: ev.model, mcpStatus: ev.mcpStatus, apiKeySource: ev.apiKeySource, version: ev.version } });
        break;
      case 'thinking':
        setC({ thinking: true });
        break;
      case 'text_delta': {
        if (s.openAssistant) patch(s.openAssistant, (i) => ({ text: i.text + ev.text }));
        else {
          const id = nid();
          push({ kind: 'assistant', id, text: ev.text });
          setC({ openAssistant: id });
        }
        setC({ thinking: false });
        break;
      }
      case 'block_stop':
        setC({ openAssistant: null });
        break;
      case 'tool_use':
        push({ kind: 'tool', id: ev.id, name: ev.name, input: ev.input, status: 'running' });
        setC({ openAssistant: null, thinking: false });
        break;
      case 'tool_result':
        patch(ev.id, () => ({ status: ev.isError ? 'error' : 'done', result: ev.text, images: ev.images }));
        setC({ thinking: true });
        break;
      case 'permission':
        push({ kind: 'permission', id: nid(), reqId: ev.id, toolName: ev.toolName, input: ev.input, status: 'pending' });
        break;
      case 'permission_resolved':
        setC((st) => ({ items: st.items.map((i) => (i.kind === 'permission' && i.reqId === ev.id ? { ...i, status: ev.allow ? 'allowed' : 'denied' } : i)) }));
        break;
      case 'bypass':
        setC({ bypass: !!ev.on });
        break;
      case 'agent_start':
        setC((st) => ({
          agents: {
            ...st.agents,
            [ev.taskId]: { taskId: ev.taskId, toolUseId: ev.toolUseId, description: ev.description, type: ev.agentType, status: 'running', steps: [], toolUses: 0, tokens: 0, started: Date.now() },
          },
        }));
        break;
      case 'agent_progress':
        patchAgent(ev.taskId, () => ({ lastTool: ev.lastTool, toolUses: ev.usage?.tool_uses ?? 0, tokens: ev.usage?.total_tokens ?? 0, summary: ev.summary }));
        break;
      case 'agent_update':
        if (ev.status) patchAgent(ev.taskId, () => ({ status: ev.status, ...(ev.status !== 'running' ? { ended: Date.now() } : {}) }));
        break;
      case 'agent_done':
        patchAgent(ev.taskId, () => ({ status: ev.status, summary: ev.summary, ended: Date.now(), toolUses: ev.usage?.tool_uses ?? 0, tokens: ev.usage?.total_tokens ?? 0 }));
        break;
      case 'agent_tool': {
        const run = Object.values(C().agents).find((a) => a.toolUseId === ev.parentToolUseId);
        if (run) patchAgent(run.taskId, (a) => ({ lastTool: ev.name, steps: [...a.steps.slice(-5), ev.name] }));
        break;
      }
      case 'error':
        push({ kind: 'error', id: nid(), text: ev.message });
        break;
      case 'result': {
        const ts = s.turnStart;
        const edits = ts ? S().past.slice(ts.historyLen).filter((h) => h.by === 'claude').length : 0;
        if (ts) push({ kind: 'result', id: nid(), ok: ev.ok, cost: ev.cost, durationMs: ev.durationMs, edits, snapshot: ts.snapshot, error: ev.error });
        setC({ busy: false, thinking: false, openAssistant: null, turnStart: null, totalCost: s.totalCost + (ev.cost || 0), busySince: null, statusNote: null });
        break;
      }
      case 'idle':
        setC({ busy: false, thinking: false, openAssistant: null, busySince: null, statusNote: null });
        break;
    }
  });
}
