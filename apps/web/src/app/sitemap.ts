import type { MetadataRoute } from 'next';
import { localePath, locales, type RouteKey } from '@chfree/shared';
import { site } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages: [RouteKey, number, MetadataRoute.Sitemap[number]['changeFrequency']][] = [
    ['home', 1, 'weekly'],
    ['start', 0.9, 'monthly'],
    ['faq', 0.8, 'monthly'],
    ['docs', 0.7, 'monthly'],
    ['status', 0.5, 'daily'],
    ['login', 0.3, 'yearly'],
    ['register', 0.6, 'monthly'],
    ['imprint', 0.2, 'yearly'],
    ['privacy', 0.2, 'yearly'],
    ['terms', 0.2, 'yearly'],
    ['rules', 0.3, 'yearly'],
    ['discordTerms', 0.3, 'yearly'],
    ['donate', 0.4, 'monthly'],
    ['newsletter', 0.3, 'monthly'],
    ['cookies', 0.1, 'yearly'],
    ['extras', 0.5, 'monthly'],
    ['extrasTerms', 0.2, 'yearly'],
    ['cancelSubscription', 0.1, 'yearly'],
  ];
  return pages.flatMap(([key, priority, changeFrequency]) =>
    locales.map((lang) => ({
      url: `${site.url}${localePath(lang, key)}`,
      lastModified: now,
      changeFrequency,
      priority,
      alternates: { languages: Object.fromEntries(locales.map((l) => [l, `${site.url}${localePath(l, key)}`])) },
    })),
  );
}
