// Native open/save dialogs for the web version. The server runs on the same computer as the browser,
// so it can show the OS dialogs itself and hand back real file paths (no uploads, no copies).
import { spawn } from 'node:child_process';
import path from 'node:path';

function capture(cmd, args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: false });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve(''));
    p.on('close', () => resolve(out));
  });
}

const lines = (s) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

/** filters: [{name, extensions}] → Windows filter string */
function winFilter(filters = []) {
  const f = filters.map((x) => `${x.name}|${x.extensions.map((e) => (e === '*' ? '*.*' : `*.${e}`)).join(';')}`);
  return f.length ? f.join('|') : 'All files|*.*';
}

// A tiny invisible top-most form owns the dialog so it appears above the browser window.
const PS_PRELUDE = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0; StartPosition = 'CenterScreen'; Width = 1; Height = 1 }
$owner.Show(); $owner.Activate()
`;

async function winOpen({ title, multi, filters }) {
  const script = `${PS_PRELUDE}
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Title = $env:ICUT_TITLE; $d.Filter = $env:ICUT_FILTER; $d.Multiselect = ($env:ICUT_MULTI -eq '1')
if ($d.ShowDialog($owner) -eq 'OK') { $d.FileNames | ForEach-Object { [Console]::Out.WriteLine($_) } }
$owner.Close()`;
  return lines(await capture('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { ICUT_TITLE: title || 'Open', ICUT_FILTER: winFilter(filters), ICUT_MULTI: multi ? '1' : '0' }));
}

async function winSave({ title, defaultPath, filters }) {
  const script = `${PS_PRELUDE}
$d = New-Object System.Windows.Forms.SaveFileDialog
$d.Title = $env:ICUT_TITLE; $d.Filter = $env:ICUT_FILTER; $d.OverwritePrompt = $true
if ($env:ICUT_DIR) { $d.InitialDirectory = $env:ICUT_DIR }
if ($env:ICUT_NAME) { $d.FileName = $env:ICUT_NAME }
if ($d.ShowDialog($owner) -eq 'OK') { [Console]::Out.WriteLine($d.FileName) }
$owner.Close()`;
  const dir = defaultPath && path.isAbsolute(defaultPath) ? path.dirname(defaultPath) : '';
  const name = defaultPath ? path.basename(defaultPath) : '';
  return lines(await capture('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { ICUT_TITLE: title || 'Save', ICUT_FILTER: winFilter(filters), ICUT_DIR: dir, ICUT_NAME: name }))[0] ?? null;
}

async function macOpen({ title, multi }) {
  const s = `set fs to choose file with prompt ${JSON.stringify(title || 'Open')}${multi ? ' with multiple selections allowed' : ''}
set out to ""
if class of fs is list then
  repeat with f in fs
    set out to out & POSIX path of f & linefeed
  end repeat
else
  set out to POSIX path of fs
end if
return out`;
  return lines(await capture('osascript', ['-e', s]));
}

async function macSave({ title, defaultPath }) {
  const name = defaultPath ? path.basename(defaultPath) : 'Untitled';
  return lines(await capture('osascript', ['-e', `POSIX path of (choose file name with prompt ${JSON.stringify(title || 'Save')} default name ${JSON.stringify(name)})`]))[0] ?? null;
}

async function zenityOpen({ title, multi }) {
  return lines((await capture('zenity', ['--file-selection', `--title=${title || 'Open'}`, ...(multi ? ['--multiple', '--separator=\n'] : [])])) || '');
}

async function zenitySave({ title, defaultPath }) {
  return lines(await capture('zenity', ['--file-selection', '--save', '--confirm-overwrite', `--title=${title || 'Save'}`, ...(defaultPath ? [`--filename=${defaultPath}`] : [])]))[0] ?? null;
}

export async function openFiles(o) {
  if (process.platform === 'win32') return winOpen(o);
  if (process.platform === 'darwin') return macOpen(o);
  return zenityOpen(o);
}

export async function saveFile(o) {
  if (process.platform === 'win32') return winSave(o);
  if (process.platform === 'darwin') return macSave(o);
  return zenitySave(o);
}

export function revealInFolder(p) {
  if (process.platform === 'win32') spawn('explorer.exe', [`/select,${p}`], { detached: true }).unref();
  else if (process.platform === 'darwin') spawn('open', ['-R', p], { detached: true }).unref();
  else spawn('xdg-open', [path.dirname(p)], { detached: true }).unref();
}

export function openUrl(url) {
  if (!/^https?:\/\//.test(url)) return;
  if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '""', url.replace(/&/g, '^&')], { detached: true, windowsHide: true }).unref();
  else if (process.platform === 'darwin') spawn('open', [url], { detached: true }).unref();
  else spawn('xdg-open', [url], { detached: true }).unref();
}
