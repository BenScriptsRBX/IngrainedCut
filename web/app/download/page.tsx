import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { HelperStatus } from './HelperStatus';
import { HELPER_COMMAND, HELPER_DOWNLOAD } from '@/lib/helper';

export const metadata: Metadata = { title: 'Set up the helper', description: 'Install the free IngrainedCut helper to edit with ChatGPT on your ChatGPT plan.' };

export default function DownloadPage() {
  return (
    <>
      <SiteHeader />
      <main className="prose">
        <h1>Set up the helper</h1>
        <p className="updated">About a minute.</p>
        <HelperStatus />
        <p>
          The editor works on its own in your browser. The helper adds AI editing with ChatGPT, plus transcription, silence and scene detection, and ProRes /
          GIF / MP3 export. It runs on your computer: nothing is uploaded, and it only accepts connections from this website.
        </p>

        <h2>Windows</h2>
        <p>
          <a className="btn primary" href={HELPER_DOWNLOAD} style={{ textDecoration: 'none' }}>
            Download the helper for Windows
          </a>
        </p>
        <p>
          Run the installer. After that, <b>Connect</b> in the editor starts the helper whenever you edit (your browser asks once to open IngrainedCut
          Helper), and it quits by itself when you stop. While it runs it sits by the clock (IngrainedCut icon): right-click it to quit, or to have it start
          with Windows. If Windows shows “Windows protected your PC” while installing, click <b>More info</b> → <b>Run anyway</b>.
        </p>

        <h2>macOS and Linux</h2>
        <p>
          Install <a href="https://nodejs.org/">Node.js 22 or newer</a>, then run this in a terminal and keep it open while you edit:
        </p>
        <div className="cmd">{HELPER_COMMAND}</div>

        <h2>Then</h2>
        <ol>
          <li>
            Open a project and click <b>Connect</b> in the editor (after the first time it connects by itself). Your browser will ask to let this site access devices
            on your local network — allow it, so the editor can reach the helper on your computer.
          </li>
          <li>
            In the AI panel, pick <b>ChatGPT</b> and click <b>Continue with ChatGPT</b>: the chat runs on your ChatGPT plan (Plus or Pro). Codex is there too, on
            your ChatGPT plan or an OpenAI API key; it downloads itself the first time and needs Node.js.
          </li>
        </ol>

        <h2>Troubleshooting</h2>
        <ul>
          <li>
            <b>Connect can’t find the helper</b> — on Windows, click Connect again and choose Open when the browser asks to open IngrainedCut Helper; on macOS / Linux, make sure the terminal with the command is still open, and that you allowed local network access
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
