// ads.txt: names Google as the one seller of this site's ad space (AdSense asks for it once ADSENSE_CLIENT is set).
import { adsenseClient } from '@/lib/supporter';

export function GET() {
  const client = adsenseClient();
  if (!client) return new Response('Not found', { status: 404 });
  return new Response(`google.com, ${client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
