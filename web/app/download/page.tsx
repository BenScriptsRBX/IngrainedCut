import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { HelperStatus } from './HelperStatus';
import { ExtensionStatus } from './ExtensionStatus';
import { EXTENSION_STORE, EXTENSION_ZIP, HELPER_COMMAND, HELPER_DOWNLOAD } from '@/lib/helper';

export const metadata: Metadata = { title: 'Set up AI editing', description: 'Add the free IngrainedCut extension or helper to edit with ChatGPT on your ChatGPT plan.' };

export default function DownloadPage() {
  return (
    <>
      <SiteHeader />
      <main className="prose">
        <h1>Set up AI editing</h1>
        <p className="updated">About a minute.</p>
        <p>
          The editor works on its own in your browser. To edit with ChatGPT on your ChatGPT plan (Plus or Pro) and download videos from links (YouTube,
          Twitch, X, TikTok…), add the IngrainedCut extension to your browser. For transcription, captions from speech, silence and scene detection, and
          ProRes / GIF / MP3 export, set up the helper on your computer instead (it includes ChatGPT and downloading too).
        </p>

        <h2 id="extension">Chrome, Edge or Brave: the extension</h2>
        <ExtensionStatus />
        {EXTENSION_STORE ? (
          <p>
            <a className="btn primary" href={EXTENSION_STORE} style={{ textDecoration: 'none' }}>
              Add to Chrome
            </a>
          </p>
        ) : (
          <>
            <p>
              <a className="btn primary" href={EXTENSION_ZIP} style={{ textDecoration: 'none' }}>
                Download the extension
              </a>
            </p>
            <p>It isn’t on the Chrome Web Store yet, so it takes a few more clicks for now:</p>
            <ol>
              <li>Unzip the download.</li>
              <li>
                Open <code className="inline">chrome://extensions</code> (Edge: <code className="inline">edge://extensions</code>) and turn on{' '}
                <b>Developer mode</b>.
              </li>
              <li>
                Click <b>Load unpacked</b> and pick the unzipped <b>IngrainedCut-Chrome-Extension</b> folder. Keep the folder where it is.
              </li>
            </ol>
          </>
        )}
        <p>
          Then open the editor (reload it if it was open), pick <b>ChatGPT</b> in the AI panel and click <b>Continue with ChatGPT</b>. Your ChatGPT sign-in
          stays in the extension in your browser and goes only to OpenAI; the chat edits your timeline right in the page.
        </p>
        <p>
          The extension also downloads videos from links: <b>File → Import from Link…</b> in the editor, or ask ChatGPT. It runs{' '}
          <a href="https://github.com/yt-dlp/yt-dlp">yt-dlp</a> inside your browser, so the video comes straight from the site to your browser&apos;s
          storage. Only download videos you have the right to use.
        </p>

        <h2>The helper</h2>
        <HelperStatus />
        <p>
          The helper runs on your computer: nothing is uploaded, and it only accepts connections from this website. It adds the tools that need FFmpeg and
          Whisper, and runs ChatGPT and Codex itself.
        </p>

        <h3>Windows</h3>
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

        <h3>macOS and Linux</h3>
        <p>
          Install <a href="https://nodejs.org/">Node.js 22 or newer</a>, then run this in a terminal and keep it open while you edit:
        </p>
        <div className="cmd">{HELPER_COMMAND}</div>

        <h3>Then</h3>
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
