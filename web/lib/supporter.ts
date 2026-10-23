// Ads in the website editor, and supporters who removed them. Paying at least AD_FREE_PRICE on Ko-fi (in the Ko-fi
// page's currency, in one or more payments) turns the editor's ads off for good on that account. Ko-fi reports each
// payment to app/api/kofi/route.ts; a payment belongs to the account whose code is in the Ko-fi message, else to the
// account with the payer's email (also matched later, when that account next checks).
import { sql } from 'kysely';
import { getDb } from './db';
import { SITE } from './site';

export const AD_FREE_PRICE = Number(process.env.AD_FREE_PRICE || 2);
export const KOFI_URL = process.env.KOFI_URL || 'https://ko-fi.com/ingrainedcut';

/** The AdSense account (ca-pub-…). */
export const adsenseClient = () => process.env.ADSENSE_CLIENT?.trim() || SITE.adsenseClient || null;

/** What the editor's ad bar shows: the AdSense unit, a placeholder box while testing without AdSense, or nothing. */
export function editorAd() {
  const client = adsenseClient();
  const slot = process.env.ADSENSE_EDITOR_SLOT?.trim();
  if (client && slot) return { client, slot };
  return process.env.VERCEL_ENV === 'production' ? null : { placeholder: true as const };
}

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const CODE_RE = /\bIC-([A-Z2-9]{6})\b/i;

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return 'IC-' + Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

/** The account's code for the Ko-fi message, made on first use. */
export async function supporterCode(userId: string) {
  const db = await getDb();
  for (let i = 0; i < 5; i++) {
    const row = await db.selectFrom('supporter_code').select('code').where('user_id', '=', userId).executeTakeFirst();
    if (row) return row.code;
    // a clash with another account's code (unique) just tries again
    await db.insertInto('supporter_code').values({ user_id: userId, code: randomCode() }).onConflict((oc) => oc.doNothing()).execute();
  }
  throw new Error('Could not create a supporter code');
}

export async function supporterStatus(user: { id: string; email: string }) {
  const db = await getDb();
  // payments made with this account's email before it existed, or without the code
  await db.updateTable('kofi_payment').set({ user_id: user.id }).where('user_id', 'is', null).where('email', '=', user.email.toLowerCase()).execute();
  const { total } = await db
    .selectFrom('kofi_payment')
    .select(sql<string>`coalesce(sum(amount), 0)`.as('total'))
    .where('user_id', '=', user.id)
    .executeTakeFirstOrThrow();
  const paid = Number(total);
  return { adFree: paid >= AD_FREE_PRICE, paid, price: AD_FREE_PRICE, code: await supporterCode(user.id), kofiUrl: KOFI_URL };
}

/** The fields of Ko-fi's webhook payload this uses. */
export interface KofiPayment {
  kofi_transaction_id: string;
  type: string;
  email?: string;
  amount: string;
  currency: string;
  message?: string | null;
  timestamp?: string;
}

/** Store one Ko-fi payment (repeats of the same transaction are ignored) and say which account it went to. */
export async function recordKofiPayment(p: KofiPayment) {
  const db = await getDb();
  const email = (p.email || '').trim().toLowerCase();
  const code = p.message?.match(CODE_RE)?.[1];
  let userId: string | null = null;
  if (code) {
    const row = await db.selectFrom('supporter_code').select('user_id').where('code', '=', `IC-${code.toUpperCase()}`).executeTakeFirst();
    userId = row?.user_id ?? null;
  }
  if (!userId && email) {
    const row = await db.selectFrom('user').select('id').where(sql`lower(email)`, '=', email).executeTakeFirst();
    userId = row?.id ?? null;
  }
  const paidAt = p.timestamp && !Number.isNaN(Date.parse(p.timestamp)) ? new Date(p.timestamp) : new Date();
  await db
    .insertInto('kofi_payment')
    .values({ transaction_id: p.kofi_transaction_id, email, amount: String(Number(p.amount) || 0), currency: p.currency || '', type: p.type, user_id: userId, paid_at: paidAt })
    .onConflict((oc) => oc.column('transaction_id').doNothing())
    .execute();
  return userId;
}
