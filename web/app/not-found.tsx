import Link from 'next/link';
import { SiteHeader } from '@/components/SiteChrome';

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="center-page">
        <div style={{ textAlign: 'center' }}>
          <p className="eyebrow">404</p>
          <h1 style={{ fontSize: 40, letterSpacing: '-0.03em', margin: '16px 0 8px' }}>This page ended up on the cutting-room floor.</h1>
          <p className="muted">The page you were looking for doesn&rsquo;t exist.</p>
          <Link href="/" className="btn primary" style={{ marginTop: 18 }}>
            Back home
          </Link>
        </div>
      </main>
    </>
  );
}
