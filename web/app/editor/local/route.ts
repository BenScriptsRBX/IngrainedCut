// "Open through the helper" (lib/helperLink.ts): hands the signed-in user to the helper on this computer with a one-time
// code. A plain navigation to localhost works even where the browser blocks this site's requests to it.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { createHelperCode } from '@/lib/helperLink';
import { SITE } from '@/lib/site';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const project = url.searchParams.get('project') ?? '';
  const port = Number(url.searchParams.get('port')) || SITE.helperPort;
  const s = await getSession();
  if (!s) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, SITE.url));
  const code = await createHelperCode(s.user.id);
  const to = new URL(`http://localhost:${port}/cloud/open`);
  to.searchParams.set('code', code);
  to.searchParams.set('project', project);
  to.searchParams.set('site', SITE.url);
  return NextResponse.redirect(to, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
