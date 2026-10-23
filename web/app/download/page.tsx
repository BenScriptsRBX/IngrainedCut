import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { HelperStatus } from './HelperStatus';
import { HELPER_COMMAND } from '@/lib/helper';

export const metadata: Metadata = { title: 'Set up the helper', description: 'Run the free IngrainedCut helper on your computer to edit with AI — Claude, Codex or Cursor — using your own API key or account.' };

export default function DownloadPage() {
  return (
    <>
      <SiteHeader />
      <main className="prose">
        <h1>Set up the helper</h1>
        <p className="updated">About two minutes. Windows, macOS and Linux.</p>
        <HelperStatus />
        <p>
          The editor works on its own in your browser. The helper is optional: it runs your AI agent (Claude, Codex or Cursor) on your computer with your own
          account, and adds transcription, silence and scene detection, and ProRes / GIF / MP3 export. Nothing is uploaded, and it only accepts connections from this
          website.
        </p>

        <h2>1. Install the requirements</h2>
        <ul>
          <li>
            <b>Node.js 22 or newer</b> — <a href="https://nodejs.org/">nodejs.org</a>
          </li>
          <li>
            <b>FFmpeg</b> is included. If you already have it on your PATH, the helper uses yours.
          </li>
          <li>
            <b>Chrome or Edge</b> for the editor itself
          </li>
        </ul>

        <h2>2. Start the helper</h2>
        <p>Open a terminal and run:</p>
        <div className="cmd">{HELPER_COMMAND}</div>
        <p>
          The first run downloads it (a minute or two). Keep that window open while you edit, then click <b>Connect</b> in the editor (after the first time it connects by itself). Your browser will ask to let
          this site access devices on your local network — allow it, so the editor can reach the helper on your computer.
        </p>

        <h2>3. Connect an AI agent (any one)</h2>
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Install</th>
              <th>Set up</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Claude</td>
              <td>
                Your own Claude Code — the Claude desktop app, or <a href="https://docs.claude.com/en/docs/claude-code/setup">Claude Code</a> on its own
              </td>
              <td>
                Built-in chat: add an Anthropic API key in the editor&apos;s Settings. Have a Claude plan? In the editor, open Help → Use your own Claude Code, Codex
                or Cursor, run the command it shows once, then use Claude Code as usual.
              </td>
            </tr>
            <tr>
              <td>Codex</td>
              <td>Included with the helper</td>
              <td>
                Built-in chat: add an OpenAI API key in Settings. Have a ChatGPT plan? Install Codex yourself and connect it the same way (Help → Use your own
                Claude Code, Codex or Cursor).
              </td>
            </tr>
            <tr>
              <td>Cursor</td>
              <td>
                Cursor CLI — see <a href="https://cursor.com/docs/cli/installation">cursor.com/docs/cli</a>
              </td>
              <td>In the editor: agent menu → Cursor → Sign in to Cursor (or <code className="inline">cursor-agent login</code>)</td>
            </tr>
          </tbody>
        </table>
        <p>Choose the agent from the model button at the top of the AI panel in the editor. Cursor keeps its tool settings in a <code className="inline">.cursor/mcp.json</code> inside your project folder. AI usage is billed by that provider: API prices for the built-in Claude and Codex chat, or your own plan when you connect your own app.</p>

        <h2>Troubleshooting</h2>
        <ul>
          <li>
            <b>Connect can’t find the helper</b> — make sure the terminal running the command above is still open, and that you allowed local network access
            (site settings → Local network access).
          </li>
          <li>
            <b>Port in use</b> — the helper uses port 5310 on <code className="inline">127.0.0.1</code>. Close other copies of the helper or the desktop app.
          </li>
          <li>
            <b>Media offline</b> — media stays on the computer (and browser) where you imported it. On another computer, re-import the files.
          </li>
        </ul>
        <p>
          <Link href="/projects" className="btn primary" style={{ textDecoration: 'none', marginTop: 20 }}>
            Go to your projects
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
