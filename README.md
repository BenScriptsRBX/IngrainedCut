<p align="center">
  <img src="docs/logo.svg" alt="IngrainedCut logo" width="112" height="112">
</p>

<h1 align="center">IngrainedCut</h1>

<p align="center"><b>The video editor you can talk to.</b><br>
<a href="https://ingrainedcut.vercel.app">Website</a> · <a href="LICENSE">AGPL-3.0</a></p>

A Premiere Pro–style non-linear video editor with an AI editor built in. A chat panel on the right talks to
Claude (via the Claude Agent SDK), Codex or Cursor; the agent sees the whole timeline with every message
and edits it live through IngrainedCut's own MCP tools, while you watch the timeline and program monitor update.

It runs three ways: the desktop app, the browser on your own computer (`npm run web`), and a public website
(`web/`) where people sign in with Google, keep their projects in the cloud, edit right in the browser, and add the
AI agents by running a small local helper.

## Run it

Requirements: Node 18+, and FFmpeg/FFprobe on your `PATH` (`winget install Gyan.FFmpeg`).

```bash
npm install
```

```bash
npm start
```

`npm run dev` starts the same app with hot reload for the UI.

### Run it in your browser

```bash
npm run web
```

This starts a local IngrainedCut server and opens the editor in your default browser (use Chrome or Edge).
It is the same editor and the same engine: FFmpeg, export, Claude, HyperFrames and the MCP bridge all
run natively on your computer, and media streams straight from your disk — nothing is uploaded. The server
only listens on `localhost` and only accepts the private link it opens (it prints it too); keep its terminal
open while you edit, Ctrl+C to stop. Add a project path to open it on start: `npm run web:serve -- "My Edit.icut"`.

Differences from the desktop app: Import… (Ctrl+I) and Save use your system's file dialogs as usual, but
files **dragged** into the browser are copied into `Documents/IngrainedCut/Imported` first, because browsers
never reveal file paths. The desktop app and the browser version share settings and the media cache.

### Connect an AI agent

Pick the agent from the model button at the top of the chat panel: **Claude**, **Codex** or **Cursor**.
Each uses the user's own account, so usage is billed by (or counted against the plan with) that provider.

- **Claude** — runs on the user's **own Claude Code** (`electron/claudeCode.mjs` finds it: `ICUT_CLAUDE_PATH`, `claude`
  on PATH, the copy inside the Claude desktop app, or `~/.local/bin`), with their sign-in, skills and settings.
  IngrainedCut has no Claude sign-in of its own: people sign in inside Claude Code (the Claude app, or `claude` →
  `/login`), or paste an Anthropic API key in Settings. Model (Opus 5.5 by default) and effort are in the same menu.
- **Codex** — installs on first use (`@openai/codex-sdk`, ~450 MB). **Sign in with ChatGPT** runs `codex login`, or add an
  OpenAI API key in Settings. The model list and reasoning levels come from the Codex CLI's own catalog. By
  default Codex's shell is sandboxed to the project folder; **Bypass permissions** gives it full access.
- **Cursor** — install the Cursor CLI (`irm 'https://cursor.com/install?win32=true' | iex` on Windows,
  `curl https://cursor.com/install -fsS | bash` elsewhere), then **Sign in to Cursor** or add a Cursor API key. IngrainedCut
  adds its MCP server to `<project folder>/.cursor/mcp.json` and passes each turn through `.ingrainedcut/chat-turn.md`.

Codex and Cursor reach the editor through `mcp/server.mjs`, the same tools Claude uses; switching agents starts a
new conversation.

## Editor features

- **Layout**: Source / Effect Controls / Audio Track Mixer, Program monitor, Project / Effects / History,
  tools strip, timeline, audio meters, Claude panel — all resizable; workspaces in the title bar.
