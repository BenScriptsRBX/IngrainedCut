// The helper trades the one-time code from /editor/local for its API token (server to server, so no CORS).
import { NextResponse } from 'next/server';
import { exchangeHelperCode } from '@/lib/helperLink';

export async function POST(req: Request) {
  const { code } = await req.json().catch(() => ({}));
  const token = typeof code === 'string' && code.startsWith('icutc_') ? await exchangeHelperCode(code) : null;
  if (!token) return NextResponse.json({ error: 'This link has expired. Open the project again from the website.' }, { status: 400 });
  return NextResponse.json({ token }, { headers: { 'Cache-Control': 'no-store' } });
}
