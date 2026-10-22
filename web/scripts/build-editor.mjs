// Builds the editor (the repo's Vite app in ../src) into web/public/editor, served by the website at /editor.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(web, '..');
// use the repo's own Vite (installed by `npm ci` in the repo root)
const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
await build({
  root,
  configFile: path.join(root, 'vite.config.ts'),
  base: '/editor/',
  logLevel: 'warn',
  build: { outDir: path.join(web, 'public', 'editor'), emptyOutDir: true },
});
console.log('[build-editor] editor built into web/public/editor');