- **Timeline**: unlimited video/audio tracks, linked A/V clips, snapping, marquee selection, track
  targeting, lock / hide / mute / solo, track height, markers, In/Out, zoom, filmstrips and waveforms,
  drag-and-drop from the bin, the Source Monitor or Explorer (Ctrl = insert).
- **Tools**: Selection, Track Select Forward, Ripple, Rolling, Rate Stretch, Razor, Slip, Slide, Hand, Type.
- **Editing**: add edit (Ctrl+K), ripple delete, lift/extract, Q/W ripple trims, insert/overwrite from
  source, copy/paste/duplicate (Alt-drag), nudge, speed/duration, enable/disable, link/unlink, labels,
  full undo/redo history.
- **Effects**: position/scale/rotation/opacity with keyframes, blend modes, crop, blur, B&W, sepia, invert,
  chroma key, adjustment layers, color mattes, text/titles, fades, 10 transitions, audio gain/pan/fades
  with draggable volume rubber bands.
- **Color (Color Grading panel, Color workspace)**: GPU grading per clip and on adjustment layers — white balance
  and exposure in linear light, contrast, highlights / shadows / whites / blacks, saturation, vibrance, RGB curves,
  shadow / midtone / highlight color wheels (lift / gamma / gain), built-in looks and imported `.cube` 3D LUTs with
  intensity, vignette, Auto, copy / paste grade, grade on/off. Scopes: waveform, RGB parade, vectorscope
  (with skin-tone line) and histogram, live from the program monitor. The same grade renders in exports.
- **Syncing**: Clip → Synchronize… lines clips up with a reference by audio (FFT cross-correlation of loudness
  envelopes, sub-frame accurate — camera audio with an external mic, multicam) or by start / end, and can link them.
- **Cutting**: razor, Add Edit (all tracks with Ctrl+Shift+K), ripple / rolling / slip / slide trims, lift / extract,
  Split at Markers, Remove Silence… (threshold, minimum length, padding, live preview; ripple-deletes on every track
  so sync holds) and Scene Edit Detection (cuts at shot changes; needs the desktop app or helper).
- **Program monitor**: real-time compositing with WebAudio mixing, J/K/L shuttle, safe margins,
  playback resolution, on-screen move/scale handles.
- **Export**: H.264, HEVC, ProRes 422 HQ, VP9, GIF, MP3, WAV; full sequence or In/Out; frame export.
  Export renders through the same compositor as the preview, so what you see is what you get. Clips are
  decoded frame-accurately with WebCodecs, and H.264/VP9 (and HEVC where the GPU encoder works) are encoded
  with WebCodecs too, with FFmpeg only muxing in the audio — a 22-second 1080p sequence exports in about 5
  seconds. ProRes, GIF and HEVC without a working hardware encoder go through FFmpeg. Exports are tagged
  BT.709, so colours match the program monitor in any player.
- **Projects**: `.icut` JSON files (File → Save / Open).

## Claude integration

- Every message carries an `<editor_state>` snapshot (sequence, bin, every clip with timing and
  properties, playhead, selection), so Claude always works from what is on screen. Attach the current
  frame with the **Frame** chip.
- 40 tools: read state, import, add clips/text/captions/mattes/adjustment layers, move, trim, split, sync,
  remove silence, color grade / looks / auto color,
  ripple-delete ranges, set any clip property, transitions, keyframes, tracks, markers, sequence
  settings, undo/redo, batch edits, export, save — plus **capture_frame** / **capture_contact_sheet** /
  **screenshot_editor** so Claude can look at the result, and **detect_silence**, **detect_scenes**,
  **transcribe** (Whisper via FFmpeg; download a model in Settings) and **analyze_loudness**.
- Every Claude edit is one undo step, flashes in the timeline, and each turn has a "Revert these edits"
  button. Non-editor tools (shell, file edits) ask for your permission in the chat.

### Making videos the HyperFrames way

