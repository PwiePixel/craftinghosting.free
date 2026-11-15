import type { FastifyInstance } from 'fastify';
import { deleteAccount } from '../services/account.service';
import { eq } from 'drizzle-orm';
import { deleteAccountSchema, loginLinkSchema, panelSetupSchema, startSchema, tokenSchema, type VerifyResult } from '@chfree/shared';
import { db } from '../db/client';
import { servers, users } from '../db/schema';
import { env, panelPublicUrl } from '../env';
import { ApiError, Errors, L } from '../lib/errors';
import { assertNotMaintenance } from '../lib/maintenance';
import { clearSessionCookie, currentUser, requireAuth, setSessionCookie } from '../plugins/auth';
import { audit } from '../services/audit.service';
import { getUser, requestLoginLink, requestServer, toUserDTO, verifyToken } from '../services/auth.service';
import { rememberUserLocale } from '../services/locale.service';
import { createPanelAccount } from '../services/provisioning.service';
import { activatePendingServers, hardDeleteServer } from '../services/server.service';
import { createSession, destroySession } from '../services/session.service';

const strict = (max: number, timeWindow: string) => ({ config: { rateLimit: { max, timeWindow } } });

export async function authRoutes(app: FastifyInstance) {
  /** Server anfordern (öffentlich) → Bestätigungs-E-Mail */
  app.post('/start', strict(6, '15 minutes'), async (request) => {
    await assertNotMaintenance(request);
    const input = startSchema.parse(request.body);
    await requestServer(input, { ip: request.ip, locale: request.lang });
    return { ok: true };
  });

  /** Anmeldelink anfordern (öffentlich). Antwort ist immer gleich. */
  app.post('/auth/login-link', strict(6, '15 minutes'), async (request) => {
    const { email } = loginLinkSchema.parse(request.body);
    try {
      await requestLoginLink(email, request.lang);
    } catch (err) {
      request.log.error({ err }, 'Anmeldelink konnte nicht versendet werden');
    }
    return { ok: true };
  });

  /** E-Mail-Link einlösen: bestätigen + anmelden + nächster Schritt */
  app.post('/auth/verify', strict(20, '15 minutes'), async (request, reply) => {
    const { token } = tokenSchema.parse(request.body);
    const result = await verifyToken(token, { ip: request.ip, locale: request.lang });
    const session = await createSession(result.user.id, { ip: request.ip, userAgent: request.headers['user-agent'] });
    setSessionCookie(reply, session.token, session.expiresAt);
    const body: VerifyResult = {
      user: toUserDTO(result.user),
      next: result.next,
      existingPanelAccount: result.existingPanelAccount,
      panelUrl: panelPublicUrl,
      waitlist: result.waitlist,
    };
    return body;
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[env.SESSION_COOKIE_NAME];
    if (token) await destroySession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (request) => {
    return { user: toUserDTO(currentUser(request)), panelUrl: panelPublicUrl };
  });

  /** Panel-Zugang festlegen: legt das Pterodactyl-Konto an und erstellt wartende Server. */
  app.post('/panel/setup', { preHandler: requireAuth, ...strict(8, '15 minutes') }, async (request) => {
    await assertNotMaintenance(request);
    const input = panelSetupSchema.parse(request.body);
    const user = currentUser(request);
    await rememberUserLocale(user, request.lang);
    if (!user.emailVerifiedAt) throw Errors.forbidden(L('Bitte bestätige zuerst deine E-Mail-Adresse.', 'Please confirm your email address first.'));
    if (user.pteroUserId) throw new ApiError(409, 'panel_already_linked', L('Dein Panel-Zugang ist bereits eingerichtet.', 'Your panel access is already set up.'));
    let existing: boolean;
    try {
      ({ existing } = await createPanelAccount(user, input.username, input.password));
    } catch (err) {
      if (err instanceof ApiError) throw err;
      // z. B. Panel nicht erreichbar, falscher API-Key, Mock-Datei nicht beschreibbar – Details nur ins Log
      request.log.error({ err }, 'Panel-Konto konnte nicht angelegt werden');
      throw Errors.unavailable(
        L(
          'Der Zugang zum Panel konnte gerade nicht angelegt werden. Bitte versuche es in ein paar Minuten erneut.',
          'Your panel access could not be created right now. Please try again in a few minutes.',
        ),
      );
    }
    const fresh = await getUser(user.id);
    const activated = await activatePendingServers(fresh, request.ip);
    return { user: toUserDTO(fresh), existingPanelAccount: existing, serversCreated: activated.length, panelUrl: panelPublicUrl };
  });

  /** Konto löschen – inkl. aller Server. Das Panel-Konto selbst bleibt bestehen. */
  app.post('/account/delete', { preHandler: requireAuth, ...strict(5, '15 minutes') }, async (request, reply) => {
    await assertNotMaintenance(request);
    const { confirmEmail } = deleteAccountSchema.parse(request.body);
    const user = currentUser(request);
    if (confirmEmail !== user.email) {
      throw new ApiError(400, 'confirm_mismatch', L('Die E-Mail-Adresse stimmt nicht überein.', 'The email address does not match.'), {
        confirmEmail: L('Bitte gib deine E-Mail-Adresse exakt ein.', 'Please enter your email address exactly.'),
      });
    }
    await deleteAccount(user, {}, request.ip);
    clearSessionCookie(reply);
    return { ok: true };
  });
}
