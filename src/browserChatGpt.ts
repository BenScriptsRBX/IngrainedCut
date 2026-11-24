// ChatGPT as the website editor's agent without the helper: the same chat as electron/chatgptAgent.mjs, run in the page.
// The IngrainedCut Chrome extension (chatgptExtension.ts) holds the Sign in with ChatGPT tokens and sends each request;
// this file keeps the conversation, streams OpenAI's Responses API, and runs the editor tools the model calls right
// here in the page. Tools that need FFmpeg or Whisper on the computer (transcription, silence and scene detection,
// loudness, compositions) are left out: they need the helper.
import { z } from 'zod';
import { TOOL_DEFS } from '../electron/tools.mjs';
import { EDITOR_GUIDE } from '../electron/guide.mjs';
import { extStream, extCall } from './chatgptExtension';

const NS = 'ingrainedcut';
const MAX_STEPS = 80; // tool rounds in one turn
const SKIP = new Set(['wait_for_prompt', 'send_reply', 'detect_silence', 'detect_scenes', 'transcribe', 'analyze_loudness', 'render_composition']);

const GUIDE = (() => {
  let g = EDITOR_GUIDE.replace(/the mcp__ingrainedcut__ tools/g, 'the ingrainedcut tools');
  g = g.replace(/^- You can still use normal Claude Code tools[^\n]*\n/m, '');
  const cut = g.indexOf('# Making new video content');
  if (cut > 0) g = g.slice(0, cut);
  return `${g.trim()}

# Making new video content
You can't create files or run commands in this chat, only use the ingrainedcut tools. Build titles, lower thirds and simple motion graphics from add_text, add_color_matte, set_keyframes, transitions and effects, and check them with capture_frame.

# Running in the browser
This editor runs in the user's web browser without the IngrainedCut helper. Transcription and speech captions, silence detection (remove_silence), scene detection, loudness analysis and HyperFrames compositions need the helper on the user's computer, so those tools are not available here. If the user asks for one, say so and point them to https://www.ingrainedcut.com/download to set up the helper.

Tool results and the <editor_state> block are the source of truth for the timeline. The ingrainedcut tools are your editing hands.`;
})();

let toolSpec: any[] | null = null;
function tools() {
  toolSpec ??= [
    {
      type: 'namespace',
      name: NS,
      description: 'IngrainedCut: read and edit the video project open in the editor (timeline, clips, media, effects, export).',
      tools: (TOOL_DEFS as any[])
        .filter((d) => !SKIP.has(d.name))
        .map((d) => {
          const parameters: any = z.toJSONSchema(z.object(d.shape ?? {}), { unrepresentable: 'any' });
          delete parameters.$schema;
          return { type: 'function', name: d.name, description: d.description, parameters };
        }),
    },
  ];
  return toolSpec;
}

// ---------- browser storage (IndexedDB): conversations and the panel's chats ----------
let dbp: Promise<IDBDatabase> | null = null;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('icut-chat', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
export async function kvGet<T = any>(key: string): Promise<T | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction('kv').objectStore('kv').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function kvSet(key: string, value: any) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const t = d.transaction('kv', 'readwrite');
    t.objectStore('kv').put(value, key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** Server-sent events from the streamed text: yields each event's parsed JSON. */
async function* sse(chunks: AsyncGenerator<string>) {
  let buf = '';
  for await (const text of chunks) {
    buf += text;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data || data === '[DONE]') continue;
      try {
        yield JSON.parse(data);
      } catch {}
    }
  }
}

/** An item from the response, as it goes back into the next request (ids dropped: nothing is stored server-side). */
function forHistory(item: any) {
  if (item.type === 'reasoning') return item.encrypted_content ? { type: 'reasoning', summary: item.summary ?? [], encrypted_content: item.encrypted_content } : null;
  if (item.type === 'message') return { type: 'message', role: 'assistant', content: (item.content ?? []).filter((c: any) => c.type === 'output_text').map((c: any) => ({ type: 'output_text', text: c.text })) };
  if (item.type === 'function_call') {
    const { id, status, ...rest } = item;
    return rest;
  }
  return null;
}

type Emit = (ch: string, payload: any) => void;
type ToolResult = { content?: any[]; isError?: boolean };
export interface AgentOpts {
  emit: Emit;
  dispatch: (name: string, args: any) => Promise<ToolResult>;
  getSettings: () => any;
}