The in-app Claude loads your Claude Code skills (including the HyperFrames skills in `~/.claude/skills`).
Ask it to make titles, intros, lower thirds, motion graphics, explainers or promos and it builds a
HyperFrames composition in `compositions/<name>/` next to your project, runs `npx hyperframes lint/check`,
then renders it with the `render_composition` tool, which drops the result onto the timeline. Overlays
render as transparent WebM on a free track above your footage; full-frame pieces render as MP4. Ask for
changes and it edits the composition and re-renders in place: the clips already in your edit update.
Media made from a composition shows an **HF** badge in the Project panel (right-click → Open Composition
Folder / Ask Claude to revise). Requires Node 22+ and FFmpeg; `npx` fetches the HyperFrames CLI on first use.

### Permissions, parallel agents and past chats

- **Ask before actions / Bypass permissions** (button under the chat input): bypass lets Claude run shell
  commands and file edits without asking. It takes effect immediately, even mid-turn, and approves
  anything already waiting. Reading the project's own media folders never asks.
- **Parallel agents** (model button → Parallel agents): Claude can hand work to subagents —
  `footage-analyst` (read-only analysis, one per file), `timeline-editor` (edits a given track/time range)
  and `qc-reviewer` (read-only review). Claude passes each one the media ids, file paths, clip ids and
  time ranges it needs. The **N agents** chip in the chat header lists every agent working on the project,
  including other Claude Code sessions connected over MCP.
- **Past chats** (paperclip button): pick any Claude Code conversation and either **Attach as context**
  (its messages go with your next message) or **Continue here** (resumes it with full history, on a copy).

### Use it from any Claude Code session (MCP)

Keep IngrainedCut open and register its MCP server (Help → Connect Claude Code shows the exact path):

```bash
claude mcp add ingrainedcut -- node "C:\path\to\IngrainedCut\mcp\server.mjs"
```

The server reaches the running editor through a token-protected local connection described in
`~/.ingrainedcut/bridge.json`.

## The website (`web/`)

A Next.js 16 app: animated home page, Google sign-in (Better Auth), a projects page, the editor at `/editor`,
account page with account deletion, download/helper page, Terms of Service and Privacy Policy. Project
timelines are stored in Postgres; media never leaves the user's computer.

The website editor runs in one of two modes, chosen when a project opens:

- **In the browser** (no install): `src/browserEngine.ts` copies imported media into the browser's private storage
  (OPFS), probes it and makes thumbnails, filmstrips and waveforms with mediabunny, and exports H.264 / HEVC / VP9 /
  WAV with WebCodecs straight to the file the user picks. AI and FFmpeg-only features say to connect the helper.
- **With the helper**: the **IngrainedCut helper** (`server/web.mjs`) runs the engine, FFmpeg, export and the AI agents
  (Claude, Codex, Cursor) locally on `127.0.0.1:5310` and only accepts the origins in `server/site.json`. Users start it
  with `npx -y https://<site>/helper/ingrainedcut-<version>.tgz`: the site build packs the repo into that tarball
  (`web/scripts/pack-helper.mjs`), so nothing has to be published to npm. FFmpeg comes with it (used only when it isn't on
  PATH), and Codex installs on first use (it is ~450 MB). Clicking **Connect** in the editor switches to the helper and
  copies any browser-stored media to `Documents/IngrainedCut/Imported`. The editor only contacts 127.0.0.1 after the
  user has connected once, because browsers ask for local-network permission.

Bump `version` in the root `package.json` for every helper release: `npx` caches what it installed per URL.

Run it locally (an embedded Postgres starts automatically; "Sign in as test user" is shown because
`web/.env.local` sets `ICUT_DEV_LOGIN=1`):

```bash
npm --prefix web install
```

```bash
npm --prefix web run dev
```

```bash
npm run helper
```

### Deploying to Vercel

1. Push this repository to GitHub and import it in Vercel. Set **Root Directory** to `web` and keep
   "Include files outside the root directory" on (the build compiles the editor from `../src`). Framework: Next.js;
   the build command in `web/package.json` builds the editor, applies `web/db/schema.sql`, then runs `next build`.
