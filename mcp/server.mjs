#!/usr/bin/env node
// IngrainedCut MCP server (stdio). Lets any Claude Code session edit the project open in IngrainedCut:
//   claude mcp add ingrainedcut -- node "<path-to>/mcp/server.mjs"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TOOL_DEFS, SERVER_INSTRUCTIONS } from '../electron/tools.mjs';

const BRIDGE_FILE = path.join(os.homedir(), '.ingrainedcut', 'bridge.json');

// identifies this Claude Code session to the editor so it can show it as a running agent
// (the chat's own Codex / Cursor agent sets ICUT_CLIENT_ID so it isn't listed as an outside session)
const clientName = () => {
  const raw = process.env.ICUT_CLIENT_NAME || server.server.getClientVersion()?.name || '';
  return /claude/i.test(raw) ? 'Claude Code' : /codex/i.test(raw) ? 'Codex' : /cursor/i.test(raw) ? 'Cursor' : raw || 'Claude Code';
};
const clientHeader = () => JSON.stringify({ id: process.env.ICUT_CLIENT_ID || `mcp-${process.pid}`, name: clientName() });

function bridgeInfo() {
  // the in-app Codex / Cursor agents are pinned to the editor that started them
  if (process.env.ICUT_BRIDGE) return JSON.parse(process.env.ICUT_BRIDGE);
  return JSON.parse(fs.readFileSync(BRIDGE_FILE, 'utf8'));
}

async function call(name, args) {
  let info;
  try {
    info = bridgeInfo();
  } catch {
    return notRunning();
  }
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/call`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${info.token}`, 'Content-Type': 'application/json', 'X-ICut-Client': clientHeader() },
      body: JSON.stringify({ name, args }),
    });
    return await res.json();
  } catch {
    return notRunning();
  }
}

function notRunning() {
  return { content: [{ type: 'text', text: 'IngrainedCut is not running. Ask the user to open the IngrainedCut app, then retry.' }], isError: true };
}

// Sessions the user runs themselves can also take their prompts from IngrainedCut's chat panel (electron/relayAgent.mjs):
// wait_for_prompt → edit → send_reply → wait_for_prompt…, for as long as the session runs.
const outside = !String(process.env.ICUT_CLIENT_ID || '').startsWith('inapp-');
const RELAY_INSTRUCTIONS = `
# Taking prompts from IngrainedCut's chat panel
When the user asks you to connect to IngrainedCut (or to listen to / take prompts from IngrainedCut), they want to type in IngrainedCut's chat panel instead of here. Then loop for the rest of the session: call wait_for_prompt; when it returns a message, do what it asks with the IngrainedCut tools; answer with send_reply (the user reads it in the panel, not here); call wait_for_prompt again. If wait_for_prompt returns no message, just call it again. Don't stop the loop unless the user tells you to in the panel or here.`;

const server = new McpServer({ name: 'ingrainedcut', version: '0.1.0' }, { instructions: SERVER_INSTRUCTIONS + (outside ? RELAY_INSTRUCTIONS : '') });
for (const d of TOOL_DEFS) {
  server.registerTool(d.name, { description: d.description, inputSchema: d.shape }, async (args) => call(d.name, args ?? {}));
}
if (outside) {
  server.registerTool(
    'wait_for_prompt',
    {
      description:
        "Wait for the user's next message in IngrainedCut's chat panel and return it (with a snapshot of the timeline). Use it when the user asks you to connect to IngrainedCut: loop wait_for_prompt → edit with the IngrainedCut tools → send_reply → wait_for_prompt. If it returns no message, call it again right away.",
      inputSchema: { timeout_seconds: z.number().min(5).max(240).optional().describe('How long to wait before returning empty (default: as long as this app allows)') },
    },
    async (args) => {
      // Codex and others give up on a tool after about a minute, so they get an empty answer and call again
      if (args?.timeout_seconds || !/claude/i.test(clientName())) return call('wait_for_prompt', { timeout_seconds: args?.timeout_seconds ?? 50 });
      // Claude Code waits for slow tools, so keep waiting here until a message arrives: no model turns (and no usage)
      // while the user isn't typing, also across helper restarts
      for (;;) {
        const res = await call('wait_for_prompt', { timeout_seconds: 240 });
        const text = res?.content?.[0]?.text ?? '';
        if (res?.isError) await new Promise((r) => setTimeout(r, 5000));
        else if (!text.startsWith('No new message yet')) return res;
      }
    },
  );
  server.registerTool(
    'send_reply',
    {
      description: "Show your answer to the user in IngrainedCut's chat panel (they read it there, not in this session). Then call wait_for_prompt again.",
      inputSchema: {
        text: z.string().describe('Your reply, in Markdown'),
        done: z.boolean().optional().describe('false for a progress update while you keep working on the same message (default true)'),
      },
    },
    async (args) => call('send_reply', args ?? {}),
  );
}
await server.connect(new StdioServerTransport());

// heartbeat so the editor lists this session while it is connected
const ping = () => {
  try {
    const info = bridgeInfo();
    fetch(`http://127.0.0.1:${info.port}/ping`, { headers: { Authorization: `Bearer ${info.token}`, 'X-ICut-Client': clientHeader() } }).catch(() => {});
  } catch {}
};
setTimeout(ping, 1500);
setInterval(ping, 30_000).unref();
