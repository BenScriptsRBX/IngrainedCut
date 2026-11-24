// Downloading videos from links (YouTube, Twitch, X, TikTok, Reddit and every other site yt-dlp supports), on the
// user's own computer: their connection and their responsibility for what they download, nothing goes through
// IngrainedCut's servers. yt-dlp is the official standalone build from its GitHub releases, fetched the first time
// it's needed into the app's data folder (checked against the release's SHA-256 list) and updated weekly, since sites
// change and older yt-dlp versions stop working. ICUT_YTDLP points at another copy.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runtimeDir } from './runtimePackages.mjs';

const RELEASES = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
const UPDATE_EVERY = 7 * 24 * 3600_000;

function assetName() {
  if (process.platform === 'win32') return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
}

const binPath = () => path.join(runtimeDir('yt-dlp'), assetName());

let installing = null;
/** Download yt-dlp from its GitHub releases into the data folder (first use), verifying its SHA-256. */
function install(onLine) {
  installing ??= (async () => {
    try {
      const name = assetName();
      onLine?.('Downloading yt-dlp (first time only)…');
      const [bin, sums] = await Promise.all([fetch(`${RELEASES}/${name}`), fetch(`${RELEASES}/SHA2-256SUMS`)]);
      if (!bin.ok) throw new Error(`Couldn't download yt-dlp (HTTP ${bin.status}). Is this computer online?`);
      const buf = Buffer.from(await bin.arrayBuffer());
      if (sums.ok) {
        const want = (await sums.text())
          .split(/\r?\n/)
          .map((l) => l.trim().split(/\s+/))
          .find(([, f]) => f === name)?.[0];
        const got = crypto.createHash('sha256').update(buf).digest('hex');
        if (want && want.toLowerCase() !== got) throw new Error('The yt-dlp download was damaged (checksum mismatch). Try again.');
      }
      fs.mkdirSync(runtimeDir('yt-dlp'), { recursive: true });
      const tmp = binPath() + '.download';
      fs.writeFileSync(tmp, buf, { mode: 0o755 });
      fs.renameSync(tmp, binPath());
      return binPath();
    } finally {
      installing = null;
    }
  })();
  return installing;
}

/** yt-dlp's own updater (it replaces its executable); failures are ignored, the current copy keeps working. */
function selfUpdate(bin, onLine) {
  onLine?.('Updating yt-dlp…');
  return new Promise((resolve) => {
    const p = spawn(bin, ['-U'], { windowsHide: true });
    p.on('error', () => resolve());
    p.on('close', () => {
      try {
        const now = new Date();
        fs.utimesSync(bin, now, now);
      } catch {}
      resolve();
    });
  });
}

/** The yt-dlp to run: ICUT_YTDLP, else the app's own copy (installed or updated first when needed). */
export async function ytDlp(onLine) {
  if (process.env.ICUT_YTDLP) return process.env.ICUT_YTDLP;
  const bin = binPath();
  if (!fs.existsSync(bin)) return install(onLine);
  if (Date.now() - fs.statSync(bin).mtimeMs > UPDATE_EVERY) await selfUpdate(bin, onLine);
  return bin;
}

/**
 * YouTube needs a JavaScript runtime for yt-dlp to read its pages. Node runs this app (the helper), and Electron is Node
 * too when started with ELECTRON_RUN_AS_NODE, so yt-dlp gets this very process's executable.
 */
function jsRuntime() {
  return { args: ['--js-runtimes', `node:${process.execPath}`], env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} };
}

const sanitize = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

/**
 * Download one video (or its audio) from a link into `outDir`.
 * @returns {Promise<{ path: string, title: string, url: string }>}
 */
