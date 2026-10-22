#!/usr/bin/env node
// IngrainedCut MCP server (stdio). Lets any Claude Code session edit the project open in IngrainedCut:
//   claude mcp add ingrainedcut -- node "<path-to>/mcp/server.mjs"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOL_DEFS, SERVER_INSTRUCTIONS } from '../electron/tools.mjs';

const BRIDGE_FILE = path.join(os.homedir(), '.ingrainedcut', 'bridge.json');

// identifies this Claude Code session to the editor so it can show it as a running agent
// (the chat's own Codex / Cursor agent sets ICUT_CLIENT_ID so it isn't listed as an outside session)
const clientHeader = () =>
  JSON.stringify({ id: process.env.ICUT_CLIENT_ID || `mcp-${process.pid}`, name: process.env.ICUT_CLIENT_NAME || server.server.getClientVersion()?.name || 'Claude Code' });

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

const server = new McpServer({ name: 'ingrainedcut', version: '0.1.0' }, { instructions: SERVER_INSTRUCTIONS });
for (const d of TOOL_DEFS) {
  server.registerTool(d.name, { description: d.description, inputSchema: d.shape }, async (args) => call(d.name, args ?? {}));
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