export function friendlyError(e: any) {
  const msg = e?.message || String(e);
  if (msg === 'CHATGPT_NEEDS_SIGNIN' || msg === 'CHATGPT_SIGNED_OUT' || /subscription_sharing_invalid_user|chatpass_v2_(scope_not_authorized|invalid_authorization_context)|HTTP 401/.test(msg))
    return 'Sign in with ChatGPT to use the chat: agent menu → ChatGPT → Continue with ChatGPT.';
  if (msg === 'CHATGPT_NO_MODELS') return "ChatGPT didn't list any models for this account. Check that your plan is Plus or Pro, then try again.";
  if (/subscription_sharing_usage_limit_exceeded/.test(msg)) return "You've reached your ChatGPT plan's usage limit for IngrainedCut. Manage usage: https://chatgpt.com/settings/usage";
  if (/subscription_sharing_user_not_eligible/.test(msg)) return "This ChatGPT account's plan can't be used in other apps. Use a ChatGPT Plus or Pro plan.";
  if (/subscription_sharing_(usage|user)_unavailable|HTTP 503/.test(msg)) return 'ChatGPT plan usage is temporarily unavailable. Try again in a minute.';
  if (/subscription_sharing_unsupported_capability|subscription_sharing_route_not_supported/.test(msg)) return `ChatGPT can't do that request on a plan (try another model). (${msg.slice(0, 300)})`;
  if (/did not answer|stopped answering/.test(msg)) return `${msg} If it keeps happening, check that the IngrainedCut extension is turned on in your browser's extensions page.`;
  if (/fetch failed|Failed to fetch|NetworkError|stream_interrupted/i.test(msg)) return `Couldn't reach ChatGPT. Check your internet connection and try again. (${msg.slice(0, 160)})`;
  return msg.slice(0, 1200);
}

export class BrowserChatGpt {
  private queue: any[] = [];
  private busy = false;
  private gen = 0;
  private aborted = false;
  private ctrl: AbortController | null = null;
  private history: any[] = [];
  session: string | null = null;
  constructor(private o: AgentOpts) {}

  private emit(ev: any) {
    this.o.emit('agent:event', ev);
  }

  send(msg: any) {
    this.queue.push(msg);
    this.emit({ type: 'busy' });
    if (!this.busy) this.drain();
  }

  private async drain() {
    this.busy = true;
    const gen = this.gen;
    while (this.queue.length && gen === this.gen) {
      const msg = this.queue.shift();
      const started = Date.now();
      this.aborted = false;
      try {
        const r = await this.turn(msg);
        if (gen !== this.gen) return;
        this.emit({ type: 'result', ok: true, durationMs: Date.now() - started, usage: r?.usage });
      } catch (e) {
        if (gen !== this.gen) return;
        if (this.aborted) {
          this.queue.length = 0;
          this.emit({ type: 'result', ok: false, error: 'stopped', durationMs: Date.now() - started });
        } else {
          this.emit({ type: 'error', message: friendlyError(e) });
          this.emit({ type: 'result', ok: false, error: 'error', durationMs: Date.now() - started });
        }
      }
    }
    if (gen !== this.gen) return;
    this.busy = false;
    this.emit({ type: 'idle' });
  }

  interrupt() {
    if (!this.busy) return;
    this.aborted = true;
    this.ctrl?.abort();
  }

  reset() {
    this.gen++;
    this.queue = [];
    this.aborted = true;
    this.ctrl?.abort();
    this.session = null;
    this.history = [];
    this.busy = false;
    this.emit({ type: 'idle' });
  }

  /** Pick a saved conversation back up (its history loads at the next message). */
  resume(sessionId: string | null) {
    this.reset();
    this.session = sessionId;
  }

  private async model() {
    const s = this.o.getSettings();
    if (s.chatgptModel) return s.chatgptModel as string;
    const list = await extCall<any[]>('models').catch(() => []);
    if (!list.length) throw new Error('CHATGPT_NO_MODELS');
    return list[0].id as string;
  }

