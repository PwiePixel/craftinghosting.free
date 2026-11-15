/**
 * Zeitzonen-Helfer ohne externe Abhängigkeiten (Intl-basiert).
 * Alle Berechnungen arbeiten mit echten Zeitpunkten (UTC) und leiten
 * Wochengrenzen aus der lokalen Wanduhrzeit der konfigurierten Zeitzone ab –
 * damit sind Sommer-/Winterzeit-Wechsel korrekt abgedeckt.
 */

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sonntag
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function getWallTime(date: Date, timeZone: string): WallTime {
  const parts = getFormatter(timeZone).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS[get('weekday')] ?? 0,
  };
}

/** Offset der Zeitzone zum Zeitpunkt `date` in Millisekunden (lokal − UTC). */
export function getTimeZoneOffset(date: Date, timeZone: string): number {
  const w = getWallTime(date, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Wandelt eine lokale Wanduhrzeit in der Zeitzone in einen echten Zeitpunkt um. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let result = guess - getTimeZoneOffset(new Date(guess), timeZone);
  // Zweiter Durchlauf korrigiert Fälle rund um DST-Umstellungen.
  const offset2 = getTimeZoneOffset(new Date(result), timeZone);
  result = guess - offset2;
  return new Date(result);
}

/** Beginn der Woche (00:00 Uhr lokale Zeit am `weekStartsOn`-Tag), in der `date` liegt. */
export function startOfWeekInZone(date: Date, timeZone: string, weekStartsOn = 1): Date {
  const w = getWallTime(date, timeZone);
  const diff = (w.weekday - weekStartsOn + 7) % 7;
  // Datumsarithmetik auf reinen Kalendertagen (UTC als neutrale Basis)
  const base = new Date(Date.UTC(w.year, w.month - 1, w.day - diff));
  return zonedTimeToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), 0, 0, 0, timeZone);
}

/** Beginn der darauffolgenden Woche. */
export function endOfWeekInZone(date: Date, timeZone: string, weekStartsOn = 1): Date {
  const start = startOfWeekInZone(date, timeZone, weekStartsOn);
  const w = getWallTime(new Date(start.getTime() + 12 * HOUR), timeZone);
  const base = new Date(Date.UTC(w.year, w.month - 1, w.day + 7));
  return zonedTimeToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), 0, 0, 0, timeZone);
}

/** Überschneidung zweier Zeiträume in Millisekunden. */
export function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}
