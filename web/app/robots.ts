import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/projects', '/editor', '/api', '/login'] }], sitemap: `${SITE.url}/sitemap.xml` };
}
