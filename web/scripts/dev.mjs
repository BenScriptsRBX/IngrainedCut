// Local development: an embedded Postgres (PGlite, stored in web/.data) served on 127.0.0.1:5433, then `next dev`.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(web, '.data', 'pglite');
fs.mkdirSync(dataDir, { recursive: true });

const db = await PGlite.create(dataDir);
await db.exec(fs.readFileSync(path.join(web, 'db', 'schema.sql'), 'utf8'));
const server = new PGLiteSocketServer({ db, port: 5433, host: '127.0.0.1', maxConnections: 100 });
await server.start();
const DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:5433/postgres?sslmode=disable';
console.log('[dev] local database ready on 127.0.0.1:5433');

const next = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'dev', ...process.argv.slice(2)], {
  cwd: web,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL },
});
const stop = async () => {
  next.kill();
  await server.stop().catch(() => {});
  await db.close().catch(() => {});
  process.exit(0);
};
next.on('exit', stop);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
