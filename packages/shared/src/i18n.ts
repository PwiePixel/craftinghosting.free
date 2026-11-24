/**
 * Zweisprachigkeit (Englisch / Deutsch) – gemeinsame Grundlagen für Website und API.
 *
 *  – Englisch ist Standard und liegt ohne Präfix unter „/“ (z. B. /my-servers),
 *    Deutsch unter „/de“ mit deutschen Pfaden (z. B. /de/meine-server).
 *  – Die API schickt E-Mails, Chat-Hinweise und die Panel-Beschreibung
 *    in der Sprache, die der Nutzer zuletzt auf der Website verwendet hat.
 */

import { freeHostingConfig } from './config/freehosting.config';

const { limits } = freeHostingConfig;

export const locales = ['en', 'de'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/** Text in beiden Sprachen */
export type Localized = { de: string; en: string };

export function tr(text: Localized | string, locale: Locale): string {
  return typeof text === 'string' ? text : text[locale];
}

/** Intl-Locale für Datums- und Zahlenformate */
export function intlLocale(locale: Locale): string {
  return locale === 'en' ? 'en-GB' : 'de-DE';
}

/** Sprache aus einem Accept-Language-Header: Deutsch nur, wenn Deutsch die erste Wahl ist – sonst Englisch. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  const first = (header ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('de') ? 'de' : 'en';
}

/* -------------------------------------------------------------------------- */
/*  Seiten und Pfade                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Öffentliche Pfade je Sprache und der interne Ordner der Next.js-Route
 * (app/[lang]/(site)/<internal>). Der Proxy übersetzt zwischen beiden.
 */
export const routes = {
  home: { en: '/', de: '/de', internal: '' },
  start: { en: '/start', de: '/de/start', internal: 'start' },
  verify: { en: '/verify', de: '/de/verify', internal: 'verify' },
  login: { en: '/login', de: '/de/login', internal: 'login' },
  /** Konto anlegen (E-Mail-Adresse und Passwort) – danach geht es zu „Server erstellen“ */
  register: { en: '/register', de: '/de/registrieren', internal: 'registrieren' },
  myServers: { en: '/my-servers', de: '/de/meine-server', internal: 'meine-server' },
  /** Konto: E-Mail-Adresse, Discord, Sicherheit, Konto löschen (getrennt von den Servern) */
  account: { en: '/account', de: '/de/konto', internal: 'konto' },
  faq: { en: '/faq', de: '/de/faq', internal: 'faq' },
  /** Dokumentation; Unterseiten liegen unter /docs/<Seite> (die Partner-API nur für Partner-Konten) */
  docs: { en: '/docs', de: '/de/docs', internal: 'docs' },
  status: { en: '/status', de: '/de/status', internal: 'status' },
  imprint: { en: '/imprint', de: '/de/impressum', internal: 'impressum' },
  privacy: { en: '/privacy', de: '/de/datenschutz', internal: 'datenschutz' },
  terms: { en: '/terms', de: '/de/agb', internal: 'agb' },
  rules: { en: '/terms-of-use', de: '/de/nutzungsbedingungen', internal: 'nutzungsbedingungen' },
  cookies: { en: '/cookies', de: '/de/cookies', internal: 'cookies' },
  /** Nutzungsbedingungen für das Discord-Bot-Hosting */
  discordTerms: { en: '/discord-bot/terms-of-use', de: '/de/discord-bot/nutzungsbedingungen', internal: 'discord-bot/nutzungsbedingungen' },
  donate: { en: '/donate', de: '/de/spenden', internal: 'spenden' },
  /** Kostenpflichtige Extras: Übersicht und Bedingungen samt Widerrufsbelehrung */
  extras: { en: '/extras', de: '/de/extras', internal: 'extras' },
  extrasTerms: { en: '/extras-terms', de: '/de/extras-bedingungen', internal: 'extras-bedingungen' },
  /** Kündigungsweg für Abos – ohne Anmeldung erreichbar */
  cancelSubscription: { en: '/cancel-subscription', de: '/de/kuendigen', internal: 'kuendigen' },
  newsletter: { en: '/newsletter', de: '/de/newsletter', internal: 'newsletter' },
  /** Beta-Programm: Bestätigungsseite auf der Hauptseite (nur für freigeschaltete Nutzer) */
  beta: { en: '/beta', de: '/de/beta', internal: 'beta' },
} as const satisfies Record<string, Record<Locale | 'internal', string>>;

export type RouteKey = keyof typeof routes;

/** Anker der Abschnitte auf der Startseite */
export const homeSections = {
  plans: { de: 'pakete', en: 'plans' },
  how: { de: 'ablauf', en: 'how-it-works' },
  rules: { de: 'regeln', en: 'rules' },
  discord: { de: 'discord-bots', en: 'discord-bots' },
} as const satisfies Record<string, Record<Locale, string>>;

export type HomeSection = keyof typeof homeSections;

/** Pfad einer Seite in einer Sprache, optional mit Query-String */
export function localePath(locale: Locale, key: RouteKey, query?: Record<string, string>): string {
  const path = routes[key][locale];
  const qs = query ? new URLSearchParams(query).toString() : '';
  return qs ? `${path}?${qs}` : path;
}

/** Link zu einem Abschnitt der Startseite, z. B. /#plans bzw. /de#pakete */
export function sectionPath(locale: Locale, section: HomeSection): string {
  return `${locale === 'de' ? '/de' : '/'}#${homeSections[section][locale]}`;
}

/** Interner Pfad einer Seite, z. B. /de/meine-server bzw. /en/meine-server */
export function internalPath(locale: Locale, key: RouteKey): string {
  const folder = routes[key].internal;
  return folder ? `/${locale}/${folder}` : `/${locale}`;
}

export interface ResolvedPath {
  locale: Locale;
  key: RouteKey | null;
  /** Pfad ohne Sprach-Präfix */
  rest: string;
  /** Welches Präfix im Pfad stand (en = alter Link aus der Zeit mit /en) */
  prefix: 'de' | 'en' | null;
}

/**
 * Ermittelt Seite und Sprache aus einem URL-Pfad. Erkennt englische und deutsche
 * Pfadnamen – auch in der „falschen“ Sprache (z. B. alte Links wie /meine-server oder /en/my-servers).
 */
export function resolvePath(pathname: string): ResolvedPath {
  const clean = pathname.replace(/\/+$/, '') || '/';
  const m = /^\/(de|en)(\/.*)?$/.exec(clean);
  const prefix = (m?.[1] as 'de' | 'en' | undefined) ?? null;
  const rest = m ? (m[2] ?? '/') : clean;
  const locale: Locale = prefix === 'de' ? 'de' : 'en';
  for (const key of Object.keys(routes) as RouteKey[]) {
    const en = routes[key].en;
    const de = routes[key].de.replace(/^\/de/, '') || '/';
    if (rest === en || rest === de) return { locale, key, rest, prefix };
  }
  return { locale, key: null, rest, prefix };
}

/** Seiten mit Unterseiten (z. B. /my-servers/<id>) – nur angemeldet erreichbar */
export const pagesWithSubpages = ['myServers', 'account'] as const satisfies readonly RouteKey[];

/** Unterseite einer Seite aus `pagesWithSubpages` erkennen: /my-servers/abc → { key: 'myServers', tail: '/abc' } */
export function resolveSubpage(rest: string): { key: (typeof pagesWithSubpages)[number]; tail: string } | null {
  for (const key of pagesWithSubpages) {
    for (const base of [routes[key].en, routes[key].de.replace(/^\/de/, '')]) {
      if (rest.startsWith(`${base}/`) && /^\/[\w-]{1,64}$/.test(rest.slice(base.length))) return { key, tail: rest.slice(base.length) };
    }
  }
  return null;
}

/** Seite eines Servers unter „Meine Server“ */
export function serverPagePath(locale: Locale, id: string): string {
  return `${routes.myServers[locale]}/${id}`;
}

/** Gleiche Seite in der anderen Sprache (für den Sprachumschalter) */
export function switchLocalePath(pathname: string, target: Locale): string {
  const { key, rest } = resolvePath(pathname);
  const sub = key ? null : resolveSubpage(rest);
  if (sub) return `${routes[sub.key][target]}${sub.tail}`;
  return localePath(target, key ?? 'home');
}

/* -------------------------------------------------------------------------- */
/*  Validierungsmeldungen (Schlüssel in den Schemas → Text je Sprache)         */
/* -------------------------------------------------------------------------- */

export const validationMessages: Record<Locale, Record<string, string>> = {
  de: {
    'v.required': 'Dieses Feld ist erforderlich.',
    'v.email_too_long': 'E-Mail-Adresse ist zu lang.',
    'v.email_invalid': 'Bitte gib eine gültige E-Mail-Adresse ein.',
    'v.code_format': 'Der Code besteht aus sechs Ziffern.',
    'v.password_min': 'Das Passwort muss mindestens 10 Zeichen lang sein.',
    'v.password_max': 'Das Passwort darf höchstens 72 Zeichen lang sein.',
    'v.password_mix': 'Das Passwort muss Buchstaben und Zahlen enthalten.',
    'v.username_min': 'Mindestens 3 Zeichen.',
    'v.username_max': 'Höchstens 24 Zeichen.',
    'v.username_chars': 'Nur Kleinbuchstaben, Zahlen, Punkt, Unterstrich und Bindestrich – Anfang und Ende Buchstabe/Zahl.',
    'v.server_name_min': `Der Servername muss mindestens ${limits.serverNameMinLength} Zeichen lang sein.`,
    'v.server_name_max': `Der Servername darf höchstens ${limits.serverNameMaxLength} Zeichen lang sein.`,
    'v.server_name_chars': 'Der Servername enthält ungültige Zeichen.',
    'v.plan_unknown': 'Unbekanntes Paket.',
    'v.plan_type_mismatch': 'Dieses Paket passt nicht zum gewählten Servertyp.',
    'v.type_unknown': 'Unbekannter Servertyp.',
    'v.version_unavailable': 'Diese Version ist für den Servertyp nicht verfügbar.',
    'v.accept_terms': 'Bitte akzeptiere die Nutzungsbedingungen und AGB.',
    'v.email_blocked': 'Diese E-Mail-Adresse kann nicht verwendet werden. Bitte nimm eine andere.',
  },
  en: {
    'v.required': 'This field is required.',
    'v.email_too_long': 'Email address is too long.',
    'v.email_invalid': 'Please enter a valid email address.',
    'v.code_format': 'The code consists of six digits.',
    'v.password_min': 'The password must be at least 10 characters long.',
    'v.password_max': 'The password must be at most 72 characters long.',
    'v.password_mix': 'The password must contain letters and numbers.',
    'v.username_min': 'At least 3 characters.',
    'v.username_max': 'At most 24 characters.',
    'v.username_chars': 'Only lowercase letters, numbers, dot, underscore and hyphen – must start and end with a letter or number.',
    'v.server_name_min': `The server name must be at least ${limits.serverNameMinLength} characters long.`,
    'v.server_name_max': `The server name must be at most ${limits.serverNameMaxLength} characters long.`,
    'v.server_name_chars': 'The server name contains invalid characters.',
    'v.plan_unknown': 'Unknown plan.',
    'v.plan_type_mismatch': 'This plan does not match the selected server type.',
    'v.type_unknown': 'Unknown server type.',
    'v.version_unavailable': 'This version is not available for the selected server type.',
    'v.accept_terms': 'Please accept the terms of use and terms and conditions.',
    'v.email_blocked': 'This email address cannot be used. Please use a different one.',
  },
};

/** Minimal-Typ eines zod-Issues (vermeidet eine harte Abhängigkeit auf zod-Interna) */
export interface IssueLike {
  message: string;
  path: PropertyKey[];
}

/**
 * Meldung eines Validierungsfehlers in der gewünschten Sprache.
 * Eigene Meldungen sind Schlüssel („v.…“), alles andere ist eine generische zod-Meldung.
 */
export function issueMessage(issue: IssueLike, locale: Locale): string {
  const known = validationMessages[locale][issue.message];
  if (known) return known;
  if (issue.message.startsWith('v.')) return validationMessages.de[issue.message] ?? issue.message;
  return locale === 'de' ? 'Ungültige Eingabe.' : 'Invalid input.';
}
