/**
 * Zweisprachigkeit der Website (Englisch unter „/“, Deutsch unter „/de“).
 * Server Components: getDict(lang). Client Components: useDict() aus ./client.
 */
import { formatDate, formatDateTime, formatDuration, formatMb, freeHostingConfig, isLocale, runtimeConfigVersion, type Locale } from '@chfree/shared';
import { notFound } from 'next/navigation';
import { buildDe, type Dictionary } from './dictionaries/de';
import { buildEn } from './dictionaries/en';

export type { Dictionary };

const builders: Record<Locale, () => Dictionary> = { de: buildDe, en: buildEn };
const cache = new Map<string, Dictionary>();

/**
 * Texte in einer Sprache. Sie enthalten Werte aus dem Admin-Bereich (z. B. „24 h am Stück“, „30 Tage“) –
 * ändern sich diese, werden die Texte neu gebaut (Zwischenspeicher je Sprache und Stand der Einstellungen).
 */
export function getDict(lang: Locale): Dictionary {
  const key = `${lang}:${runtimeConfigVersion()}`;
  let dict = cache.get(key);
  if (!dict) {
    if (cache.size > 6) cache.clear();
    dict = builders[lang]();
    cache.set(key, dict);
  }
  return dict;
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
