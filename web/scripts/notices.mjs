// Third-party notices for everything IngrainedCut ships, generated from the installed dependency trees:
//  - THIRD_PARTY_NOTICES.md in the repo root (goes into the helper package): the editor bundle + the helper's runtime
//  - web/public/third-party-licenses.txt (served by the site): the editor bundle + the website
//  - web/lib/licenses.json: the list shown on the site's /licenses page
// Each entry carries the package's own LICENSE / NOTICE text (MIT, Apache-2.0 and MPL-2.0 all ask for this).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(web, '..');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** Node-style lookup: <dir>/node_modules/<name>, then each parent directory. */
function resolvePkg(fromDir, name) {
  for (let d = fromDir; ; d = path.dirname(d)) {
    const p = path.join(d, 'node_modules', ...name.split('/'));
    if (fs.existsSync(path.join(p, 'package.json'))) return p;
    if (path.dirname(d) === d) return null;
  }
}

function repoUrl(pkg) {
  let u = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (u) {
    u = u.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '').replace(/^ssh:\/\/git@/, 'https://');
    if (/^github:/.test(u)) u = 'https://github.com/' + u.slice(7);
    if (/^[\w-]+\/[\w.-]+$/.test(u)) u = 'https://github.com/' + u;
    if (u.startsWith('http')) return u;
  }
  return pkg.homepage || `https://www.npmjs.com/package/${pkg.name}`;
}

const licenseOf = (pkg) => (typeof pkg.license === 'string' ? pkg.license : pkg.license?.type) || pkg.licenses?.map((l) => l.type || l).join(' OR ') || 'UNKNOWN';

/** Every package reachable through dependencies / optionalDependencies from the given root packages. */
function collect(baseDir, names) {
  const out = new Map();
  const queue = names.map((n) => [baseDir, n]);
  while (queue.length) {
    const [from, name] = queue.shift();
    const dir = resolvePkg(from, name);
    if (!dir) continue; // optional platform package not installed here
    const pkg = readJson(path.join(dir, 'package.json'));
    const key = `${pkg.name}@${pkg.version}`;
    if (out.has(key)) continue;
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^(licen[cs]e|copying|notice)([.-][\w.-]+)?$/i.test(f) && fs.statSync(path.join(dir, f)).isFile())
      .sort((a, b) => (/notice/i.test(a) ? 1 : 0) - (/notice/i.test(b) ? 1 : 0));
    out.set(key, {
      name: pkg.name,
      version: pkg.version,
      license: licenseOf(pkg),
      url: repoUrl(pkg),
      texts: files.map((f) => ({ file: f, text: fs.readFileSync(path.join(dir, f), 'utf8').trim() })),
    });
    for (const dep of Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) })) queue.push([dir, dep]);
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const rootPkg = readJson(path.join(root, 'package.json'));
const webPkg = readJson(path.join(web, 'package.json'));
const EDITOR = ['react', 'react-dom', 'zustand', 'html-to-image', 'mediabunny'];

const groups = {
  editor: { title: 'The editor (runs in your browser and in the desktop app)', items: collect(root, EDITOR) },
  helper: {
    title: 'The IngrainedCut helper (installed by npm on your computer)',
    items: collect(root, [...Object.keys(rootPkg.dependencies ?? {}), ...Object.keys(rootPkg.optionalDependencies ?? {})]),
  },
  website: { title: 'The website (runs on our servers)', items: collect(web, Object.keys(webPkg.dependencies ?? {})) },
};

const NOTE = {
  'ffmpeg-static': 'Downloads an FFmpeg build at install time. FFmpeg is a separate program (GPL), run as its own process; its source is at https://ffmpeg.org/download.html.',
  '@ffprobe-installer/ffprobe': 'Installs an FFprobe build (part of FFmpeg, GPL/LGPL), run as its own process; source at https://ffmpeg.org/download.html.',
  mediabunny: 'Mozilla Public License 2.0: the unmodified source of this library is available at the URL above.',
  '@anthropic-ai/claude-agent-sdk': "Used under Anthropic's Commercial Terms of Service (https://www.anthropic.com/legal/commercial-terms).",
};

function render(title, keys) {
  const seen = new Set();
  const lines = [
    `# ${title}`,
    '',
    'IngrainedCut is built with the open-source software below. Each entry lists the package, its license and where its source',
    'code is published, followed by the license and notice texts it ships with.',
    '',
  ];
  for (const k of keys) {
    lines.push(`## ${groups[k].title}`, '');
    for (const it of groups[k].items) lines.push(`- ${it.name} ${it.version} — ${it.license} — ${it.url}${NOTE[it.name] ? ` (${NOTE[it.name]})` : ''}`);
    lines.push('');
  }
  lines.push('---', '', '# License and notice texts', '');
  for (const k of keys)
    for (const it of groups[k].items) {
      const key = `${it.name}@${it.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`## ${it.name} ${it.version} (${it.license})`, '');
      if (!it.texts.length) lines.push(`No license file is included in the published package; see ${it.url}.`, '');
      for (const t of it.texts) lines.push(`${t.file}:`, '', '```', t.text, '```', '');
    }
  return lines.join('\n') + '\n';
}

fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), render('IngrainedCut third-party notices', ['editor', 'helper']));
fs.mkdirSync(path.join(web, 'public'), { recursive: true });
fs.writeFileSync(path.join(web, 'public', 'third-party-licenses.txt'), render('IngrainedCut third-party notices', ['editor', 'website']));
fs.writeFileSync(
  path.join(web, 'lib', 'licenses.json'),
  JSON.stringify(
    Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, { title: g.title, items: g.items.map(({ texts, ...rest }) => ({ ...rest, note: NOTE[rest.name] })) }])),
    null,
    1,
  ) + '\n',
);
const n = (k) => groups[k].items.length;
console.log(`[notices] editor ${n('editor')}, helper ${n('helper')}, website ${n('website')} packages`);
