import type { MetadataRoute } from 'next';
import { localePath, locales } from '@chfree/shared';
import { site } from '@/lib/site';
import { getSite } from '@/lib/site-settings';

/** Crawler von KI-Assistenten – ausdrücklich zugelassen, damit sie das Angebot korrekt beschreiben können (siehe /llms.txt) */
const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot'];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const settings = await getSite();
  // Im Admin-Bereich abschaltbar (Einstellungen → Suchmaschinen & KI)
  if (!settings.seo.indexing) return { rules: [{ userAgent: '*', disallow: '/' }] };
  const privatePaths = [...locales.flatMap((l) => [localePath(l, 'myServers'), localePath(l, 'verify')]), '/api/'];
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: privatePaths },
      { userAgent: AI_CRAWLERS, allow: ['/', '/llms.txt'], disallow: privatePaths },
    ],
    sitemap: `${site.url}/sitemap.xml`,
    host: site.url,
  };
}
