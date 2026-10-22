import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['', '/download', '/terms', '/privacy', '/licenses'].map((p) => ({ url: `${SITE.url}${p}`, changeFrequency: 'monthly' as const }));
}
