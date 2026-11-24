import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../env';
import { Errors, L } from '../lib/errors';
import { notInBeta } from '../services/beta.service';

/** Auf der Beta-Instanz ohne Anmeldung erreichbar (nichts davon verrät Daten) */
const OPEN = new Set(['/health', '/site', '/status', '/beta/session', '/brand/logo', '/internal/tls-check', '/consent', '/auth/logout', '/auth/me', '/payments/sumup/webhook', '/payments/return']);
/** Anmelden und Registrieren gibt es auf der Beta-Instanz nicht – der Zugang läuft nur über die Hauptseite */
const NO_LOGIN = new Set(['/start', '/auth/login-link', '/auth/verify', '/newsletter/subscribe']);

/**
 * Beta-Instanz (BETA_MODE=true): Die API beantwortet nur Anfragen von Nutzern mit Beta-Zugang.
 * Alle anderen bekommen 403 – unabhängig davon, was die Website davor schon abfängt.
 */
export const betaPlugin = fp(async function betaPlugin(app: FastifyInstance) {
  if (!env.BETA_MODE) return;
  app.addHook('preHandler', async (request) => {
    const path = request.url.split('?')[0]!.replace(/^\/api\/v1/, '') || '/';
    if (OPEN.has(path)) return;
    if (NO_LOGIN.has(path)) {
      throw Errors.forbidden(L('Auf der Beta-Seite kannst du dich nicht anmelden oder registrieren. Bitte nutze die Hauptseite.', 'You cannot sign in or register on the beta site. Please use the main site.'));
    }
    // plugins/auth.ts lässt auf der Beta-Instanz nur Sitzungen von Nutzern mit Beta-Zugang gelten
    if (!request.user) throw notInBeta();
  });
});
