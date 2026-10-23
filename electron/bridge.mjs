// Local HTTP bridge so an external Claude Code session (via mcp/server.mjs) can drive the open editor.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const BRIDGE_FILE = path.join(os.homedir(), '.ingrainedcut', 'bridge.json');

function clientOf(req) {
  try {
    const c = JSON.parse(req.headers['x-icut-client'] || 'null');
    return c && typeof c.id === 'string' ? { id: c.id.slice(0, 64), name: String(c.name || '').slice(0, 64) } : null;
  } catch {
    return null;
  }
}

/** @param onClient called with ({id,name}, toolName?) whenever an external session pings or calls a tool */
export function startBridge(dispatch, onClient) {
  const token = crypto.randomBytes(24).toString('hex');
  const server = http.createServer(async (req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'unauthorized' });
    const client = clientOf(req);
    if (req.method === 'GET' && req.url === '/ping') {
      onClient?.(client);
      return send(200, { ok: true, app: 'IngrainedCut' });
    }
    if (req.method === 'POST' && req.url === '/call') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', async () => {
        try {
          const { name, args } = JSON.parse(body || '{}');
          onClient?.(client, name);
          send(200, await dispatch(name, args || {}, client));
        } catch (e) {
          send(200, { content: [{ type: 'text', text: 'Error: ' + (e?.message || e) }], isError: true });
        }
      });
      return;
    }
    send(404, { error: 'not found' });
  });
  let info = null;
  const write = () => {
    fs.mkdirSync(path.dirname(BRIDGE_FILE), { recursive: true });
    fs.writeFileSync(BRIDGE_FILE, JSON.stringify(info));
  };
  server.listen(0, '127.0.0.1', () => {
    info = { port: server.address().port, token, pid: process.pid };
    write();
  });
  // The desktop app and the helper can run at once and the newest one owns the file; when that one exits, take it back
  // so outside Claude Code sessions keep reaching a running editor.
  const reclaim = setInterval(() => {
    if (!info) return;
    try {
      const cur = JSON.parse(fs.readFileSync(BRIDGE_FILE, 'utf8'));
      if (cur.token === token) return;
      process.kill(cur.pid, 0); // throws when that process is gone
    } catch {
      write();
    }
  }, 10_000);
  reclaim.unref?.();
  return {
    /** This engine's own bridge, handed to the in-app agents' MCP servers so they never follow the file elsewhere. */
    info: () => info,
    close() {
      clearInterval(reclaim);
      server.close();
      try {
        const cur = JSON.parse(fs.readFileSync(BRIDGE_FILE, 'utf8'));
        if (cur.token === token) fs.rmSync(BRIDGE_FILE, { force: true });
      } catch {}
    },
  };
}
