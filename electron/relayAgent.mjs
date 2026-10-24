// "Your own app": the chat panel's messages go to a Claude Code, Codex or Cursor session the user runs themselves (on
// their own plan). That session picks each message up with the MCP tool wait_for_prompt and answers with send_reply
// (mcp/server.mjs); its editor tool calls show in the panel like the built-in agents'. IngrainedCut only passes the
// messages along.

/** How long a session counts as connected after its last wait_for_prompt / send_reply. */
const LINK_TTL_MS = 5 * 60 * 1000;

export class RelayAgent {
  constructor(o) {
    this.o = o;
    this.queue = []; // messages typed in the panel, not picked up yet
    this.waiters = []; // wait_for_prompt calls waiting for a message
    this.client = null; // { id, name } of the session that last called wait_for_prompt
    this.seen = 0;
    this.working = false; // a picked-up message hasn't been answered yet
  }

  emit(ev) {
    this.o.emit('agent:event', ev);
  }

  /** Who is connected, for the panel. */
  status() {
    const linked = !!this.client && Date.now() - this.seen < LINK_TTL_MS;
    return { installed: true, loggedIn: linked, apiKey: false, ready: linked, method: linked ? this.client.name : undefined, app: linked ? this.client.name : null };
  }

  linked(client) {
    return !!client && !!this.client && client.id === this.client.id;
  }

  // ---- the panel side (same shape as the other agents) ----
  send({ text, context, images = [] }) {
    const parts = [text];
    if (images.length) parts.push(`(The user attached ${images.length} frame${images.length === 1 ? '' : 's'} from the program monitor; use capture_frame to see it.)`);
    // only the timeline's headline, not the whole snapshot: the session's context then grows by the conversation, not by a
    // copy of the timeline per message (it calls get_project_state when it needs the details)
    const headline = context?.match(/^Sequence .*$/m)?.[0];
    if (headline) parts.push(`(Timeline: ${headline.replace(/^Sequence /, '')}. Call get_project_state for clips and details.)`);
    this.queue.push(parts.join('\n\n'));
    this.emit({ type: 'busy' });
    if (!this.status().ready) this.emit({ type: 'status', status: 'Waiting for your app — open it and say “connect to IngrainedCut”' });
    this.flush();
  }

  interrupt() {
    this.queue = [];
    this.working = false;
    this.emit({ type: 'idle' });
  }

  reset() {
    this.queue = [];
    this.working = false;
  }

  setModel() {}
  setEffort() {}
  setBypass() {}

  // ---- the session side (MCP tools) ----
  /** wait_for_prompt: the next message from the panel, or null when none arrives within timeoutMs. */
  wait(client, timeoutMs) {
    this.client = client;
    this.seen = Date.now();
    this.o.onLink?.(this.status());
    if (this.working) {
      // it went back to listening without send_reply: the turn is over
      this.working = false;
      this.emit({ type: 'idle' });
    }
    return new Promise((resolve) => {
      const w = { resolve, timer: null };
      w.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        this.seen = Date.now();
        resolve(null);
      }, timeoutMs);
      this.waiters.push(w);
      this.flush();
    });
  }

  flush() {
    while (this.queue.length && this.waiters.length) {
      const w = this.waiters.shift();
      clearTimeout(w.timer);
      this.working = true;
      this.emit({ type: 'status', status: `${this.client?.name ?? 'Your app'} is working on it` });
      w.resolve(this.queue.shift());
    }
  }

  /** send_reply: the session's answer, shown in the panel. done=false keeps the turn open (a progress update). */
  reply(client, text, done = true) {
    this.client = client;
    this.seen = Date.now();
    if (text) {
      this.emit({ type: 'text_delta', text });
      this.emit({ type: 'block_stop' });
    }
    if (done) {
      this.working = false;
      this.emit({ type: 'result', ok: true });
    }
  }

  /** An editor tool call from the connected session: shown in the panel as part of its turn. */
  toolUse(id, name, input) {
    if (this.working) this.emit({ type: 'tool_use', id, name: `mcp__ingrainedcut__${name}`, input });
  }

  toolResult(id, res) {
    if (this.working) this.emit({ type: 'tool_result', id, isError: !!res?.isError, text: res?.content?.find((c) => c.type === 'text')?.text?.slice(0, 4000) });
  }
}
