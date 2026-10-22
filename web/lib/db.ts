// Database: Postgres via Kysely. Vercel: DATABASE_URL points at Neon (serverless driver).
// Local development: `npm run dev` starts an embedded Postgres (PGlite) on 127.0.0.1:5433 and sets DATABASE_URL.
import { Kysely, PostgresDialect, type Generated } from 'kysely';

export interface ProjectsTable {
  id: string;
  user_id: string;
  name: string;
  data: string; // project JSON (timeline only — media stays on the user's computer)
  duration: number;
  clip_count: number;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DB {
  project: ProjectsTable;
}

const globalForDb = globalThis as unknown as { __icutDb?: Promise<Kysely<DB>> };

async function create(): Promise<Kysely<DB>> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Locally, start the site with `npm run dev` (it runs a local database).');
  const host = new URL(url).hostname;
  const local = host === 'localhost' || host === '127.0.0.1';
  const { Pool } = local ? await import('pg') : await import('@neondatabase/serverless');
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: local ? 5 : undefined }) as any }) });
}

export function getDb() {
  globalForDb.__icutDb ??= create();
  return globalForDb.__icutDb;
}
