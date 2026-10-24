// "Open through the helper": some browsers won't let this website reach the helper on 127.0.0.1 (Chrome's local network
// access permission), but they do allow a normal navigation there. So /editor/local sends the signed-in user to the
// helper with a one-time code; the helper trades it (server to server) for a token, serves the editor from the user's
// own computer, and calls this site's API with that token on the editor's behalf.
import crypto from 'node:crypto';
import { getDb } from './db';

const CODE_TTL_MS = 2 * 60 * 1000;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const random = (prefix: string) => prefix + crypto.randomBytes(32).toString('base64url');

/** A one-time code for this user, good for two minutes. */
export async function createHelperCode(userId: string) {
  const db = await getDb();
  const code = random('icutc_');
  await db.deleteFrom('helper_code').where('expires_at', '<', new Date()).execute();
  await db.insertInto('helper_code').values({ code_hash: hash(code), user_id: userId, expires_at: new Date(Date.now() + CODE_TTL_MS) }).execute();
  return code;
}

/** Trade a code (once) for a token and the account's email (the helper asks before switching accounts); null if unknown or expired. */
export async function exchangeHelperCode(code: string) {
  const db = await getDb();
  const row = await db.deleteFrom('helper_code').where('code_hash', '=', hash(code)).returning(['user_id', 'expires_at']).executeTakeFirst();
  if (!row || row.expires_at.getTime() < Date.now()) return null;
  const user = await db.selectFrom('user').select('email').where('id', '=', row.user_id).executeTakeFirst();
  const token = random('icut_');
  await db.insertInto('helper_token').values({ token_hash: hash(token), user_id: row.user_id }).execute();
  return { token, email: user?.email ?? '' };
}

/** The user a helper token belongs to (tokens unused for 30 days expire). */
export async function helperTokenUser(token: string) {
  const db = await getDb();
  const h = hash(token);
  const row = await db
    .selectFrom('helper_token')
    .innerJoin('user', 'user.id', 'helper_token.user_id')
    .select(['user.id as id', 'user.email as email', 'user.name as name', 'helper_token.last_used_at as last_used_at'])
    .where('helper_token.token_hash', '=', h)
    .executeTakeFirst();
  if (!row) return null;
  if (Date.now() - new Date(row.last_used_at).getTime() > TOKEN_TTL_MS) {
    await db.deleteFrom('helper_token').where('token_hash', '=', h).execute();
    return null;
  }
  await db.updateTable('helper_token').set({ last_used_at: new Date() }).where('token_hash', '=', h).execute();
  return { id: row.id, email: row.email, name: row.name };
}
