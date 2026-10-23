// The editor asks here whether to show its ad bar, and what to put in it.
import { NextResponse } from 'next/server';
import { apiUser, unauthorized } from '@/lib/projects';
import { editorAd, supporterStatus } from '@/lib/supporter';

export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  const s = await supporterStatus(user);
  return NextResponse.json({ adFree: s.adFree, price: s.price, kofiUrl: s.kofiUrl, ad: s.adFree ? null : editorAd() }, { headers: { 'Cache-Control': 'no-store' } });
}
