import type { MetadataRoute } from 'next';
import { localePath, locales } from '@chfree/shared';
import { site } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  const privatePaths = locales.flatMap((l) => [localePath(l, 'myServers'), localePath(l, 'verify')]);
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: [...privatePaths, '/api/'] }],
    sitemap: `${site.url}/sitemap.xml`,
    host: site.url,
  };
}
