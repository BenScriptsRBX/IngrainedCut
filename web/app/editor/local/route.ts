// Old "open through the helper" links: the editor now always stays on the website (the helper is reached from the
// page itself), so these go back to the editor here.
import { NextResponse } from 'next/server';
import { SITE } from '@/lib/site';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const project = url.searchParams.get('project') ?? '';
  return NextResponse.redirect(new URL(`/editor${project ? `?project=${encodeURIComponent(project)}` : ''}`, SITE.url));
}
