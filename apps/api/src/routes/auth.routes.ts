import { identityConfirmed } from '../services/identity';
import { discordAuthorizeUrl, discordConfig, discordGate } from '../discord/service';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { deleteAccount } from '../services/account.service';
import { eq } from 'drizzle-orm';
import {
  accountPasswordSchema,
  deleteAccountSchema,
  emailSchema,
  loginLinkSchema,
  panelSetupSchema,
  secondFactorSchema,
  sixDigitCodeSchema,
  startSchema,
  tokenSchema,
  verifyCodeSchema,
  type SecurityDTO,
  type TotpSetupDTO,
  type VerifyResponse,
  type VerifyResult,
} from '@chfree/shared';
import { db } from '../db/client';
import { servers, users, type User } from '../db/schema';
import { env, panelPublicUrl } from '../env';
import { ApiError, Errors, L } from '../lib/errors';
import { assertNotMaintenance } from '../lib/maintenance';
import { clearSessionCookie, currentUser, requireAuth, setSessionCookie } from '../plugins/auth';
import { audit } from '../services/audit.service';
import { createBetaTicket, redeemBetaTicket } from '../services/beta.service';
import { changeEmail, confirmEmail, getUser, prepareSignup, requestLoginCode, requestServer, resumeLogin, sendEmailVerification, toUserDTO, verifyLogin, verifyTwoFactor } from '../services/auth.service';
import { newNonce, setSignupCookie } from '../lib/signup-cookie';
import { rememberUserLocale } from '../services/locale.service';
import { createPanelAccount } from '../services/provisioning.service';
import { activatePendingServers, hardDeleteServer } from '../services/server.service';
import { createSession, destroySession } from '../services/session.service';
import { confirmTotp, disableSecondFactor, enablePasswordFactor, setupTotp, toSecurityDTO } from '../services/two-factor.service';

const strict = (max: number, timeWindow: string) => ({ config: { rateLimit: { max, timeWindow } } });

