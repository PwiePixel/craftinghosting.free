import { describe, expect, it } from 'vitest';
import { deleteAt, formatDate, formatDateTime, formatTime } from './format';

describe('Datumsformat (unabhängig von der ICU-Version)', () => {
  it('formatiert Deutsch und Englisch in Europe/Berlin', () => {
    expect(formatDateTime('2026-09-30T14:20:00Z', 'Europe/Berlin', 'de')).toBe('Mi., 30.09., 16:20');
    expect(formatDateTime('2026-09-30T14:20:00Z', 'Europe/Berlin', 'en')).toBe('Wed 30 Sep, 16:20 CEST');
    expect(formatDate('2026-12-31T23:05:00Z', 'Europe/Berlin', 'de')).toBe('01.01.2027');
    expect(formatDate('2026-12-31T23:05:00Z', 'Europe/Berlin', 'en')).toBe('1 Jan 2027');
    expect(formatTime('2026-01-15T00:00:00Z', 'Europe/Berlin', 'de')).toBe('01:00');
    expect(formatTime('2026-01-15T00:00:00Z', 'Europe/Berlin', 'en')).toBe('01:00 CET');
  });

  it('berücksichtigt die Zeitumstellung', () => {
    expect(formatDateTime('2026-03-29T00:59:00Z', 'Europe/Berlin', 'de')).toBe('So., 29.03., 01:59');
    expect(formatDateTime('2026-03-29T01:00:00Z', 'Europe/Berlin', 'de')).toBe('So., 29.03., 03:00');
  });

  it('Löschzeitpunkt = Suspendierung + Ruhezeit + Frist', () => {
    expect(deleteAt('2026-09-01T00:00:00Z', 1440, 48)?.toISOString()).toBe('2026-09-04T00:00:00.000Z');
    expect(deleteAt('2026-09-01T00:00:00Z', 1440, 0)).toBeNull();
  });
});