2. **Storage → Create → Neon Postgres** and connect it to the project; that sets `DATABASE_URL`.
3. Environment variables (Production and Preview), see `web/.env.example`:
   `NEXT_PUBLIC_SITE_URL` and `BETTER_AUTH_URL` = `https://your-domain`, `BETTER_AUTH_SECRET` = output of
   `openssl rand -base64 32`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Do **not** set `ICUT_DEV_LOGIN` (it is ignored in production anyway).
4. Google Cloud Console → APIs & Services → Credentials → OAuth client (Web application). Authorized JavaScript
   origin `https://your-domain`; redirect URI `https://your-domain/api/auth/callback/google`. Configure the OAuth
   consent screen with the site name, logo, `/privacy` and `/terms` links, then publish it.
5. Put the real domain in `server/site.json` (`origins` and `openUrl`). The build serves the helper from the site itself.
6. Fill in the bracketed placeholders in `web/lib/site.ts` (legal name, contact emails, address, governing law,
   effective date) and have a lawyer review `/terms` and `/privacy` before launch; remove the draft banners after.

## Layout of the code

| Path | What it is |
| --- | --- |
| `electron/main.mjs` | Electron host: window, `icut://` media protocol, dialogs |
| `electron/core.mjs` | The engine shared by the desktop app and the helper: every handler, agent routing, sign-in |
| `electron/otherAgents.mjs` | Codex and Cursor agents (their CLIs + the IngrainedCut MCP server) |
| `electron/agent.mjs` | Claude Agent SDK session + in-process MCP server |
| `electron/tools.mjs` | The tool registry (shared with the stdio MCP server) |
| `electron/media.mjs` | FFprobe/FFmpeg: probing, thumbnails, waveforms, silence/scene detection, Whisper |
| `electron/exporter.mjs` | Streams rendered frames into FFmpeg |
| `mcp/server.mjs` | Standalone stdio MCP server (external Claude Code sessions, Codex, Cursor) |
| `server/web.mjs` | The local helper / browser server (`npm run web`, or `npx` from the website) |
| `src/browserEngine.ts` | The website editor's in-browser engine (no helper): storage, probing, thumbnails, waveforms |
| `web/` | The public website (Next.js on Vercel) |
| `src/ops.ts` | Pure timeline editing operations |
| `src/compositor.ts` | Canvas compositor + audio engine |
| `src/claudeTools.ts` | Executes Claude's tools against the editor state |
| `src/components/` | UI panels |

`sample-media/` holds a few generated test clips you can import to try things out.

## Contributing

Issues and pull requests are welcome at https://github.com/BenScriptsRBX/IngrainedCut. Run `npx tsc --noEmit -p .`
and `npx tsc --noEmit -p web` before sending a change. By contributing you agree that your contribution is licensed
under the same license as the project.

## License

Copyright (C) 2026 BenScriptsRBX and IngrainedCut contributors.

IngrainedCut is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General
Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any
later version. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied
warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.

If you run a modified version of IngrainedCut as a network service (for example a website like the one in `web/`), the
AGPL requires you to offer its users the source code of your version.

**Additional permission under GNU AGPL version 3 section 7.** If you modify this program, or any covered work, by
linking or combining it with the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), the OpenAI Codex SDK
(`@openai/codex-sdk`), the Cursor CLI, or FFmpeg (or modified versions of those), containing parts covered by the terms
of their own licenses or terms of service, the licensors of this program grant you additional permission to convey the
resulting work.

Third-party software used by IngrainedCut keeps its own license; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
"Claude" is a trademark of Anthropic, PBC; "Codex" and "ChatGPT" are trademarks of OpenAI; "Cursor" is a trademark of
Anysphere, Inc. IngrainedCut is independent and not affiliated with or endorsed by these companies.
