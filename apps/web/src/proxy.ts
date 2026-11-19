import { NextResponse, type NextRequest } from 'next/server';
import { internalPath, localePath, resolvePath, resolveSubpage, routes, type Locale, type RouteKey } from '@chfree/shared';
import { adminPath } from '@/lib/admin-path';

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'chf_session';
/** Wird beim Klick auf den Sprachumschalter gesetzt (de/en) */
const LANG_COOKIE = 'chf_lang';
const API = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/**
 * Seiten, die auch im Wartungsmodus erreichbar bleiben: Anmelden und „Meine Server“ (Server ansehen),
 * Status und Rechtstexte. Gesperrt ist nur das Registrieren bzw. Anfordern neuer Server (/start) –
 * Startseite und FAQ zeigen die Wartungsseite.
 */
const OPEN_DURING_MAINTENANCE = new Set<RouteKey>(['login', 'verify', 'myServers', 'account', 'status', 'imprint', 'privacy', 'terms', 'rules', 'cookies', 'discordTerms', 'donate', 'newsletter']);

/* ------------------------------------------------------------ Wartungsmodus */

let siteCache: { at: number; maintenance: boolean; redirectHosts: string[] } | null = null;

/** Hauptdomain (kanonische Adresse) – dorthin leiten weitere Domains mit „Weiterleiten“ aus dem Admin-Bereich */
const PRIMARY = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? '');
  } catch {
    return null;
  }
})();

/** Wartungsmodus aus der API (10 s Cache, bei Fehlern: letzter bekannter Stand bzw. „keine Wartung“) */
async function maintenanceEnabled(): Promise<boolean> {
  if (siteCache && Date.now() - siteCache.at < 10_000) return siteCache.maintenance;
  try {
    const res = await fetch(`${API}/api/v1/site`, { cache: 'no-store', signal: AbortSignal.timeout(2000) });
    const data = (await res.json()) as { site?: { maintenance?: { enabled?: boolean }; domains?: { host: string; redirect: boolean }[] } };
    siteCache = {
      at: Date.now(),
      maintenance: !!data.site?.maintenance?.enabled,
      redirectHosts: (data.site?.domains ?? []).filter((d) => d.redirect).map((d) => d.host),
    };
  } catch {
    siteCache = { at: Date.now(), maintenance: siteCache?.maintenance ?? false, redirectHosts: siteCache?.redirectHosts ?? [] };
  }
  return siteCache.maintenance;
}

/** Aufruf über eine weitere Domain, die auf die Hauptdomain weiterleiten soll? → Zieladresse */
async function canonicalRedirect(request: NextRequest): Promise<URL | null> {
  if (!PRIMARY) return null;
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '').split(',')[0]!.trim().toLowerCase().replace(/:\d+$/, '');
  if (!host || host === PRIMARY.hostname) return null;
  await maintenanceEnabled(); // füllt den Zwischenspeicher mit den Domains
  if (!siteCache?.redirectHosts.includes(host)) return null;
  return new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, PRIMARY);
}

/**
 * Wer ist angemeldet? Geprüft wird über die API (kurzer Zwischenspeicher je Sitzung):
 *  – admin:    darf den Admin-Bereich sehen (Rolle im Backend bzw. ADMIN_EMAILS) und die Website während der Wartung
 *  – signedIn: gültige Sitzung – auf der Beta-Instanz gibt es die nur für Nutzer mit Beta-Zugang
 */
const sessionCache = new Map<string, { at: number; admin: boolean; signedIn: boolean }>();

async function sessionInfo(request: NextRequest, ttlMs = 30_000): Promise<{ admin: boolean; signedIn: boolean }> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return { admin: false, signedIn: false };
  const hit = sessionCache.get(token);
  if (hit && Date.now() - hit.at < ttlMs) return hit;
  let info = { admin: false, signedIn: false };
  try {
    const res = await fetch(`${API}/api/v1/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}`, accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) info = { signedIn: true, admin: ((await res.json()) as { user?: { role?: string } }).user?.role === 'admin' };
  } catch {
    // API kurz nicht erreichbar → letzter bekannter Stand, sonst „nicht angemeldet“
    if (hit) info = { admin: hit.admin, signedIn: hit.signedIn };
  }
  if (sessionCache.size > 1000) sessionCache.clear();
  sessionCache.set(token, { at: Date.now(), ...info });
  return info;
}

const isAdminSession = async (request: NextRequest) => (await sessionInfo(request)).admin;

/** Beta-Instanz (BETA_MODE=true in der .env): nur für Nutzer mit Beta-Zugang – alle anderen sehen den Hinweis */
const BETA_INSTANCE = ['1', 'true', 'yes', 'on'].includes((process.env.BETA_MODE ?? '').toLowerCase());

/* ------------------------------------------------------------ Kurzlinks */

/** Andere Schreibweisen der Discord-Bot-Nutzungsbedingungen → richtige Seite (Pfad ohne Sprach-Präfix) */
const DISCORD_TERMS_ALIASES = new Set([
  '/discord-bot',
  '/discord-bot/terms',
  '/discordbot/terms-of-use',
  '/discord/terms-of-use',
  '/discordbot/nutzungsbedingungen',
  '/discord/nutzungsbedingungen',
]);

/* ------------------------------------------------------------ Helfer */

function rewrite(request: NextRequest, pathname: string, headers?: Record<string, string>, status?: number) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  const res = NextResponse.rewrite(url, status ? { status } : undefined);
  for (const [k, v] of Object.entries(headers ?? {})) res.headers.set(k, v);
  return res;
}

function redirect(request: NextRequest, pathname: string, status = 308) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.redirect(url, status);
}

const NOINDEX = { 'X-Robots-Tag': 'noindex, nofollow, noarchive' };

