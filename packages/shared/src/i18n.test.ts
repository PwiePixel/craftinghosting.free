import { describe, expect, it } from 'vitest';
import { internalPath, issueMessage, localeFromAcceptLanguage, localePath, resolvePath, sectionPath, switchLocalePath } from './i18n';
import { normalizeSiteSettings, tierForPosition } from './settings';
import { deleteAt, formatDateTime, restPeriodAfterText, restPeriodText } from './format';
import { startSchema } from './schemas';

describe('Pfade', () => {
  it('baut englische (Standard) und deutsche Pfade', () => {
    expect(localePath('en', 'myServers')).toBe('/my-servers');
    expect(localePath('de', 'myServers')).toBe('/de/meine-server');
    expect(localePath('en', 'home')).toBe('/');
    expect(localePath('de', 'home')).toBe('/de');
    expect(localePath('de', 'verify', { token: 'a b' })).toBe('/de/verify?token=a+b');
    expect(sectionPath('en', 'plans')).toBe('/#plans');
    expect(sectionPath('de', 'plans')).toBe('/de#pakete');
    expect(internalPath('en', 'myServers')).toBe('/en/meine-server');
    expect(internalPath('de', 'home')).toBe('/de');
  });

  it('erkennt Seite und Sprache – auch alte Links', () => {
    expect(resolvePath('/my-servers')).toMatchObject({ locale: 'en', key: 'myServers', prefix: null });
    expect(resolvePath('/de/meine-server/')).toMatchObject({ locale: 'de', key: 'myServers', prefix: 'de' });
    expect(resolvePath('/de')).toMatchObject({ locale: 'de', key: 'home' });
    expect(resolvePath('/')).toMatchObject({ locale: 'en', key: 'home' });
    // alte Links: /en/… und deutsche Pfade ohne Präfix
    expect(resolvePath('/en/my-servers')).toMatchObject({ locale: 'en', key: 'myServers', prefix: 'en' });
    expect(resolvePath('/impressum')).toMatchObject({ locale: 'en', key: 'imprint', rest: '/impressum', prefix: null });
    expect(resolvePath('/gibt-es-nicht')).toMatchObject({ key: null, rest: '/gibt-es-nicht' });
  });

  it('wechselt die Sprache auf derselben Seite', () => {
    expect(switchLocalePath('/imprint', 'de')).toBe('/de/impressum');
    expect(switchLocalePath('/de/nutzungsbedingungen', 'en')).toBe('/terms-of-use');
    expect(switchLocalePath('/unbekannt', 'de')).toBe('/de');
  });

  it('wählt Deutsch nur, wenn der Browser Deutsch zuerst nennt', () => {
    expect(localeFromAcceptLanguage('de-DE,de;q=0.9,en;q=0.8')).toBe('de');
    expect(localeFromAcceptLanguage('en-US,en;q=0.9')).toBe('en');
    expect(localeFromAcceptLanguage('nl-NL,nl;q=0.9')).toBe('en');
    expect(localeFromAcceptLanguage(undefined)).toBe('en');
  });
});

describe('Warteliste & Einstellungen', () => {
  it('vergibt EPYC an die ersten Plätze, danach Xeon', () => {
    expect(tierForPosition(1, 50)).toBe('epyc');
    expect(tierForPosition(50, 50)).toBe('epyc');
    expect(tierForPosition(51, 50)).toBe('xeon');
  });

  it('ergänzt und prüft gespeicherte Einstellungen', () => {
    const s = normalizeSiteSettings({ registration: { mode: 'preregistration', maxServersPerUser: '2' }, stats: { uptime: { value: 120 } }, status: { overrides: { api: 'degraded', x: 'kaputt' } } });
    expect(s.registration).toEqual({ mode: 'preregistration', maxServersPerUser: 2 });
    expect(s.stats.uptime.value).toBe(100);
    expect(s.status.overrides).toEqual({ api: 'degraded' });
    expect(s.maintenance.enabled).toBe(false);
    expect(normalizeSiteSettings({ registration: { mode: 'kaputt' } }).registration.mode).toBe('open');
  });

  it('berechnet die automatische Löschung nach Ruhetag + 48 h', () => {
    const suspended = new Date('2026-10-01T12:00:00Z');
    expect(deleteAt(suspended, 1440, 48)?.toISOString()).toBe('2026-10-04T12:00:00.000Z');
    expect(deleteAt(suspended, 1440, 0)).toBeNull();
  });
});

