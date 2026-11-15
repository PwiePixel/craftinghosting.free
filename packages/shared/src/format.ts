/** Formatierungs-Helfer (Deutsch / Englisch). Letzter Parameter ist immer die Sprache (Standard: Deutsch). */
import { intlLocale, type Locale } from './i18n';

const DEFAULT_TZ = 'Europe/Berlin';

export function formatDuration(totalSeconds: number, opts: { short?: boolean; maxUnits?: number } = {}, locale: Locale = 'de'): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const words: Record<Locale, [string, string][]> = {
    de: [
      ['Tag', 'Tage'],
      ['Stunde', 'Stunden'],
      ['Minute', 'Minuten'],
    ],
    en: [
      ['day', 'days'],
      ['hour', 'hours'],
      ['minute', 'minutes'],
    ],
  };
  const short: [string, string][] = [
    ['d', 'd'],
    ['h', 'h'],
    ['min', 'min'],
  ];
  const labels = opts.short ? short : words[locale];
  const values = [days, hours, minutes];
  const parts = values
    .map((v, i) => [v, labels[i]![0], labels[i]![1]] as const)
    .filter(([v]) => v > 0)
    .slice(0, opts.maxUnits ?? 2)
    .map(([v, one, many]) => (opts.short ? `${v} ${one}` : `${v} ${v === 1 ? one : many}`));
  if (parts.length === 0) return opts.short ? '0 min' : locale === 'en' ? 'less than a minute' : 'weniger als 1 Minute';
  return parts.join(' ');
}

export function formatBytes(bytes: number, decimals = 1, locale: Locale = 'de'): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value.toLocaleString(intlLocale(locale), { maximumFractionDigits: i >= 3 ? decimals : 0 })} ${units[i]}`;
}

export function formatMb(mb: number, locale: Locale = 'de'): string {
  if (mb >= 1024) return `${(mb / 1024).toLocaleString(intlLocale(locale), { maximumFractionDigits: 1 })} GB`;
  return `${mb} MB`;
}

const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DE_WEEKDAYS = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Datumsbestandteile in einer Zeitzone. Bewusst selbst zusammengesetzt statt Intl-Komplettformat:
 * Node und Browser haben unterschiedliche ICU-Versionen („Wed 30 Sept“ vs. „Wed, 30 Sept“) –
 * das würde bei serverseitig gerenderten Client-Komponenten zu Hydration-Fehlern führen.
 */
function zonedParts(d: Date, timeZone: string) {
  const get = (type: string, parts: Intl.DateTimeFormatPart[]) => parts.find((p) => p.type === type)?.value ?? '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(d);
  const year = Number(get('year', parts));
  const month = Number(get('month', parts));
  const day = Number(get('day', parts));
  const hour = Number(get('hour', parts)) % 24;
  const minute = Number(get('minute', parts));
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const tzName = get('timeZoneName', new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' }).formatToParts(d));
  return { year, month, day, hour, minute, weekday, tzName };
}

/** „Mi., 30.10., 14:00“ bzw. „Wed 30 Oct, 14:00 CET“ */
export function formatDateTime(iso: string | Date, timeZone = DEFAULT_TZ, locale: Locale = 'de'): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const p = zonedParts(d, timeZone);
  const time = `${pad(p.hour)}:${pad(p.minute)}`;
  if (locale === 'en') return `${EN_WEEKDAYS[p.weekday]} ${p.day} ${EN_MONTHS[p.month - 1]}, ${time}${p.tzName ? ` ${p.tzName}` : ''}`;
  return `${DE_WEEKDAYS[p.weekday]}, ${pad(p.day)}.${pad(p.month)}., ${time}`;
}

/** „16:20“ bzw. „16:20 CEST“ */
export function formatTime(iso: string | Date, timeZone = DEFAULT_TZ, locale: Locale = 'de'): string {
  const p = zonedParts(typeof iso === 'string' ? new Date(iso) : iso, timeZone);
  const time = `${pad(p.hour)}:${pad(p.minute)}`;
  return locale === 'en' && p.tzName ? `${time} ${p.tzName}` : time;
}

/** „30.10.2026“ bzw. „30 Oct 2026“ */
export function formatDate(iso: string | Date, timeZone = DEFAULT_TZ, locale: Locale = 'de'): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const p = zonedParts(d, timeZone);
  if (locale === 'en') return `${p.day} ${EN_MONTHS[p.month - 1]} ${p.year}`;
  return `${pad(p.day)}.${pad(p.month)}.${p.year}`;
}

/** „1 Ruhetag“ / „1 rest day“ – leer, wenn keine Ruhezeit konfiguriert ist. */
export function restPeriodText(minutes: number, locale: Locale = 'de'): string {
  if (minutes <= 0) return '';
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    if (locale === 'en') return d === 1 ? '1 rest day' : `${d} rest days`;
    return d === 1 ? '1 Ruhetag' : `${d} Ruhetage`;
  }
  const amount = minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
  return locale === 'en' ? `${amount} rest period` : `${amount} Ruhezeit`;
}

/** „nach einem Ruhetag“ / „after a rest day“ – leer ohne Ruhezeit. */
export function restPeriodAfterText(minutes: number, locale: Locale = 'de'): string {
  if (minutes <= 0) return '';
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    if (locale === 'en') return d === 1 ? 'after a rest day' : `after ${d} rest days`;
    return d === 1 ? 'nach einem Ruhetag' : `nach ${d} Ruhetagen`;
  }
  return locale === 'en' ? `after a ${restPeriodText(minutes, 'en')}` : `nach ${restPeriodText(minutes, 'de')}`;
}

/** Erster Buchstabe groß („nach …“ → „Nach …“) */
export function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Zeitpunkt, ab dem ein suspendierter Server wieder reaktiviert werden kann. */
export function reactivatableAt(suspendedAt: Date | string, cooldownMinutes: number): Date {
  const t = typeof suspendedAt === 'string' ? new Date(suspendedAt) : suspendedAt;
  return new Date(t.getTime() + Math.max(0, cooldownMinutes) * 60_000);
}

/** Zeitpunkt der automatischen Löschung eines abgelaufenen Servers (null = nie) */
export function deleteAt(suspendedAt: Date | string, cooldownMinutes: number, deleteAfterRestHours: number): Date | null {
  if (deleteAfterRestHours <= 0) return null;
  return new Date(reactivatableAt(suspendedAt, cooldownMinutes).getTime() + deleteAfterRestHours * 3_600_000);
}