export async function authRoutes(app: FastifyInstance) {
  /** Server anfordern (öffentlich) → Bestätigungs-E-Mail */
  app.post('/start', strict(6, '15 minutes'), async (request, reply) => {
    await assertNotMaintenance(request);
    const input = startSchema.parse(request.body);
    // Mit eingerichteter Discord-Anbindung läuft die Registrierung über Discord: Die Anfrage wandert in ein
    // signiertes Cookie und wird nach der Rückkehr von Discord gespeichert. Die Website leitet zu `redirect` weiter.
    if ((await discordConfig()).linkReady) {
      await prepareSignup(input);
      const nonce = newNonce();
      setSignupCookie(reply, { input, locale: request.lang, nonce });
      return { ok: true, redirect: await discordAuthorizeUrl({ kind: 'signup', id: nonce }, request.lang) };
    }
    await requestServer(input, { ip: request.ip, locale: request.lang });
    return { ok: true };
  });

  /** Nach der Rückkehr von Discord (oder beim Wiederkommen): Wie geht es für diesen Account weiter? */
  app.post('/auth/continue', { preHandler: requireAuth, ...strict(30, '15 minutes') }, async (request): Promise<VerifyResult> => {
    const done = await resumeLogin(currentUser(request).id, { ip: request.ip, locale: request.lang });
    return { user: toUserDTO(done.user), next: done.next, existingPanelAccount: done.existingPanelAccount, panelUrl: panelPublicUrl, waitlist: done.waitlist, discordBlocked: done.discordBlocked ?? null };
  });

  /* ------------------------------------------------------------ E-Mail-Adresse (Bestätigung ist freiwillig) */

  /** Code zum Bestätigen der E-Mail-Adresse schicken */
  app.post('/account/email/code', { preHandler: requireAuth, ...strict(6, '15 minutes') }, async (request) => {
    await sendEmailVerification(await getUser(currentUser(request).id), request.lang);
    return { ok: true };
  });

  app.post('/account/email/verify', { preHandler: requireAuth, ...strict(15, '15 minutes') }, async (request) => {
    const { code } = z.object({ code: sixDigitCodeSchema }).parse(request.body);
    return { user: toUserDTO(await confirmEmail(await getUser(currentUser(request).id), code, request.ip)) };
  });

  /** E-Mail-Adresse ändern (vertippt oder nicht erreichbar) – die neue Adresse ist unbestätigt */
  app.post('/account/email', { preHandler: requireAuth, ...strict(6, '15 minutes') }, async (request) => {
    await assertNotMaintenance(request);
    const { email } = z.object({ email: emailSchema }).parse(request.body);
    return { user: toUserDTO(await changeEmail(await getUser(currentUser(request).id), email, { ip: request.ip, locale: request.lang })) };
  });

  /** Anmeldecode anfordern (öffentlich). Antwort ist immer gleich. Der alte Pfad /auth/login-link bleibt als Alias. */
  for (const path of ['/auth/login-code', '/auth/login-link']) {
    app.post(path, strict(6, '15 minutes'), async (request) => {
      const { email } = loginLinkSchema.parse(request.body);
      try {
        await requestLoginCode(email, request.lang);
      } catch (err) {
        request.log.error({ err }, 'Anmeldecode konnte nicht versendet werden');
      }
      return { ok: true };
    });
  }

  /** Sitzung anlegen und die Antwort für die Website bauen */
  const signIn = async (request: FastifyRequest, reply: FastifyReply, result: { user: User; next: VerifyResult['next']; existingPanelAccount: boolean; waitlist: VerifyResult['waitlist']; discordBlocked?: VerifyResult['discordBlocked'] }) => {
    const session = await createSession(result.user.id, { ip: request.ip, userAgent: request.headers['user-agent'] });
    setSessionCookie(reply, session.token, session.expiresAt);
    const body: VerifyResult = {
      user: toUserDTO(result.user),
      next: result.next,
      existingPanelAccount: result.existingPanelAccount,
      panelUrl: panelPublicUrl,
      waitlist: result.waitlist,
      discordBlocked: result.discordBlocked ?? null,
    };
    return body;
  };

  /**
   * Code aus der E-Mail einlösen: bestätigen + anmelden + nächster Schritt. Ist eine zweite Stufe eingeschaltet,
   * gibt es noch keine Sitzung, sondern ein Ticket für /auth/two-factor.
   * (Links aus älteren E-Mails funktionieren bis zu ihrem Ablauf weiter: { token }.)
   */
  app.post('/auth/verify', strict(15, '15 minutes'), async (request, reply): Promise<VerifyResponse> => {
    const body = request.body as { token?: unknown } | null;
    const input = body && typeof body.token === 'string' ? tokenSchema.parse(body) : verifyCodeSchema.parse(body);
    const step = await verifyLogin(input, { ip: request.ip, locale: request.lang });
    if (step.kind === 'two_factor') return { twoFactor: { method: step.method, ticket: step.ticket } };
    return signIn(request, reply, step);
  });

  /** Zweite Stufe: Passwort, Code aus der Authenticator-App oder Wiederherstellungscode */
  app.post('/auth/two-factor', strict(15, '15 minutes'), async (request, reply): Promise<VerifyResult> => {
    const { ticket, ...factor } = secondFactorSchema.and(z.object({ ticket: z.string().min(20).max(400) })).parse(request.body);
    return signIn(request, reply, await verifyTwoFactor(ticket, factor, { ip: request.ip, locale: request.lang }));
  });

  /* ------------------------------------------------------------ Sicherheit des Accounts */

  app.get('/account/security', { preHandler: requireAuth }, async (request): Promise<{ security: SecurityDTO }> => ({ security: toSecurityDTO(currentUser(request)) }));

  /** Eigenes Passwort als zweite Stufe einschalten → Wiederherstellungscodes (nur dieses eine Mal sichtbar) */
  app.post('/account/two-factor/password', { preHandler: requireAuth, ...strict(10, '15 minutes') }, async (request) => {
    const { password } = accountPasswordSchema.parse(request.body);
    return { recoveryCodes: await enablePasswordFactor(currentUser(request), password, request.ip) };
  });

  /** Authenticator-App: Schlüssel und QR-Code erzeugen (wird erst mit /confirm aktiv) */
  app.post('/account/two-factor/totp/setup', { preHandler: requireAuth, ...strict(10, '15 minutes') }, async (request): Promise<{ setup: TotpSetupDTO }> => ({
    setup: await setupTotp(currentUser(request)),
  }));

  app.post('/account/two-factor/totp/confirm', { preHandler: requireAuth, ...strict(15, '15 minutes') }, async (request) => {
    const { code } = z.object({ code: sixDigitCodeSchema }).parse(request.body);
    return { recoveryCodes: await confirmTotp(currentUser(request), code, request.ip) };
  });

  /** Zweite Stufe ausschalten – nur mit dem aktuellen Passwort bzw. Code oder einem Wiederherstellungscode */
  app.post('/account/two-factor/disable', { preHandler: requireAuth, ...strict(15, '15 minutes') }, async (request) => {
    await disableSecondFactor(currentUser(request), secondFactorSchema.parse(request.body), request.ip);
    return { ok: true };
  });

  /* ------------------------------------------------------------ Beta-Programm */

  /** Hauptseite: Wechsel auf die Beta-Instanz bestätigen → Einmal-Ticket (nur mit Beta-Zugang) */
  app.post('/beta/enter', { preHandler: requireAuth, ...strict(20, '15 minutes') }, async (request) => {
    return createBetaTicket(currentUser(request), request.ip);
  });

  /** Beta-Instanz: Ticket einlösen → Sitzung für die Beta-Seite (prüft die Freigabe erneut) */
  app.post('/beta/session', strict(20, '15 minutes'), async (request, reply) => {
    const { ticket } = z.object({ ticket: z.string().min(20).max(400) }).parse(request.body);
    const user = await redeemBetaTicket(ticket);
    const session = await createSession(user.id, { ip: request.ip, userAgent: request.headers['user-agent'] });
    setSessionCookie(reply, session.token, session.expiresAt);
    return { ok: true, user: toUserDTO(user) };
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
    if (!identityConfirmed(user)) throw Errors.forbidden(L('Bitte melde dich zuerst mit Discord an oder bestätige deine E-Mail-Adresse.', 'Please sign in with Discord or confirm your email address first.'));
    if (user.pteroUserId) throw new ApiError(409, 'panel_already_linked', L('Dein Panel-Zugang ist bereits eingerichtet.', 'Your panel access is already set up.'));
    let existing: boolean;
    try {
      ({ existing } = await createPanelAccount(user, input.username, input.password, request.ip));
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
    // Nichts erstellt, weil die Discord-Pflicht noch nicht erfüllt ist → die Website zeigt „Mit Discord verbinden“
    const gate = activated.length === 0 ? await discordGate(fresh) : { ok: true as const };
    return { user: toUserDTO(fresh), existingPanelAccount: existing, serversCreated: activated.length, panelUrl: panelPublicUrl, discordBlocked: gate.ok ? null : gate.reason };
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