describe('Texte', () => {
  it('übersetzt Validierungsmeldungen', () => {
    const res = startSchema.safeParse({ planId: 'free-4gb', serverType: 'paper', version: 'latest', name: 'x', email: 'nope', acceptTerms: false });
    expect(res.success).toBe(false);
    if (res.success) return;
    const byField = (field: string, locale: 'de' | 'en') => issueMessage(res.error.issues.find((i) => i.path[0] === field)!, locale);
    expect(byField('email', 'de')).toBe('Bitte gib eine gültige E-Mail-Adresse ein.');
    expect(byField('email', 'en')).toBe('Please enter a valid email address.');
    expect(byField('name', 'en')).toContain('at least');
    expect(byField('acceptTerms', 'en')).toContain('accept');
  });

  it('formatiert Ruhezeiten und Datum in beiden Sprachen', () => {
    expect(restPeriodText(1440, 'en')).toBe('1 rest day');
    expect(restPeriodAfterText(1440, 'en')).toBe('after a rest day');
    expect(restPeriodAfterText(2880, 'en')).toBe('after 2 rest days');
    const d = new Date('2026-10-30T13:00:00Z');
    expect(formatDateTime(d, 'Europe/Berlin', 'de')).toContain('30.10.');
    expect(formatDateTime(d, 'Europe/Berlin', 'en')).toMatch(/30 Oct/);
  });
});

describe('Paket-Kapazität und EPYC-Plätze in den Einstellungen', () => {
  it('übernimmt Standardwerte und erlaubt „unbegrenzt“', async () => {
    const { normalizeSiteSettings, websiteEpycSlots } = await import('./settings');
    const d = normalizeSiteSettings({});
    expect(Object.keys(d.plans).length).toBeGreaterThan(0);
    const id = Object.keys(d.plans)[0]!;
    expect(normalizeSiteSettings({ plans: { [id]: { capacity: 40, reserved: 7 } } }).plans[id]).toEqual({ capacity: 40, reserved: 7 });
    expect(normalizeSiteSettings({ plans: { [id]: { capacity: null } } }).plans[id]!.capacity).toBeNull();
    expect(normalizeSiteSettings({ plans: { unbekannt: { capacity: 1 } } }).plans.unbekannt).toBeUndefined();
    expect(websiteEpycSlots({ epycSlots: 50, epycReserved: 20 })).toBe(30);
    expect(websiteEpycSlots({ epycSlots: 10, epycReserved: 20 })).toBe(0);
  });
});

describe('Vormerkungs-Blöcke in der Warteschlange', () => {
  it('rechnet Blöcke vor einer Position mit ein und übernimmt die alte Zahl', async () => {
    const { blockSpotsBefore, normalizeSiteSettings } = await import('./settings');
    // 23 Anmeldungen, dann 890 Vormerkungen, später +50
    const blocks = [
      { after: 23, count: 890, at: null },
      { after: 30, count: 50, at: null },
    ];
    expect(blockSpotsBefore(23, blocks)).toBe(0); // Platz 23 bleibt #23
    expect(blockSpotsBefore(24, blocks)).toBe(890); // nächster Eintrag → #24 + 890 = #914
    expect(blockSpotsBefore(31, blocks)).toBe(940);
    expect(blockSpotsBefore(-5, blocks)).toBe(0); // vorne eingereihte Vormerkungen
    const legacy = normalizeSiteSettings({ waitlist: { externalCount: 890 } });
    expect(legacy.waitlist.blocks).toEqual([{ after: null, count: 890, at: null }]);
    expect(legacy.waitlist.externalCount).toBe(890);
    const withBlocks = normalizeSiteSettings({ waitlist: { externalCount: 5, blocks } });
    expect(withBlocks.waitlist.externalCount).toBe(940);
  });
});