export async function download(url, { outDir, start, end, maxHeight = 1080, audioOnly = false, ffmpeg, onProgress, signal } = {}) {
  if (!/^https?:\/\//i.test(String(url))) throw new Error('Give a full link starting with http:// or https://');
  const report = (progress, line) => onProgress?.({ progress, line: sanitize(line).slice(0, 160) });
  const bin = await ytDlp((line) => report(0, line));
  fs.mkdirSync(outDir, { recursive: true });
  const js = jsRuntime();
  // Windows paths stop at 260 characters: a deep folder leaves less room for the title in the file name
  // (the rest: " [id]" ~15, ".mp4.part" and yt-dlp's format suffixes ~25)
  const titleRoom = process.platform === 'win32' ? Math.max(16, Math.min(90, 255 - outDir.length - 45)) : 90;
  // a section or a lower quality of the same video is a different file (otherwise yt-dlp hands back the earlier one)
  const part = start != null || end != null ? ` ${Math.round(Number(start) || 0)}-${end != null ? Math.round(Number(end)) : 'end'}s` : '';
  const variant = audioOnly ? ' audio' : Number(maxHeight) && Number(maxHeight) !== 1080 ? ` ${Math.round(Number(maxHeight))}p` : '';
  const args = [
    '--no-playlist',
    '--no-mtime',
    '--windows-filenames',
    '--newline',
    '--no-colors',
    '--progress',
    '--encoding',
    'utf-8',
    '-P',
    outDir,
    '-o',
    `%(title).${titleRoom}B [%(id)s]${part}${variant}.%(ext)s`,
    '--print',
    'before_dl:TITLE %(title)s',
    '--print',
    'before_dl:ID %(id)s',
    '--print',
    'after_move:FILE %(filepath)s',
    ...js.args,
  ];
  if (ffmpeg && ffmpeg !== 'ffmpeg') args.push('--ffmpeg-location', ffmpeg);
  if (audioOnly) args.push('-f', 'ba/b', '-x', '--audio-format', 'm4a');
  else {
    const h = Math.max(144, Math.min(4320, Math.round(Number(maxHeight) || 1080)));
    // H.264 + AAC in MP4 where the site has it: plays and exports everywhere
    args.push('-f', 'bv*+ba/b', '-S', `res:${h},vcodec:h264,acodec:aac`, '--merge-output-format', 'mp4');
  }
  if (start != null || end != null) {
    const a = Math.max(0, Number(start) || 0);
    const b = end != null ? Number(end) : 'inf';
    args.push('--download-sections', `*${a}-${b}`, '--force-keyframes-at-cuts');
  }
  args.push('--', url);

  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...js.env } });
    let file = null;
    let title = '';
    let id = '';
    let errText = '';
    let parts = 0; // video and audio download one after the other
    let lastPct = -1;
    const onLine = (line) => {
      if (line.startsWith('TITLE ')) {
        title = line.slice(6);
        report(0.01, `Downloading “${title}”`);
      } else if (line.startsWith('ID ')) id = line.slice(3).trim();
      else if (line.startsWith('FILE ')) file = line.slice(5).trim();
      else if (/^\[download\]\s+Destination:/.test(line)) parts++;
      else {
        const m = line.match(/^\[download\]\s+(\d{1,3}(?:\.\d+)?)%/);
        if (m) {
          const pct = parseFloat(m[1]);
          if (pct !== lastPct) {
            lastPct = pct;
            // two parts (video, then audio): the first fills most of the bar
            const share = audioOnly ? pct / 100 : parts <= 1 ? (pct / 100) * 0.85 : 0.85 + (pct / 100) * 0.1;
            report(Math.min(0.97, share), line.replace(/^\[download\]\s+/, ''));
          }
        } else if (/^\[(Merger|ExtractAudio|FixupM3u8|VideoConvertor|download)\]/.test(line)) report(0.97, line);
        else if (/^ERROR:/.test(line)) errText += line + '\n';
      }
    };
    let buf = { out: '', err: '' };
    const feed = (key) => (d) => {
      buf[key] += d.toString();
      let i;
      while ((i = buf[key].search(/\r?\n/)) >= 0) {
        const line = buf[key].slice(0, i).trim();
        buf[key] = buf[key].slice(buf[key][i] === '\r' ? i + 2 : i + 1);
        if (line) onLine(line);
      }
    };
    p.stdout.on('data', feed('out'));
    p.stderr.on('data', feed('err'));
    p.on('error', reject);
    signal?.addEventListener('abort', () => p.kill());
    p.on('close', (code) => {
      for (const k of ['out', 'err']) if (buf[k].trim()) onLine(buf[k].trim());
      // the printed path, else the newest file named with the video's id (in case the console mangled the name)
      if (code === 0 && !(file && fs.existsSync(file)) && id) file = newestWithId(outDir, id);
      if (code === 0 && file && fs.existsSync(file)) return resolve({ path: file, title: title || path.basename(file), url });
      const why = errText.trim() || `yt-dlp exited with code ${code}`;
      reject(new Error(friendly(why)));
    });
  });
}

function newestWithId(dir, id) {
  try {
    const hit = fs
      .readdirSync(dir)
      .filter((f) => f.includes(`[${id}]`) && !/\.(part|ytdl|temp)$/i.test(f))
      .map((f) => path.join(dir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return hit[0] ?? null;
  } catch {
    return null;
  }
}

function friendly(msg) {
  if (/Sign in to confirm|not a bot/i.test(msg)) return `The site asked to confirm you're not a bot, so it blocked the download for now. Try again later. (${msg.slice(0, 200)})`;
  if (/Private video|members-only|This video is available to this channel's members/i.test(msg)) return `That video is private or members-only, so it can't be downloaded. (${msg.slice(0, 200)})`;
  if (/Unsupported URL/i.test(msg)) return `That link isn't a video page yt-dlp knows how to download. (${msg.slice(0, 200)})`;
  if (/Video unavailable|removed|does not exist|404/i.test(msg)) return `That video isn't available (removed, region-locked or the link is wrong). (${msg.slice(0, 200)})`;
  return msg.slice(0, 800);
}
