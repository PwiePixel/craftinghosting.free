import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { isLocale, localeFromAcceptLanguage, type Locale } from '@chfree/shared';
import { allowedOrigins } from '../env';
import { Errors, L } from '../lib/errors';

declare module 'fastify' {
  interface FastifyRequest {
    /** Sprache der Anfrage: Header X-CHF-Lang (Website) → Accept-Language → Deutsch */
    lang: Locale;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

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
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      throw Errors.forbidden(L('Ungültiger Ursprung der Anfrage.', 'Invalid request origin.'));
    }
    if (request.headers['x-chf-client'] !== 'web') {
      throw Errors.forbidden(L('Ungültige Anfrage (fehlender Client-Header).', 'Invalid request (missing client header).'));
    }
  });
});