  private async turn({ text, context, images = [] }: { text: string; context?: string; images?: { mediaType: string; data: string }[] }) {
    const st = await extCall<any>('status');
    if (!st.plan) throw new Error('CHATGPT_NEEDS_SIGNIN');
    const s = this.o.getSettings();
    if (this.session && !this.history.length) this.history = (await kvGet<any[]>('session:' + this.session).catch(() => undefined)) ?? [];
    if (!this.session) this.session = crypto.randomUUID();
    const model = await this.model();
    this.emit({ type: 'init', model, sessionId: this.session, mcpStatus: 'connected', version: 'ChatGPT' });
    const content: any[] = [{ type: 'input_text', text: (context ? context + '\n\n' : '') + text }];
    for (const img of images) content.push({ type: 'input_image', image_url: `data:${img.mediaType};base64,${img.data}` });
    this.history.push({ role: 'user', content });
    const turnStart = this.history.length;
    const ctrl = (this.ctrl = new AbortController());
    let usage: any = null;
    const seen = new Set<string>();
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const body = {
          model,
          instructions: GUIDE,
          input: this.history,
          tools: tools(),
          tool_choice: 'auto',
          parallel_tool_calls: false,
          store: false,
          stream: true,
          include: ['reasoning.encrypted_content'],
          reasoning: s.chatgptEffort ? { effort: s.chatgptEffort, summary: 'auto' } : { summary: 'auto' },
        };
        const items: any[] = [];
        let completed = false;
        for await (const ev of sse(extStream('/responses', body, ctrl.signal))) {
          switch (ev.type) {
            case 'response.output_item.added':
              if (ev.item?.type === 'reasoning') this.emit({ type: 'thinking' });
              break;
            case 'response.output_text.delta':
              this.emit({ type: 'text_delta', text: ev.delta, msgId: ev.item_id });
              break;
            case 'response.output_item.done':
              items.push(ev.item);
              if (ev.item?.type === 'message') this.emit({ type: 'block_stop' });
              break;
            case 'response.completed':
              completed = true;
              usage = ev.response?.usage ?? usage;
              break;
            case 'response.failed': {
              const err = ev.response?.error;
              throw new Error(`${err?.code ?? 'response_failed'}: ${err?.message ?? 'ChatGPT could not finish this reply'}`);
            }
            case 'response.incomplete':
              throw new Error(`response_incomplete: ${ev.response?.incomplete_details?.reason ?? 'the reply was cut off'}`);
            case 'error':
              throw new Error(`${ev.code ?? ev.error?.code ?? 'stream_error'}: ${ev.message ?? ev.error?.message ?? ''}`);
          }
        }
        if (!completed) throw new Error('stream_interrupted: the connection to ChatGPT dropped before the reply finished');
        for (const it of items) {
          const h = forHistory(it);
          if (h) this.history.push(h);
        }
        const calls = items.filter((it) => it.type === 'function_call');
        if (!calls.length) break;
        for (const call of calls) {
          if (this.aborted) throw new Error('aborted');
          const name = String(call.name ?? '').replace(new RegExp(`^${NS}[.:_]+`), '');
          let args: any = {};
          try {
            args = call.arguments ? JSON.parse(call.arguments) : {};
          } catch {}
          const shown = `mcp__${NS}__${name}`;
          if (!seen.has(call.call_id)) {
            seen.add(call.call_id);
            this.emit({ type: 'tool_use', id: call.call_id, name: shown, input: args });
          }
          let res: ToolResult;
          try {
            res = SKIP.has(name) ? { content: [{ type: 'text', text: `Error: ${name} needs the IngrainedCut helper (https://www.ingrainedcut.com/download)` }], isError: true } : await this.o.dispatch(name, args);
          } catch (e: any) {
            res = { content: [{ type: 'text', text: 'Error: ' + (e?.message || String(e)) }], isError: true };
          }
          const textOut = (res.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
          const imgs = (res.content ?? []).filter((c) => c.type === 'image');
          this.emit({ type: 'tool_result', id: call.call_id, isError: !!res.isError, text: textOut.slice(0, 4000), images: imgs.length });
          const output = imgs.length
            ? [{ type: 'input_text', text: textOut || 'Image:' }, ...imgs.map((c) => ({ type: 'input_image', image_url: `data:${c.mimeType || 'image/jpeg'};base64,${c.data}` }))]
            : textOut || (res.isError ? 'Error' : 'Done');
          this.history.push({ type: 'function_call_output', call_id: call.call_id, output });
        }
      }
    } catch (e) {
      // a turn that didn't finish leaves no half-done calls behind (every call needs its output)
      this.history.length = turnStart;
      throw e;
    } finally {
      // keep later requests small: earlier frames become a note (the model already saw them)
      for (const h of this.history.slice(0, turnStart)) {
        if (h.type === 'function_call_output' && Array.isArray(h.output)) h.output = h.output.filter((c: any) => c.type !== 'input_image').concat([{ type: 'input_text', text: '[image shown earlier]' }]);
        if (h.role === 'user' && Array.isArray(h.content)) h.content = h.content.filter((c: any) => c.type !== 'input_image');
      }
      if (this.session) kvSet('session:' + this.session, this.history).catch((e) => console.warn('chat save', e));
    }
    return { usage };
  }
}
