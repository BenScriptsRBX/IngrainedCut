// Applies db/schema.sql to DATABASE_URL (idempotent). Runs during `npm run build` on Vercel.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.DATABASE_URL;
if (!url) {
  console.log('[migrate] DATABASE_URL not set — skipping (local dev creates its own database).');
  process.exit(0);
}
const host = new URL(url).hostname;
const { Pool } = host === 'localhost' || host === '127.0.0.1' ? await import('pg') : await import('@neondatabase/serverless');
const pool = new Pool({ connectionString: url });
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'schema.sql');
const statements = fs.readFileSync(file, 'utf8').split(/;\s*\n/).map((s) => s.trim()).filter((s) => s && !/^--[^\n]*$/.test(s));
for (const s of statements) await pool.query(s);
await pool.end();
console.log(`[migrate] applied ${statements.length} statements`);
