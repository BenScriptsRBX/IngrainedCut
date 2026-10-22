import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteChrome';
import { LoginButtons } from './LoginButtons';
import { DEV_LOGIN, googleConfigured, accountsReady } from '@/lib/auth-config';
import { SITE } from '@/lib/site';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

function safeNext(n?: string) {
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/projects';
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  // (lib/session needs the database, so it is only loaded once accounts are set up)
  if (accountsReady && (await (await import('@/lib/session')).getSession())) redirect(next);
  return (
    <>
      <SiteHeader />
      <main className="center-page">
        <div className="auth-card">
          <span className="logo-mark" style={{ width: 44, height: 44, fontSize: 17, margin: '0 auto' }}>
            Ic
          </span>
          <h1>Sign in to {SITE.name}</h1>
          <p className="muted" style={{ margin: 0 }}>
            Your projects, on any computer.
          </p>
          {sp.error && <div className="notice">Sign-in didn&rsquo;t complete ({sp.error}). Please try again.</div>}
          <LoginButtons next={next} google={googleConfigured && accountsReady} dev={DEV_LOGIN && accountsReady} />
          {!accountsReady ? (
            <div className="notice">Accounts aren&rsquo;t open yet — sign-in is coming soon. You can still download the helper and try the editor locally.</div>
          ) : !googleConfigured && (
            <div className="notice">
              Google sign-in isn&rsquo;t configured on this server yet: set <code className="inline">GOOGLE_CLIENT_ID</code> and{' '}
              <code className="inline">GOOGLE_CLIENT_SECRET</code>.
            </div>
          )}
          <p className="legal">
            By continuing you agree to the <Link href="/terms">Terms of Service</Link> and acknowledge the <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </div>
      </main>
    </>
  );
}
