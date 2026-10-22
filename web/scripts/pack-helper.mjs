// Packs the IngrainedCut helper (the repo's root package) into web/public/helper/ingrainedcut-<version>.tgz, so anyone
// can run it with `npx -y <site>/helper/ingrainedcut-<version>.tgz` without it being published to npm. The version is
// in the file name because npx caches what it installed per URL.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(web, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// the helper also serves the editor itself in `--local` mode, from dist/
const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
await build({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'warn' });

const out = path.join(web, 'public', 'helper');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
execSync(`npm pack --pack-destination "${out}" --ignore-scripts --silent`, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
const file = `ingrainedcut-${version}.tgz`;
if (!fs.existsSync(path.join(out, file))) throw new Error(`npm pack did not produce ${file}`);
fs.writeFileSync(path.join(web, 'lib', 'helper.json'), JSON.stringify({ version, file: `/helper/${file}` }, null, 2) + '\n');
console.log(`[pack-helper] ${file} (${(fs.statSync(path.join(out, file)).size / 1024).toFixed(0)} KB) in web/public/helper`);
