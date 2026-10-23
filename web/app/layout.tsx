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
  const adsense = adsenseClient();
  return (
    <html lang="en" className={inter.variable}>
      {/* AdSense's own tag (a plain script: AdSense rejects next/script's data-nscript attribute). Ads only run where the
          editor places a unit, as long as Auto ads stay off in AdSense. */}
      {adsense && (
        <head>
          <script async src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsense}`} crossOrigin="anonymous" />
        </head>
      )}
      <body>{children}</body>
    </html>
  );
}
