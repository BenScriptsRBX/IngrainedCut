import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

// Fast redirect for signed-out visitors. Pages and APIs still validate the session on the server.
export async function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const next = request.nextUrl.pathname + request.nextUrl.search;
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/projects/:path*', '/editor/:path*', '/editor', '/account'] };
