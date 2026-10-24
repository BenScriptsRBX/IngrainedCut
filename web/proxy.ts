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

// /editor/assets and /editor/index.html stay public: they are the open-source editor app, and the helper loads them to
// serve the editor from the user's computer ("Open through the helper"); the editor's data still needs sign-in (/api)
export const config = { matcher: ['/projects/:path*', '/editor', '/editor/local', '/account'] };
