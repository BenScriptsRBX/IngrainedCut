// The in-app Claude chat: a long-lived Claude Code session (Agent SDK) with the IngrainedCut
// MCP tools attached in-process. Messages stream to the renderer's chat panel.
import { TOOL_DEFS, SERVER_INSTRUCTIONS } from './tools.mjs';
import { EDITOR_GUIDE } from './guide.mjs';
import { findClaudeCode, CLAUDE_CODE_INSTALL } from './claudeCode.mjs';
import { claudeSdk } from './runtimePackages.mjs';

export { EDITOR_GUIDE };

const SERVER = 'ingrainedcut';

const NEEDS_KEY =
  'The chat here runs on an Anthropic API key: add one in Settings (console.anthropic.com → API keys). To use your Claude subscription instead, open Claude Code yourself and connect it to IngrainedCut: Help → Use your own Claude Code, Codex or Cursor (MCP).';

const SYSTEM_APPEND = `${EDITOR_GUIDE}
# Parallel agents
You can run subagents in parallel with the Agent tool (send several Agent calls in one message to run them at once). The user sees each one running in the panel. Specialists available:
- footage-analyst: transcribes / skims / finds silences, scenes and best moments in specific media. Read-only. Use one per media file to analyse many files at once.
- timeline-editor: carries out a precise, self-contained set of edits on given tracks / a given time range.
- qc-reviewer: watches the cut (frames, contact sheets) and reports problems. Read-only.
- motion-designer: builds and renders one HyperFrames composition (e.g. one per scene or graphic) and places it on the timeline. Run several in parallel for multi-scene pieces, giving each its own composition folder, time slot and track.
Subagents do NOT see <editor_state> or this chat. Always pass everything they need in the task prompt: media ids AND their absolute file paths, clip ids, track names, exact time ranges, the sequence resolution/fps, and the expected output format (e.g. "return JSON ranges in timeline seconds").
All agents edit the same live timeline. Parallelise analysis freely; run edits in parallel only when they touch different tracks or time ranges, otherwise do them in sequence or yourself. Use agents when the work genuinely splits (several files, long footage); for small edits just do it directly.
`;

const ED = (n) => `mcp__${SERVER}__${n}`;
const READ_TOOLS = ['get_project_state', 'capture_frame', 'capture_contact_sheet', 'screenshot_editor', 'detect_silence', 'detect_scenes', 'transcribe', 'analyze_loudness'].map(ED);
const AGENT_BASE = `You are a subagent working inside IngrainedCut, a Premiere-style video editor, on behalf of the main editing assistant. ${SERVER_INSTRUCTIONS}
You cannot see the user's chat; your task prompt contains the media ids, file paths, clip ids and time ranges you need. If something is missing, call get_project_state. Finish with a concise, precise report (timecodes in seconds) that the main assistant can act on directly.`;

