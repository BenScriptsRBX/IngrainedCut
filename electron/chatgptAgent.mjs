// ChatGPT as the chat's agent, straight on the user's ChatGPT plan (Sign in with ChatGPT): no Codex install.
// Each turn streams OpenAI's Responses API with the IngrainedCut editor tools as function tools (grouped in a
// namespace, as ChatGPT plan usage requires), runs the calls it makes, and sends the results back until it answers.
// ChatGPT plan requests are never stored by OpenAI (store: false), so the conversation is kept here and sent with
// every request; it is saved per session so a project's chat can pick up where it left off.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { TOOL_DEFS } from './tools.mjs';
import { EDITOR_GUIDE } from './guide.mjs';
import { CliAgent } from './otherAgents.mjs';
import { userDataDir } from './paths.mjs';
import * as chatgpt from './chatgptAuth.mjs';

const NS = 'ingrainedcut';
const MAX_STEPS = 80; // tool rounds in one turn
// the panel's own tools for "Your own app"; not editing tools
const SKIP = new Set(['wait_for_prompt', 'send_reply']);

/** The editor guide, minus what a chat without files or a shell can't do (HyperFrames builds compositions on disk). */
const GUIDE = (() => {
  let g = EDITOR_GUIDE.replace(/the mcp__ingrainedcut__ tools/g, 'the ingrainedcut tools');
  g = g.replace(/^- You can still use normal Claude Code tools[^\n]*\n/m, '');
  const cut = g.indexOf('# Making new video content');
  if (cut > 0) g = g.slice(0, cut);
  return `${g.trim()}

# Making new video content
You can't create files or run commands in this chat, only use the ingrainedcut tools. Build titles, lower thirds and simple motion graphics from add_text, add_color_matte, set_keyframes, transitions and effects, and check them with capture_frame. For full motion-graphics compositions (HyperFrames), tell the user that Claude or Codex in the agent menu can build those.

Tool results and the <editor_state> block are the source of truth for the timeline. The ingrainedcut tools are your editing hands.`;
})();

let toolSpec = null;
function tools() {
  if (!toolSpec) {
    toolSpec = [
      {
        type: 'namespace',
        name: NS,
        description: 'IngrainedCut: read and edit the video project open in the editor (timeline, clips, media, effects, export).',
        tools: TOOL_DEFS.filter((d) => !SKIP.has(d.name)).map((d) => {
          const parameters = z.toJSONSchema(z.object(d.shape ?? {}), { unrepresentable: 'any' });
          delete parameters.$schema;
          return { type: 'function', name: d.name, description: d.description, parameters };
        }),
      },
    ];
  }
  return toolSpec;
}

const sessionsDir = () => path.join(userDataDir(), 'chatgpt-sessions');
const sessionFile = (id) => path.join(sessionsDir(), String(id).replace(/[^\w-]/g, '') + '.json');

/** Server-sent events from a fetch body: yields each event's parsed JSON. */
async function* sse(body, signal) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      if (signal?.aborted) throw new Error('aborted');
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
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
  } finally {
    reader.releaseLock();
  }
}

/** A failed request: its error code (OpenAI's `error.code`, or the admission `detail`) and message. */
async function requestError(r) {
  const text = await r.text().catch(() => '');
  let j = {};
  try {
    j = JSON.parse(text);
  } catch {}
  const code = j.error?.code || j.error?.type || (typeof j.detail === 'string' ? j.detail : null) || `http_${r.status}`;
  const msg = j.error?.message || (typeof j.detail === 'string' ? j.detail : text.slice(0, 300));
  const e = new Error(`${code}: ${msg} (HTTP ${r.status})`);
  e.status = r.status;
  return e;
}

/** An item from the response, as it goes back into the next request (ids dropped: nothing is stored server-side). */
function forHistory(item) {
  if (item.type === 'reasoning') return item.encrypted_content ? { type: 'reasoning', summary: item.summary ?? [], encrypted_content: item.encrypted_content } : null;
  if (item.type === 'message') return { type: 'message', role: 'assistant', content: (item.content ?? []).filter((c) => c.type === 'output_text').map((c) => ({ type: 'output_text', text: c.text })) };
  if (item.type === 'function_call') {
    const { id, status, ...rest } = item;
    return rest;
  }
  return null;
}

export class ChatGptAgent extends CliAgent {
  constructor(o) {
    super(o);
    this.history = [];
  }

  abort() {
    this.ctrl?.abort();
  }

  reset() {
    super.reset();
    this.history = [];
  }

  async model() {
    const s = this.o.getSettings();
    if (s.chatgptModel) return s.chatgptModel;
    const list = await chatgpt.listModels().catch(() => []);
    if (!list.length) throw new Error('CHATGPT_NO_MODELS');
    return list[0].id;
  }

  save() {
    if (!this.session) return;
    try {
      fs.mkdirSync(sessionsDir(), { recursive: true });
      fs.writeFileSync(sessionFile(this.session), JSON.stringify(this.history));
    } catch (e) {
      console.error('chatgpt session save', e.message);
    }
  }

