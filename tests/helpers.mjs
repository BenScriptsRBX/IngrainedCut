// Test helpers: FFmpeg lavfi fixtures, and a full IngrainedCut stack (helper engine + headless editor + MCP server)
// that runs in temporary folders, so the user's own bridge.json, settings, projects and media are never touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export function ffmpegPath() {
  try {
    const p = require('ffmpeg-static');
    if (p && fs.existsSync(p)) return p;
  } catch {}
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    return null;
  }
}

export function ffmpeg(args) {
  const bin = ffmpegPath();
  if (!bin) throw new Error('FFmpeg not found');
  return execFileSync(bin, ['-hide_banner', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
}

/** ffmpeg ebur128 summary of a file: { I, LRA, TP } (integrated LUFS, loudness range, true peak dBTP) */
export function ebur128(file) {
  const r = spawnSync(ffmpegPath(), ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const err = String(r.stderr ?? '');
  const sum = err.slice(err.lastIndexOf('Summary:'));
  const num = (re) => parseFloat(sum.match(re)?.[1]);
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), LRA: num(/LRA:\s+(-?[\d.]+) LU/), TP: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

/**
 * Fixtures made with lavfi only: two footage clips (test pattern / colour bars, each with a tone), a frozen grey clip,
 * a still, "narration" (1.5 s tone bursts with 1.5 s of silence between), a 120 BPM music bed and a short SFX.
 */
export function makeFixtures(dir) {
  const media = path.join(dir, 'media');
  fs.mkdirSync(path.join(media, 'music'), { recursive: true });
  const v = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest'];
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=12', ...v, path.join(media, 'footage1.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'smptehdbars=size=1280x720:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=12', ...v, path.join(media, 'footage2.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=gray:size=1280x720:rate=30:duration=32', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '32', ...v, path.join(media, 'frozen.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'smptebars=size=1280x1440', '-frames:v', '1', path.join(media, 'photo.png')]);
  // speech stand-in: 1.5 s on, 1.5 s off, for 30 s
  ffmpeg(['-f', 'lavfi', '-i', "aevalsrc='0.35*sin(2*PI*220*t)*lt(mod(t,3),1.5)':s=48000:d=30", '-c:a', 'pcm_s16le', path.join(media, 'narration.wav')]);
  // 120 BPM bed: a chord with a kick on every beat, louder on the downbeat (every 4th beat)
  ffmpeg([
    '-f', 'lavfi', '-i',
    "aevalsrc='0.06*(sin(2*PI*220*t)+sin(2*PI*277.18*t)+sin(2*PI*329.63*t))+0.5*(1+lt(mod(t,2),0.5))*exp(-25*mod(t,0.5))*sin(2*PI*55*t)':s=48000:d=40",
    '-c:a', 'pcm_s16le', path.join(media, 'music', 'bed_loop.wav'),
  ]);
  ffmpeg(['-f', 'lavfi', '-i', "aevalsrc='0.5*sin(2*PI*1200*t)*exp(-8*t)':s=48000:d=0.4", '-c:a', 'pcm_s16le', path.join(media, 'sfx.wav')]);
  fs.mkdirSync(path.join(dir, 'FraggedIn'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'FraggedIn', 'style.md'), '# FraggedIn style\n- Font: Arial Black\n- Accent colour: #ffcc00\n- Text colour: #ffffff\n- Card blur: 16\n- Card darken: 40\n');
  return media;
}

/** A Chromium or Chrome / Edge to run the editor headless in (none: the end-to-end tests are skipped). */
export function findBrowser() {
  if (process.env.ICUT_TEST_BROWSER && fs.existsSync(process.env.ICUT_TEST_BROWSER)) return process.env.ICUT_TEST_BROWSER;
  const la = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  const pw = path.join(la, 'ms-playwright');
  if (fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      for (const sub of ['chrome-win64', 'chrome-win', 'chrome-linux64', 'chrome-linux']) {
        for (const exe of ['chrome.exe', 'chrome']) {
          const p = path.join(pw, d, sub, exe);
          if (fs.existsSync(p)) return p;
        }
      }
    }
  }
  for (const p of [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ])
    if (fs.existsSync(p)) return p;
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Start the helper engine on its own port with a temporary home and app-data folder, open the editor in a headless
 * browser, and connect an MCP client through mcp/server.mjs (which reads the temporary home's bridge.json).
 */
export async function startStack({ port = 5397 + Math.floor(Math.random() * 300), settings = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icut-test-'));
  const home = path.join(tmp, 'home');
  const data = path.join(tmp, 'data');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify(settings));
  const env = { ...process.env, USERPROFILE: home, HOME: home, ICUT_USER_DATA: data };
  delete env.ANTHROPIC_BASE_URL;
  const procs = [];
  const helper = spawn(process.execPath, [path.join(ROOT, 'server', 'web.mjs'), '--port', String(port), '--local', '--no-open'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  procs.push(helper);
  let out = '';
  helper.stdout.on('data', (d) => (out += d));
  helper.stderr.on('data', (d) => (out += d));
  const t0 = Date.now();
  let link = null;
  while (!(link = out.match(/Local editor \(private link\):\s*(\S+)/)?.[1])) {
    if (Date.now() - t0 > 60_000 || helper.exitCode != null) throw new Error(`The helper did not start:\n${out.slice(-2000)}`);
    await sleep(200);
  }
  const browser = findBrowser();
  const chrome = spawn(
    browser,
    ['--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${path.join(tmp, 'browser')}`, link],
    { stdio: 'ignore', windowsHide: true },
  );
  procs.push(chrome);
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.mjs')], env, cwd: ROOT, stderr: 'pipe' });
  const client = new Client({ name: 'icut-tests', version: '1.0.0' });
  await client.connect(transport);
  /** call a tool; returns parsed JSON (or text), throws on isError */
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 15 * 60_000 });
    const t = r.content?.filter((c) => c.type === 'text').map((c) => c.text) ?? [];
    if (r.isError) throw new Error(`${name}: ${t.join('\n')}`);
    try {
      return t.length === 1 ? JSON.parse(t[0]) : t.length ? t : r.content;
    } catch {
      return t.length === 1 ? t[0] : t;
    }
  };
  // wait for the editor tab to connect
  const t1 = Date.now();
  for (;;) {
    try {
      await call('get_project_state', { detail: 'summary' });
      break;
    } catch (e) {
      if (Date.now() - t1 > 90_000) throw new Error(`The editor did not connect: ${e.message}\n${out.slice(-1500)}`);
      await sleep(500);
    }
  }
  const stop = async () => {
    try {
      await client.close();
    } catch {}
    for (const p of procs) {
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
        else p.kill('SIGKILL');
      } catch {}
    }
    await sleep(500);
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
    } catch {}
  };
  return { tmp, home, data, call, client, stop, log: () => out };
}