const AGENTS = {
  'footage-analyst': {
    description: 'Analyses specific media files or clips for IngrainedCut: transcribes speech, finds silences, scene cuts, best moments and quotes, skims frames. Read-only (never edits). Run one per file to analyse several in parallel.',
    prompt: `${AGENT_BASE}\nYou are read-only: never change the timeline. Use transcribe, detect_silence, detect_scenes, analyze_loudness and capture_contact_sheet (with media_id for source footage). Report times in the frame of reference you were asked for (source or timeline seconds).`,
    tools: [...READ_TOOLS, 'Read', 'Glob', 'Grep'],
  },
  'timeline-editor': {
    description: 'Executes a precise, self-contained set of IngrainedCut timeline edits on specified tracks / time ranges (cuts, trims, placement, titles, effects, transitions), then verifies them visually.',
    prompt: `${AGENT_BASE}\nOnly touch the tracks and time range you were given — other agents may be editing elsewhere at the same time. Prefer batch for multi-step edits. Verify with capture_frame before reporting back.`,
    tools: [...TOOL_DEFS.map((d) => ED(d.name)).filter((t) => !t.endsWith('__export_video') && !t.endsWith('__save_project')), 'Read'],
  },
  'qc-reviewer': {
    description: 'Quality-checks the current IngrainedCut sequence: looks at frames/contact sheets and the timeline for flash frames, gaps, black frames, jump cuts, bad framing, text overlap, audio level problems. Read-only.',
    prompt: `${AGENT_BASE}\nYou are read-only. Inspect the sequence (get_project_state, capture_contact_sheet over the whole sequence and denser over suspicious areas, capture_frame, analyze_loudness) and return a prioritised list of issues with exact timeline times and a suggested fix for each.`,
    tools: READ_TOOLS,
  },
  'motion-designer': {
    description: 'Builds one HyperFrames composition (title, lower third, motion graphic, scene) with the hyperframes skills, renders it with render_composition and places it on the IngrainedCut timeline at the given time/track.',
    prompt: `${AGENT_BASE}\nYou make video content the HyperFrames way: load the \`hyperframes\` skill with the Skill tool and follow it, working only inside the composition folder you were given (create it with \`npx hyperframes init <folder>\` if it does not exist). The timeline is the review step: when lint/check pass, call render_composition (webm for overlays, mp4 for full-frame) with the start/track you were given, then capture_frame to verify. Report the media id and clip ids.`,
    tools: ['Skill', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', ...['get_project_state', 'render_composition', 'capture_frame', 'capture_contact_sheet', 'relink_media'].map(ED)],
  },
};

const SAFE_HF = /^\s*npx(\s+-y)?\s+hyperframes(\s+[^;&|`<>$]*)?$/;

function within(p, dirs) {
  if (typeof p !== 'string' || !p) return false;
  const n = p.replace(/\\/g, '/').toLowerCase();
  return dirs.some((d) => n.startsWith(d.replace(/\\/g, '/').toLowerCase().replace(/\/?$/, '/')));
}

class InputQueue {
  constructor() {
    this.items = [];
    this.wake = null;
    this.closed = false;
  }
  push(m) {
    this.items.push(m);
    this.wake?.();
  }
  close() {
    this.closed = true;
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    while (!this.closed) {
      if (this.items.length) {
        yield this.items.shift();
        continue;
      }
      await new Promise((r) => (this.wake = r));
      this.wake = null;
    }
  }
}

export class AgentManager {
  /**
   * @param {object} o
   * @param {(channel:string, payload:any)=>void} o.emit  send to renderer
   * @param {(name:string, args:any)=>Promise<any>} o.dispatch  run an IngrainedCut tool, returns MCP CallToolResult
   * @param {()=>any} o.getSettings
   * @param {()=>string} o.getCwd
   * @param {(req:any)=>Promise<{allow:boolean, always?:boolean}>} o.askPermission
   * @param {()=>string[]} o.getDirs  folders holding the project and its media
   */
  constructor(o) {
    this.o = o;
    this.q = null;
    this.input = null;
    this.alwaysAllow = new Set();
    this.busy = false;
    this.sessionId = null;
    this.tasks = new Map();
  }

  /** Start the next conversation by resuming an existing Claude Code session (already forked by the caller). */
  resumeFrom(sessionId, cwd) {
    this.reset();
    this.resume = { sessionId, cwd };
  }

  /** Turn "bypass permissions" on/off, live, for the running conversation too. */
  async setBypass(on) {
    try {
      await this.q?.setPermissionMode(on ? 'bypassPermissions' : 'default');
    } catch (e) {
      console.error('setPermissionMode', e?.message);
    }
  }

  buildServer() {
    const { createSdkMcpServer, tool } = this.sdk;
    return createSdkMcpServer({
      name: SERVER,
      version: '0.1.0',
      instructions: SERVER_INSTRUCTIONS,
      tools: TOOL_DEFS.map((d) =>
        tool(d.name, d.description, d.shape, async (args) => {
          try {
            return await this.o.dispatch(d.name, args ?? {});
          } catch (e) {
            return { content: [{ type: 'text', text: 'Error: ' + (e?.message || String(e)) }], isError: true };
          }
        }),
      ),
    });
  }

  /** Start the session on the user's own Claude Code. False (with an explanation in the chat) when it isn't installed. */
  ensure() {
    if (this.q) return true;
    const cc = findClaudeCode();
    if (!cc) {
      this.o.emit('agent:event', {
        type: 'error',
        message: `IngrainedCut runs Claude through your own Claude Code, and it isn't installed on this computer. Install it (\`${CLAUDE_CODE_INSTALL}\`) or the Claude desktop app, sign in there, then send your message again.`,
      });
      return false;
    }
    const s = this.o.getSettings();
    // Anthropic only allows apps built on the Agent SDK to run on an API key, not on someone's Claude subscription
    // (code.claude.com/docs/en/agent-sdk/overview). Subscribers drive IngrainedCut from their own Claude Code over MCP.
    if (!s.apiKey) {
      this.o.emit('agent:event', { type: 'error', message: NEEDS_KEY });
      return false;
    }
    const env = { ...process.env, ANTHROPIC_API_KEY: s.apiKey };
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    this.input = new InputQueue();
    const resume = this.resume;
    this.resume = null;
    // a resumed session keeps its own recorded system prompt, so the editor instructions ride on the first message
    this.introPending = !!resume;
    this.q = this.sdk.query({
      prompt: this.input,
      options: {
        // the user's own Claude Code install (their sign-in or API key, their skills and settings)
        pathToClaudeCodeExecutable: cc.path,
        ...(cc.path.endsWith('.js') ? { executable: 'node' } : {}),
        model: s.model || 'claude-opus-5-5',
        effort: s.effort || 'medium',
        cwd: resume?.cwd || this.o.getCwd(),
        resume: resume?.sessionId,
        env,
        includePartialMessages: true,
        mcpServers: { [SERVER]: this.buildServer() },
        systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_APPEND },
        permissionMode: s.autoApproveAll ? 'bypassPermissions' : 'default',
        allowDangerouslySkipPermissions: true,
        additionalDirectories: this.o.getDirs?.() ?? [],
        // your Claude Code user skills (incl. HyperFrames) and settings
        settingSources: ['user', 'project', 'local'],
        skills: 'all',
        agents: s.multiAgent === false ? undefined : AGENTS,
        disallowedTools: s.multiAgent === false ? ['Agent', 'Task'] : undefined,
        canUseTool: (name, input, opts) => this.canUseTool(name, input, opts),
        stderr: (d) => {
          if (/error/i.test(d)) console.error('[claude]', d.trim());
        },
      },
    });
    this.pump(this.q);
    return true;
  }

  async canUseTool(name, input, opts) {
    const s = this.o.getSettings();
    if ((opts?.mcpServer?.source === 'sdk' && opts.mcpServer.name === SERVER) || name.startsWith(`mcp__${SERVER}__`)) {
      return { behavior: 'allow', updatedInput: input };
    }
    if (s.autoApproveAll || this.alwaysAllow.has(name)) return { behavior: 'allow', updatedInput: input };
    // reading the project's own media/project folders never needs a prompt (main agent and subagents)
    if (['Read', 'Glob', 'Grep', 'LS'].includes(name) && within(input?.file_path ?? input?.path, this.o.getDirs?.() ?? [])) {
      return { behavior: 'allow', updatedInput: input };
    }
    // the HyperFrames workflow: writing inside the compositions folder and plain `npx hyperframes …` commands
    const comps = this.o.getCompositionsDir?.();
    if (comps && ['Write', 'Edit', 'MultiEdit', 'Read', 'Glob', 'Grep'].includes(name) && within(input?.file_path ?? input?.path, [comps])) {
      return { behavior: 'allow', updatedInput: input };
    }
    if ((name === 'Bash' || name === 'PowerShell') && SAFE_HF.test(String(input?.command ?? ''))) {
      return { behavior: 'allow', updatedInput: input };
    }
    const res = await this.o.askPermission({ toolName: name, input, reason: opts?.decisionReason, signal: opts?.signal });
    if (res.allow) {
      if (res.always) this.alwaysAllow.add(name);
      return { behavior: 'allow', updatedInput: input };
    }
    return { behavior: 'deny', message: 'The user declined this action in IngrainedCut.' };
  }

  async pump(q) {
    try {
      for await (const m of q) {
        if (q !== this.q) break;
        this.handle(m);
      }
    } catch (e) {
      if (q === this.q) {
        this.o.emit('agent:event', { type: 'error', message: friendlyError(e) });
        this.q = null;
        this.busy = false;
        this.o.emit('agent:event', { type: 'idle' });
      }
    }
  }

  handle(m) {
    const emit = (ev) => this.o.emit('agent:event', ev);
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init') {
          this.sessionId = m.session_id;
          const srv = m.mcp_servers?.find((x) => x.name === SERVER);
          emit({ type: 'init', model: m.model, sessionId: m.session_id, mcpStatus: srv?.status, apiKeySource: m.apiKeySource, version: m.claude_code_version });
        } else if (m.subtype === 'status') {
          emit({ type: 'status', status: m.status, permissionMode: m.permissionMode });
        } else if (m.subtype === 'task_started') {
          this.tasks.set(m.task_id, m.tool_use_id);
          emit({ type: 'agent_start', taskId: m.task_id, toolUseId: m.tool_use_id, description: m.description, agentType: m.subagent_type || m.task_type, background: !!m.is_backgrounded });
        } else if (m.subtype === 'task_progress') {
          emit({ type: 'agent_progress', taskId: m.task_id, toolUseId: m.tool_use_id, description: m.description, lastTool: m.last_tool_name, usage: m.usage, summary: m.summary });
        } else if (m.subtype === 'task_updated') {
          emit({ type: 'agent_update', taskId: m.task_id, status: m.patch?.status, error: m.patch?.error });
        } else if (m.subtype === 'task_notification') {
          emit({ type: 'agent_done', taskId: m.task_id, toolUseId: m.tool_use_id, status: m.status, summary: m.summary, usage: m.usage });
        }
        break;
      case 'stream_event': {
        if (m.parent_tool_use_id) break;
        const ev = m.event;
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'thinking') emit({ type: 'thinking' });
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') emit({ type: 'text_delta', text: ev.delta.text, msgId: m.uuid });
        if (ev.type === 'content_block_stop') emit({ type: 'block_stop' });
        break;
      }
      case 'assistant': {
        if (m.parent_tool_use_id) {
          // a subagent's step: surface what it is doing under its Agent card
          for (const b of m.message?.content || []) {
            if (b.type === 'tool_use') emit({ type: 'agent_tool', parentToolUseId: m.parent_tool_use_id, name: b.name, input: b.input });
          }
          break;
        }
        if (m.error) emit({ type: 'error', message: assistantError(m.error) });
        for (const b of m.message?.content || []) {
          if (b.type === 'tool_use') emit({ type: 'tool_use', id: b.id, name: b.name, input: b.input });
        }
        break;
      }
      case 'user': {
        if (m.parent_tool_use_id) break;
        const content = m.message?.content;
        if (Array.isArray(content)) {
          for (const b of content) {
            if (b.type === 'tool_result') {
              const parts = Array.isArray(b.content) ? b.content : [{ type: 'text', text: String(b.content ?? '') }];
              const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
              const images = parts.filter((p) => p.type === 'image').length;
              emit({ type: 'tool_result', id: b.tool_use_id, isError: !!b.is_error, text: text.slice(0, 4000), images });
            }
          }
        }
        break;
      }
      case 'result':
        this.busy = false;
        emit({
          type: 'result',
          ok: m.subtype === 'success' && !m.is_error,
          error: m.subtype !== 'success' ? m.subtype : m.is_error ? m.result : undefined,
          cost: m.total_cost_usd,
          durationMs: m.duration_ms,
          usage: m.usage,
          turns: m.num_turns,
        });
        emit({ type: 'idle' });
        break;
      case 'auth_status':
        if (m.error) emit({ type: 'error', message: 'Authentication: ' + m.error });
        break;
      default:
        break;
    }
  }

  async send({ text, context, images = [] }) {
    if (!this.sdk) {
      try {
        this.sdk = await claudeSdk(); // the npx helper downloads it on first use
      } catch (e) {
        this.o.emit('agent:event', { type: 'error', message: e?.message || String(e) });
        this.o.emit('agent:event', { type: 'idle' });
        return;
      }
    }
    if (!this.ensure()) {
      this.o.emit('agent:event', { type: 'idle' });
      return;
    }
    const content = [];
    for (const img of images) content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
    const intro = this.introPending ? `<ingrainedcut_instructions>\nThis conversation has moved into IngrainedCut.\n${SYSTEM_APPEND}\n</ingrainedcut_instructions>\n\n` : '';
    this.introPending = false;
    content.push({ type: 'text', text: intro + (context ? context + '\n\n' : '') + text });
    this.busy = true;
    this.input.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null });
    this.o.emit('agent:event', { type: 'busy' });
  }

  async interrupt() {
    try {
      await this.q?.interrupt();
    } catch {}
  }

  async setModel(model) {
    try {
      await this.q?.setModel(model);
    } catch {}
  }

  /** Change effort for the running conversation (new conversations read it from settings). */
  async setEffort(effort) {
    try {
      await this.q?.applyFlagSettings({ effortLevel: effort });
    } catch {}
  }

  reset() {
    const q = this.q;
    this.q = null;
    this.busy = false;
    this.input?.close();
    try {
      q?.close();
    } catch {}
    this.alwaysAllow.clear();
    this.o.emit('agent:event', { type: 'idle' });
  }
}

function friendlyError(e) {
  const msg = e?.message || String(e);
  if (/auth|login|api key|401|credential/i.test(msg)) {
    return `Your Claude Code isn't signed in. Sign in there (in the Claude app, or run \`claude\` in a terminal and type /login), or add an Anthropic API key in Settings. (${msg.slice(0, 300)})`;
  }
  return msg.slice(0, 1200);
}

function assistantError(err) {
  const map = {
    authentication_failed: "Your Claude Code isn't signed in. Sign in there (in the Claude app, or `claude` → /login), or add an Anthropic API key in Settings.",
    billing_error: 'Billing problem on the Anthropic account.',
    rate_limit: 'Rate limited — wait a moment and try again.',
    invalid_request: 'The request was rejected by the API.',
    server_error: 'Anthropic API server error — try again.',
  };
  return map[err] || `Claude error: ${err}`;
}
