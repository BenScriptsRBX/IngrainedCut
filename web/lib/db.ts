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

export interface SupporterCodeTable {
  user_id: string;
  code: string;
  created_at: Generated<Date>;
}

export interface KofiPaymentTable {
  transaction_id: string;
  email: string; // lower-cased
  amount: string; // numeric: Postgres returns it as a string
  currency: string;
  type: string; // Donation, Subscription, Shop Order, Commission
  user_id: string | null;
  paid_at: Date;
  received_at: Generated<Date>;
}

/** Better Auth's table; only the columns this app reads. */
export interface UserTable {
  id: string;
  email: string;
  name: string;
}

export interface HelperCodeTable {
  code_hash: string;
  user_id: string;
  expires_at: Date;
}

export interface HelperTokenTable {
  token_hash: string;
  user_id: string;
  created_at: Generated<Date>;
  last_used_at: Generated<Date>;
}

export interface DB {
  user: UserTable;
  helper_code: HelperCodeTable;
  helper_token: HelperTokenTable;
  project: ProjectsTable;
  supporter_code: SupporterCodeTable;
  kofi_payment: KofiPaymentTable;
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
