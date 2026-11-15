import type { Metadata } from 'next';
import { localePath, type Locale, type RouteKey } from '@chfree/shared';
import { getDict } from '@/i18n';
import { site } from './site';

/** Kanonische URL + Sprachvarianten (hreflang) einer Seite */
export function alternates(lang: Locale, key: RouteKey): Metadata['alternates'] {
  return {
    canonical: `${site.url}${localePath(lang, key)}`,
    languages: {
      de: `${site.url}${localePath('de', key)}`,
      en: `${site.url}${localePath('en', key)}`,
      'x-default': `${site.url}${localePath('en', key)}`,
    },
  };
}

export function pageMetadata(lang: Locale, key: RouteKey, input: { title: string; description?: string; noIndex?: boolean }): Metadata {
  const t = getDict(lang).meta;
  const description = input.description ?? t.description;
  const url = `${site.url}${localePath(lang, key)}`;
  // Seiten mit eigenem openGraph erben das Vorschaubild sonst nicht → explizit setzen
  const images = [{ url: `${site.url}/${lang}/opengraph-image`, width: 1200, height: 630, alt: t.ogImageAlt }];
  return {
    title: input.title,
    description,
    alternates: alternates(lang, key),
    openGraph: { title: `${input.title} | ${site.name}`, description, url, siteName: site.name, locale: t.ogLocale, type: 'website', images },
    twitter: { card: 'summary_large_image', title: `${input.title} | ${site.name}`, description, images },
    robots: input.noIndex ? { index: false, follow: false } : undefined,
  };
}