  async turn({ text, context, images = [] }) {
    if (!chatgpt.planReady()) throw new Error('CHATGPT_NEEDS_SIGNIN');
    const s = this.o.getSettings();
    // a project's chat being picked up again (chat:resume sets the session): its saved conversation
    if (this.session && !this.history.length) {
      try {
        this.history = JSON.parse(fs.readFileSync(sessionFile(this.session), 'utf8'));
      } catch {}
    }
    if (!this.session) this.session = crypto.randomUUID();
    const model = await this.model();
    this.emit({ type: 'init', model, sessionId: this.session, mcpStatus: 'connected', version: 'ChatGPT' });
    const content = [{ type: 'input_text', text: (context ? context + '\n\n' : '') + text }];
    for (const img of images) content.push({ type: 'input_image', image_url: `data:${img.mediaType};base64,${img.data}` });
    this.history.push({ role: 'user', content });
    const turnStart = this.history.length;
    this.ctrl = new AbortController();
    let usage = null;
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const token = await chatgpt.accessToken();
        if (!token) throw new Error('CHATGPT_NEEDS_SIGNIN');
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
          ...(s.chatgptEffort ? { reasoning: { effort: s.chatgptEffort, summary: 'auto' } } : { reasoning: { summary: 'auto' } }),
        };
        const r = await fetch(`${chatgpt.API_BASE}/responses`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify(body),
          signal: this.ctrl.signal,
        });
        if (!r.ok) throw await requestError(r);
        const items = [];
        let completed = false;
        for await (const ev of sse(r.body, this.ctrl.signal)) {
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
          let args = {};
          try {
            args = call.arguments ? JSON.parse(call.arguments) : {};
          } catch {}
          const shown = `mcp__${NS}__${name}`;
          this.tool(false, call.call_id, shown, args);
          let res;
          try {
            res = await this.o.dispatch(name, args);
          } catch (e) {
            res = { content: [{ type: 'text', text: 'Error: ' + (e?.message || String(e)) }], isError: true };
          }
          const textOut = (res.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
          const imgs = (res.content ?? []).filter((c) => c.type === 'image');
          this.tool(true, call.call_id, shown, args, () => ({ isError: !!res.isError, text: textOut, images: imgs.length }));
          const output = imgs.length
            ? [{ type: 'input_text', text: textOut || 'Image:' }, ...imgs.map((c) => ({ type: 'input_image', image_url: `data:${c.mimeType || 'image/jpeg'};base64,${c.data}` }))]
            : textOut || (res.isError ? 'Error' : 'Done');
          this.history.push({ type: 'function_call_output', call_id: call.call_id, output });
        }
      }
    } catch (e) {
      // a turn that didn't finish leaves no half-done calls behind (every call needs its output)
      this.history.length = turnStart;
      if (this.aborted || e?.name === 'AbortError') throw e;
      throw e;
    } finally {
      // keep later requests small: earlier frames become a note (the model already saw them)
      for (const h of this.history.slice(0, turnStart)) {
        if (h.type === 'function_call_output' && Array.isArray(h.output)) h.output = h.output.filter((c) => c.type !== 'input_image').concat([{ type: 'input_text', text: '[image shown earlier]' }]);
        if (h.role === 'user' && Array.isArray(h.content)) h.content = h.content.filter((c) => c.type !== 'input_image');
      }
      this.save();
    }
    return { usage };
  }

  friendlyError(e) {
    const msg = e?.message || String(e);
    if (msg === 'CHATGPT_NEEDS_SIGNIN' || msg === 'CHATGPT_SIGNED_OUT' || /subscription_sharing_invalid_user|chatpass_v2_(scope_not_authorized|invalid_authorization_context)|HTTP 401/.test(msg))
      return 'Sign in with ChatGPT to use the chat: agent menu → ChatGPT → Continue with ChatGPT.';
    if (msg === 'CHATGPT_NO_MODELS') return "ChatGPT didn't list any models for this account. Check that your plan is Plus or Pro, then try again.";
    if (/subscription_sharing_usage_limit_exceeded/.test(msg)) return "You've reached your ChatGPT plan's usage limit for IngrainedCut. Manage usage: https://chatgpt.com/settings/usage";
    if (/subscription_sharing_user_not_eligible/.test(msg)) return "This ChatGPT account's plan can't be used in other apps. Use a ChatGPT Plus or Pro plan.";
    if (/subscription_sharing_(usage|user)_unavailable|HTTP 503/.test(msg)) return 'ChatGPT plan usage is temporarily unavailable. Try again in a minute.';
    if (/subscription_sharing_unsupported_capability|subscription_sharing_route_not_supported/.test(msg)) return `ChatGPT can't do that request on a plan (try another model). (${msg.slice(0, 300)})`;
    if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|stream_interrupted/i.test(msg)) return `Couldn't reach ChatGPT — check your internet connection and try again. (${msg.slice(0, 160)})`;
    return msg.slice(0, 1200);
  }
}
