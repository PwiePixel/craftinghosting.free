import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { isLocale, localeFromAcceptLanguage, type Locale } from '@chfree/shared';
import { allowedOrigins } from '../env';
import { Errors, L } from '../lib/errors';
import { getSettings } from '../services/settings.service';

/** Ursprung erlaubt? Feste Liste aus der .env – oder eine der weiteren Domains aus dem Admin-Bereich (nur https) */
async function originAllowed(origin: string): Promise<boolean> {
  if (allowedOrigins.has(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:') return false;
    return (await getSettings()).domains.extra.some((d) => d.host === url.hostname);
  } catch {
    return false;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Sprache der Anfrage: Header X-CHF-Lang (Website) → Accept-Language → Deutsch */
    lang: Locale;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const isPartnerApi = (url: string) => /^\/api\/v1\/partner(\/|$|\?)/.test(url);
export const isPaymentWebhook = (url: string) => /^\/api\/v1\/payments\/sumup\/webhook(\?|$)/.test(url);

/**
 * CSRF-Schutz für zustandsändernde Anfragen:
 *  1. Session-Cookie ist SameSite=Lax + HttpOnly
 *  2. Pflicht-Header `X-CHF-Client: web` – fremde Seiten können ihn nicht ohne
 *     CORS-Preflight setzen, und CORS ist nur für die eigenen Origins offen.
 *  3. Ein mitgesendeter Origin muss in der Allowlist stehen.
 */
export const securityPlugin = fp(async function securityPlugin(app: FastifyInstance) {
  app.decorateRequest('lang', 'de');
  app.addHook('onRequest', async (request) => {
    const header = request.headers['x-chf-lang'];
    request.lang = isLocale(header) ? header : localeFromAcceptLanguage(request.headers['accept-language']);

    if (SAFE_METHODS.has(request.method)) return;
    // Partner-API: Zugriff nur mit API-Key (kein Cookie) – der Schutz gegen untergeschobene Browser-Anfragen entfällt dort
    if (isPartnerApi(request.url)) return;
    // Rückmeldung des Zahlungsanbieters: kommt ohne unseren Client-Header. Sie ändert nichts von sich aus – das System
    // fragt den Stand der Zahlung danach selbst beim Anbieter ab.
    if (isPaymentWebhook(request.url)) return;
    const origin = request.headers.origin;
    if (origin && !(await originAllowed(origin))) {
      throw Errors.forbidden(L('Ungültiger Ursprung der Anfrage.', 'Invalid request origin.'));
    }
    if (request.headers['x-chf-client'] !== 'web') {
      throw Errors.forbidden(L('Ungültige Anfrage (fehlender Client-Header).', 'Invalid request (missing client header).'));
    }
  });
});
