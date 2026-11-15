/**
 * Zweisprachigkeit der Website (Englisch unter „/“, Deutsch unter „/de“).
 * Server Components: getDict(lang). Client Components: useDict() aus ./client.
 */
import { formatDate, formatDateTime, formatDuration, formatMb, freeHostingConfig, isLocale, type Locale } from '@chfree/shared';
import { notFound } from 'next/navigation';
import { de, type Dictionary } from './dictionaries/de';
import { en } from './dictionaries/en';

export type { Dictionary };
export const dictionaries: Record<Locale, Dictionary> = { de, en };

export function getDict(lang: Locale): Dictionary {
  return dictionaries[lang];
}

/** Liest und prüft den [lang]-Parameter einer Seite (ungültig → 404). */
export async function resolveLang(params: Promise<{ lang: string }>): Promise<Locale> {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return lang;
}

/** Formatierer in der Sprache der Seite (Zeitzone aus der Konfiguration) */
export function formatters(lang: Locale) {
  const tz = freeHostingConfig.fairUse.timezone;
  return {
    date: (d: string | Date) => formatDate(d, tz, lang),
    dateTime: (d: string | Date) => formatDateTime(d, tz, lang),
    duration: (s: number, opts: { short?: boolean; maxUnits?: number } = {}) => formatDuration(s, opts, lang),
    mb: (mb: number) => formatMb(mb, lang),
  };
}
