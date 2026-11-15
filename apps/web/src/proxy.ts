import { NextResponse, type NextRequest } from 'next/server';
import { internalPath, localePath, resolvePath, routes, type Locale, type RouteKey } from '@chfree/shared';
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
const OPEN_DURING_MAINTENANCE = new Set<RouteKey>(['login', 'verify', 'myServers', 'status', 'imprint', 'privacy', 'terms', 'rules', 'cookies']);

/* ------------------------------------------------------------ Wartungsmodus */

let siteCache: { at: number; maintenance: boolean } | null = null;

/** Wartungsmodus aus der API (10 s Cache, bei Fehlern: letzter bekannter Stand bzw. „keine Wartung“) */
async function maintenanceEnabled(): Promise<boolean> {
  if (siteCache && Date.now() - siteCache.at < 10_000) return siteCache.maintenance;
  try {
    const res = await fetch(`${API}/api/v1/site`, { cache: 'no-store', signal: AbortSignal.timeout(2000) });
    const data = (await res.json()) as { site?: { maintenance?: { enabled?: boolean } } };
    siteCache = { at: Date.now(), maintenance: !!data.site?.maintenance?.enabled };
  } catch {
    siteCache = { at: Date.now(), maintenance: siteCache?.maintenance ?? false };
  }
  return siteCache.maintenance;
}

/** Admins sehen die Website auch während der Wartung (Prüfung über die API, 30 s Cache je Session) */
const adminCache = new Map<string, { at: number; admin: boolean }>();

async function isAdminSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const hit = adminCache.get(token);
  if (hit && Date.now() - hit.at < 30_000) return hit.admin;
  let admin = false;
  try {
    const res = await fetch(`${API}/api/v1/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}`, accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) admin = ((await res.json()) as { user?: { role?: string } }).user?.role === 'admin';
  } catch {
    admin = hit?.admin ?? false;
  }
  if (adminCache.size > 1000) adminCache.clear();
  adminCache.set(token, { at: Date.now(), admin });
  return admin;
}

/* ------------------------------------------------------------ Helfer */

function rewrite(request: NextRequest, pathname: string, headers?: Record<string, string>) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  const res = NextResponse.rewrite(url);
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

  // Interne Vorschaubilder (/en/opengraph-image, /de/opengraph-image) unverändert
  if (/^\/(de|en)\/opengraph-image/.test(pathname)) return NextResponse.next();

  // Admin-Bereich: nur unter dem geheimen Pfad, nie indexieren, keine Weiterleitung zum Login (verrät nichts)
  const admin = adminPath();
  if (pathname === admin || pathname === `/de${admin}`) {
    return rewrite(request, `/${pathname.startsWith('/de/') ? 'de' : 'en'}/admin`, NOINDEX);
  }

  const { locale, key, rest, prefix } = resolvePath(pathname);

  // Interne Ordner nie direkt erreichbar machen
  if (/^\/(admin|maintenance)(\/|$)/.test(rest)) return rewrite(request, `/${locale}/__not-found`, NOINDEX);

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

  // Wartungsmodus: eigene Seite für alles außer Status, Rechtstexten und Anmeldung (Admins sehen die normale Website)
  if ((!key || !OPEN_DURING_MAINTENANCE.has(key)) && (await maintenanceEnabled()) && !(await isAdminSession(request))) {
    return rewrite(request, `/${locale}/maintenance`, { ...NOINDEX, 'Retry-After': '1800', 'Cache-Control': 'no-store' });
  }

  if (key === 'myServers' && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = localePath(locale, 'login');
    url.search = `?next=${encodeURIComponent(localePath(locale, 'myServers'))}`;
    return NextResponse.redirect(url);
  }

  // Öffentlicher Pfad → interner Pfad /<lang>/<Ordner>
  return rewrite(request, key ? internalPath(locale as Locale, key) : `/${locale}${rest === '/' ? '' : rest}`);
}

export const config = {
  // Alles außer API, Next-Interna und Dateien mit Endung (robots.txt, sitemap.xml, icon.svg …)
  matcher: ['/((?!api/|_next/|.*\\.).*)'],
};
