// The chat's Codex agent across turns, and what the "agents working" indicator counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexAgent } from '../electron/otherAgents.mjs';
import { createExternals } from '../electron/externals.mjs';
import { externalState, countAgents, WORK_GRACE_MS } from '../src/agentState.ts';

/** a CodexAgent whose turns replay scripted Codex items instead of running the CLI */
function scripted(turns) {
  const events = [];
  const a = new CodexAgent({ emit: (_ch, ev) => events.push(ev), getSettings: () => ({}) });
  let n = 0;
  a.turn = async () => {
    for (const [done, item] of turns[n++]) a.item(done, item);
    return { usage: null };
  };
  const send = (text) =>
    new Promise((resolve) => {
      const before = events.length;
      const check = setInterval(() => {
        if (events.slice(before).some((e) => e.type === 'idle')) {
          clearInterval(check);
          resolve(events.slice(before));
        }
      }, 5);
      a.send({ text });
    });
  return { a, send };
}

test('Codex: a reply in a later turn shows even when its item id was used, longer, in an earlier turn', async () => {
  // Codex numbers items from item_0 in every turn (a new CLI run per message)
  const long = 'I saved the project and left it open in IngrainedCut. 0 of 10 Shorts are assembled. '.repeat(3);
  const { send } = scripted([
    [
      [false, { id: 'item_0', type: 'reasoning' }],
      [false, { id: 'item_1', type: 'agent_message', text: long.slice(0, 40) }],
      [true, { id: 'item_1', type: 'agent_message', text: long }],
      [false, { id: 'item_2', type: 'mcp_tool_call', server: 'ingrainedcut', tool: 'get_project_state', arguments: {} }],
      [true, { id: 'item_2', type: 'mcp_tool_call', server: 'ingrainedcut', tool: 'get_project_state', arguments: {}, status: 'completed', result: { content: [{ type: 'text', text: 'state' }] } }],
    ],
    [
      [true, { id: 'item_0', type: 'reasoning' }],
      [true, { id: 'item_1', type: 'agent_message', text: 'Work is paused.' }],
    ],
    [
      [true, { id: 'item_1', type: 'agent_message', text: 'I’m here, Ben.' }],
      [false, { id: 'item_2', type: 'mcp_tool_call', server: 'ingrainedcut', tool: 'get_project_state', arguments: {} }],
      [true, { id: 'item_2', type: 'mcp_tool_call', server: 'ingrainedcut', tool: 'get_project_state', arguments: {}, status: 'completed', result: { content: [{ type: 'text', text: 'state 2' }] } }],
    ],
  ]);
  const t1 = await send('build the shorts');
  assert.equal(t1.filter((e) => e.type === 'text_delta').map((e) => e.text).join(''), long);
  const tool1 = t1.find((e) => e.type === 'tool_use');
  const t2 = await send('done or still working');
  assert.equal(t2.filter((e) => e.type === 'text_delta').map((e) => e.text).join(''), 'Work is paused.');
  const t3 = await send('hello?');
  assert.equal(t3.filter((e) => e.type === 'text_delta').map((e) => e.text).join(''), 'I’m here, Ben.');
  const tool3 = t3.find((e) => e.type === 'tool_use');
  assert.ok(tool3, 'the tool call of the third turn is shown');
  assert.notEqual(tool3.id, tool1.id, 'tool rows of different turns have different ids');
  assert.equal(t3.find((e) => e.type === 'tool_result').id, tool3.id);
});

test('outside sessions: a heartbeat is connected, a call is working, wait_for_prompt is listening', () => {
  let t = 1_000_000;
  let last = [];
  const x = createExternals((l) => (last = l), () => t);
  const claude = { id: 'mcp-1', name: 'Claude Code' };
  x.note(claude); // the 30 s heartbeat of an idle session
  assert.equal(externalState(last[0], t), 'connected');
  assert.equal(countAgents({ busy: false, runningSubagents: 0, externals: last }, t).working, 0);
  assert.equal(countAgents({ busy: false, runningSubagents: 0, externals: last }, t).label, '1 connected');

  x.note(claude, 'export_video', 'start');
  t += 60_000; // a long call, no heartbeat change needed
  assert.equal(last[0].inFlight, 1);
  assert.equal(externalState(last[0], t), 'working');
  assert.equal(countAgents({ busy: false, runningSubagents: 0, externals: last }, t).label, '1 agent working');
  x.note(claude, 'export_video', 'end');
  assert.equal(externalState(last[0], t + WORK_GRACE_MS - 1000), 'working', 'just after a call it is still working');
  assert.equal(externalState(last[0], t + WORK_GRACE_MS + 1000), 'connected', 'then connected, not working');

  const codex = { id: 'mcp-2', name: 'Codex' };
  x.note(codex, 'wait_for_prompt', 'start');
  const c2 = last.find((e) => e.id === 'mcp-2');
  assert.equal(externalState(c2, t), 'listening');
  assert.equal(c2.calls, 0, 'listening is not a call');
  const n = countAgents({ busy: true, runningSubagents: 1, externals: last }, t + WORK_GRACE_MS + 1000);
  assert.equal(n.working, 2, 'the main agent and one sub-agent; the idle and listening sessions are not working');
  assert.equal(n.connected.length, 2);

  // the chat's own agent is not an outside session
  x.note({ id: 'inapp-codex', name: 'Codex' }, 'add_clip', 'start');
  assert.ok(!last.some((e) => e.id === 'inapp-codex'));

  // gone after 90 s without a sign of life, unless still listening or mid-call
  t += 200_000;
  x.emit();
  assert.deepEqual(last.map((e) => e.id), ['mcp-2']);
});
