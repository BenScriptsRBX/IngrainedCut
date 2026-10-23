// Website editor: a banner ad above the status bar, unless the account removed ads by supporting IngrainedCut on
// Ko-fi. The site decides (/api/supporter); the desktop app and the helper's local editor never show ads.
import React, { useEffect, useState } from 'react';
import { isSite } from '../webBridge';
import { toast } from '../store';

type Ad = { client: string; slot: string } | { placeholder: true };
interface Supporter {
  adFree: boolean;
  price: number;
  kofiUrl: string;
  ad: Ad | null;
}

async function fetchSupporter(): Promise<Supporter | null> {
  try {
    const r = await fetch('/api/supporter', { credentials: 'same-origin' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

function loadAdSense(client: string) {
  if (document.querySelector('script[data-icut-adsense]')) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  s.crossOrigin = 'anonymous';
  s.dataset.icutAdsense = '1';
  document.head.appendChild(s);
}

function AdSenseUnit({ client, slot }: { client: string; slot: string }) {
  useEffect(() => {
    loadAdSense(client);
    try {
      ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({});
    } catch {}
  }, [client, slot]);
  return <ins className="adsbygoogle ad-unit" style={{ display: 'inline-block', width: 728, height: 90 }} data-ad-client={client} data-ad-slot={slot} />;
}

export function AdBar() {
  const [s, setS] = useState<Supporter | null>(null);
  useEffect(() => {
    if (!isSite) return;
    fetchSupporter().then(setS);
    // paid on Ko-fi in another tab: drop the ads when the user comes back
    const onFocus = () =>
      fetchSupporter().then((n) => {
        if (!n) return;
        setS((old) => {
          if (old && !old.adFree && n.adFree) toast('Thank you for supporting IngrainedCut — ads are off.', 'info', 6000);
          return n;
        });
      });
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  if (!s?.ad) return null;
  return (
    <div className="ad-bar">
      <span className="ad-label">Advertisement</span>
      <div className="ad-slot">{'placeholder' in s.ad ? <div className="ad-unit ad-placeholder">Ad space · 728 × 90 (AdSense isn’t set up yet)</div> : <AdSenseUnit client={s.ad.client} slot={s.ad.slot} />}</div>
      <a className="ad-remove" href="/account#ad-free" target="_blank" rel="noopener">
        Remove ads — ${s.price} on Ko-fi
      </a>
    </div>
  );
}
