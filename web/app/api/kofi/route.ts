// Ko-fi webhook (Ko-fi → Settings → API → Webhook URL: <site>/api/kofi). Ko-fi posts a form with one field, `data`,
// holding the payment as JSON, signed with the verification token shown on that settings page.
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { recordKofiPayment, type KofiPayment } from '@/lib/supporter';

const PAYMENT_TYPES = new Set(['Donation', 'Subscription', 'Shop Order', 'Commission']);

function tokenOk(given: unknown) {
  const want = process.env.KOFI_VERIFICATION_TOKEN;
  if (!want || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!process.env.KOFI_VERIFICATION_TOKEN) return NextResponse.json({ error: 'Ko-fi is not set up on this server' }, { status: 503 });
  let p: (KofiPayment & { verification_token?: string }) | null = null;
  try {
    const form = await req.formData();
    p = JSON.parse(String(form.get('data') ?? ''));
  } catch {}
  if (!p) return NextResponse.json({ error: 'Expected a Ko-fi webhook' }, { status: 400 });
  if (!tokenOk(p.verification_token)) return NextResponse.json({ error: 'Bad verification token' }, { status: 401 });
  // anything else (or a payment without an id) is acknowledged so Ko-fi doesn't keep retrying it
  if (PAYMENT_TYPES.has(p.type) && p.kofi_transaction_id) await recordKofiPayment(p);
  return NextResponse.json({ ok: true });
}
