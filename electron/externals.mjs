// Outside sessions (Claude Code / Codex / Cursor started with mcp/server.mjs) seen through the bridge.
// A connected session pings every 30 s whether or not it is doing anything, so being connected is not working:
// a session is working while one of its tool calls runs (inFlight) and for a moment after one (lastWork, see
// src/agentState.ts); waiting in wait_for_prompt for the chat panel is listening, not working.

const LISTEN = new Set(['wait_for_prompt']);
/** sessions not heard from (no heartbeat, no call) for this long are gone */
export const GONE_MS = 90_000;

/** @param {(list: object[]) => void} onChange */
export function createExternals(onChange, now = () => Date.now()) {
  const map = new Map();
  const list = () => [...map.values()].map((e) => ({ ...e }));
  function emit() {
    const t = now();
    for (const [k, e] of map) if (t - e.last > GONE_MS && !e.inFlight && !e.listening) map.delete(k);
    onChange(list());
  }
  /** a heartbeat (no tool), or a tool call starting (phase 'start') or ending (phase 'end') */
  function note(client, toolName, phase) {
    // the chat's own Codex / Cursor agent is shown as the main agent, not as an outside session
    if (!client || String(client.id).startsWith('inapp-')) return;
    const t = now();
    const e = map.get(client.id) ?? { id: client.id, name: client.name || 'Claude Code', since: t, calls: 0, inFlight: 0, listening: 0, lastWork: 0 };
    e.last = t;
    if (toolName && LISTEN.has(toolName)) {
      if (phase === 'start') e.listening++;
      else if (phase === 'end') e.listening = Math.max(0, e.listening - 1);
    } else if (toolName) {
      if (phase !== 'end') {
        e.inFlight++;
        e.calls++;
        e.lastTool = toolName;
      } else e.inFlight = Math.max(0, e.inFlight - 1);
      e.lastWork = t;
    }
    map.set(client.id, e);
    emit();
  }
  return { note, emit, list };
}