/**
 * Sprach-Routing, Wartungsmodus und Admin-Bereich:
 *  – Englisch ohne Präfix („/my-servers“), Deutsch unter „/de“ („/de/meine-server“).
 *  – Alte Links (/en/…, deutsche Pfade ohne /de) werden dauerhaft weitergeleitet.
 *  – Intern liegen alle Seiten unter app/[lang]/… mit den deutschen Ordnernamen.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Weitere Domains (Admin → Domains) mit „Weiterleiten“: dauerhaft auf die Hauptdomain
  const canonical = await canonicalRedirect(request);
  if (canonical) return NextResponse.redirect(canonical, 308);

  // Interne Vorschaubilder (/en/opengraph-image, /de/opengraph-image) unverändert
  if (/^\/(de|en)\/opengraph-image/.test(pathname)) return NextResponse.next();

  // Beta-Instanz: Ohne Beta-Zugang zeigt JEDE Adresse denselben Hinweis („Du bist nicht im Beta-Programm“).
  // Hinein führt nur der Weg über die Hauptseite: /beta-access löst das Einmal-Ticket ein.
  if (BETA_INSTANCE) {
    const betaLocale = /^\/de(\/|$)/.test(pathname) || request.cookies.get(LANG_COOKIE)?.value === 'de' ? 'de' : 'en';
    if (/^(\/de)?\/beta-access\/?$/.test(pathname)) return rewrite(request, `/${betaLocale}/beta-access`, { ...NOINDEX, 'Cache-Control': 'no-store' });
    if (!(await sessionInfo(request, 10_000)).signedIn) {
      return rewrite(request, `/${betaLocale}/beta-gate`, { ...NOINDEX, 'Cache-Control': 'no-store' }, 403);
    }
  }

  // Admin-Bereich unter /admin (und optional unter ADMIN_PATH): nur für angemeldete Admins. Alle anderen – auch nicht
  // angemeldete Besucher – bekommen dieselbe 404-Seite wie bei jeder unbekannten Adresse (verrät nichts, kein Login-Hinweis).
  const adminPaths = new Set(['/admin', adminPath()]);
  const adminLang = adminPaths.has(pathname) ? 'en' : pathname.startsWith('/de/') && adminPaths.has(pathname.slice(3)) ? 'de' : null;
  if (adminLang) {
    if (!(await isAdminSession(request))) return rewrite(request, `/${adminLang}/__not-found`, { ...NOINDEX, 'Cache-Control': 'no-store' }, 404);
    return rewrite(request, `/${adminLang}/admin`, { ...NOINDEX, 'Cache-Control': 'no-store' });
  }

  const { locale, key, rest, prefix } = resolvePath(pathname);

  // Interne Ordner nie direkt erreichbar machen
  if (/^\/(admin|maintenance|beta-gate|beta-access)(\/|$)/.test(rest)) return rewrite(request, `/${locale}/__not-found`, NOINDEX);

  // Kurzlinks und andere Schreibweisen der Discord-Bot-Nutzungsbedingungen
  if (!key && DISCORD_TERMS_ALIASES.has(rest)) {
    return redirect(request, localePath(prefix === 'de' || rest.endsWith('/nutzungsbedingungen') ? 'de' : 'en', 'discordTerms'));
  }

  // Alte Links: /en/… → englischer Pfad ohne Präfix
  if (prefix === 'en') return redirect(request, key ? localePath('en', key) : rest);

  // Alte deutsche Links ohne /de (z. B. /meine-server, /impressum) → /de/…
  if (!prefix && key && rest !== routes[key].en) return redirect(request, localePath('de', key));

  // Wer Deutsch gewählt hat, landet auf der Startseite direkt auf /de
  const isDocumentRequest = !request.headers.has('rsc') && !request.headers.has('next-router-prefetch');
  const fromOwnSite = (request.headers.get('referer') ?? '').startsWith(request.nextUrl.origin);
  if (pathname === '/' && isDocumentRequest && !fromOwnSite && request.cookies.get(LANG_COOKIE)?.value === 'de') {
    return redirect(request, '/de', 307);
  }

  // Unterseiten (z. B. /my-servers/<id>) gelten wie ihre Seite
  const sub = key ? null : resolveSubpage(rest);
  const pageKey = key ?? sub?.key ?? null;

  // Wartungsmodus: eigene Seite für alles außer Status, Rechtstexten und Anmeldung (Admins sehen die normale Website)
  if ((!pageKey || !OPEN_DURING_MAINTENANCE.has(pageKey)) && (await maintenanceEnabled()) && !(await isAdminSession(request))) {
    return rewrite(request, `/${locale}/maintenance`, { ...NOINDEX, 'Retry-After': '1800', 'Cache-Control': 'no-store' });
  }

  // Unterseiten, z. B. /my-servers/<id> bzw. /de/meine-server/<id> → /<lang>/meine-server/<id>
  const protectedKey = key === 'myServers' || key === 'account' ? key : sub?.key;
  if (protectedKey && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = localePath(locale, 'login');
    url.search = `?next=${encodeURIComponent(sub ? `${localePath(locale, sub.key)}${sub.tail}` : localePath(locale, protectedKey))}`;
    return NextResponse.redirect(url);
  }
  if (sub) return rewrite(request, `${internalPath(locale as Locale, sub.key)}${sub.tail}`);

  // Öffentlicher Pfad → interner Pfad /<lang>/<Ordner>
  return rewrite(request, key ? internalPath(locale as Locale, key) : `/${locale}${rest === '/' ? '' : rest}`);
}

export const config = {
  // Alles außer API, Next-Interna und Dateien mit Endung (robots.txt, sitemap.xml, icon.svg …)
  matcher: ['/((?!api/|_next/|.*\\.).*)'],
};
