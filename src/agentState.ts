// What the "agents working" indicator counts (pure, so it is unit-tested under Node).

export interface ExternalAgent {
  id: string;
  name: string;
  since: number;
  /** last sign of life (a heartbeat every 30 s while connected, or a call) */
  last: number;
  lastTool?: string;
  calls: number;
  /** tool calls running right now (wait_for_prompt not counted) */
  inFlight?: number;
  /** waiting in wait_for_prompt for a message from the chat panel */
  listening?: number;
  /** when its last tool call started or ended */
  lastWork?: number;
}

/** After a tool call an outside agent is still working for a moment: reading the result and choosing the next call. */
export const WORK_GRACE_MS = 15_000;
/** Sessions not heard from for this long are gone (they ping every 30 s while connected). */
export const GONE_MS = 90_000;

export function externalState(e: ExternalAgent, now = Date.now()): 'working' | 'listening' | 'connected' {
  if ((e.inFlight ?? 0) > 0 || (e.lastWork && now - e.lastWork < WORK_GRACE_MS)) return 'working';
  if ((e.listening ?? 0) > 0) return 'listening';
  return 'connected';
}

export interface AgentCount {
  /** the main agent mid-turn, running sub-agents, outside sessions mid-call */
  working: number;
  /** outside sessions still connected */
  connected: ExternalAgent[];
  label: string;
}

export function countAgents(o: { busy: boolean; runningSubagents: number; externals: ExternalAgent[] }, now = Date.now()): AgentCount {
  const connected = o.externals.filter((e) => now - e.last < GONE_MS || (e.inFlight ?? 0) > 0 || (e.listening ?? 0) > 0);
  const working = (o.busy ? 1 : 0) + o.runningSubagents + connected.filter((e) => externalState(e, now) === 'working').length;
  const label = working ? `${working} agent${working > 1 ? 's' : ''} working` : connected.length ? `${connected.length} connected` : 'idle';
  return { working, connected, label };
}
