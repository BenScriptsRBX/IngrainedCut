import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { SITE } from '@/lib/site';
import { adsenseClient } from '@/lib/supporter';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} — ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  openGraph: { title: `${SITE.name} — ${SITE.tagline}`, description: SITE.description, siteName: SITE.name, type: 'website' },
  twitter: { card: 'summary_large_image', title: SITE.name, description: SITE.description },
  icons: { icon: '/icon.svg' },
  // lets AdSense verify the site is ours (the ads themselves only run in the editor)
  ...(adsenseClient() ? { other: { 'google-adsense-account': adsenseClient()! } } : {}),
};

export const viewport: Viewport = { themeColor: '#09090b' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // No ad code on the website's pages: the editor loads AdSense itself, only when it shows an ad (src/components/AdBar.tsx).
  // The meta tag above and /ads.txt are what AdSense needs to verify the site.
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
