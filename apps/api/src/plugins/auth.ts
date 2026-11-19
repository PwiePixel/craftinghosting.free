import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { adminEmails, cookieSecure, env } from '../env';
import type { User } from '../db/schema';
import { Errors, L } from '../lib/errors';
import { getSessionUser } from '../services/session.service';
import { lockedError } from '../services/sanction-gate';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    sessionId: string | null;
  }
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date, persistent = false) {
  reply.setCookie(env.SESSION_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax',
    domain: env.COOKIE_DOMAIN || undefined,
    // Ohne Ablaufdatum löscht der Browser das Cookie beim Schließen → erneute Anmeldung nötig
    // (außer mit „Angemeldet bleiben“ im Kontobereich bzw. SESSION_PERSISTENT)
    ...(env.SESSION_PERSISTENT || persistent ? { expires: expiresAt } : {}),
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(env.SESSION_COOKIE_NAME, {
    path: '/',
    domain: env.COOKIE_DOMAIN || undefined,
  });
}

export const authPlugin = fp(async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.addHook('preHandler', async (request, reply) => {
    const token = request.cookies[env.SESSION_COOKIE_NAME];
    if (!token) return;
    const session = await getSessionUser(token);
    if (!session) {
      clearSessionCookie(reply);
      return;
    }
    // Beta-Instanz: Eine Sitzung zählt nur, solange der Nutzer (noch) Beta-Zugang hat – ein Entzug wirkt sofort
    if (env.BETA_MODE && !canUseBeta(session.user)) {
      clearSessionCookie(reply);
      return;
    }
    request.user = session.user;
    request.sessionId = session.sessionId;
    if (session.refreshed && (env.SESSION_PERSISTENT || session.persistent)) setSessionCookie(reply, token, session.expiresAt, session.persistent);
  });
});

export async function requireAuth(request: FastifyRequest) {
  if (!request.user) throw Errors.unauthorized();
  if (request.user.status !== 'active') throw lockedError(request.user);
}

export function currentUser(request: FastifyRequest): User {
  if (!request.user) throw Errors.unauthorized();
  return request.user;
}

/** Admin: role = admin in der Datenbank oder E-Mail in ADMIN_EMAILS */
export function isAdmin(user: Pick<User, 'role' | 'email'> | null): boolean {
  return !!user && (user.role === 'admin' || adminEmails.has(user.email.toLowerCase()));
}

/** Beta-Zugang: vom Admin freigeschaltet (users.beta) – Admins dürfen immer */
export function canUseBeta(user: Pick<User, 'role' | 'email' | 'beta' | 'status'> | null): boolean {
  return !!user && user.status === 'active' && (user.beta || isAdmin(user));
}

/** Nur für Admins – andere bekommen 404 (der Bereich wird nicht verraten). */
export async function requireAdmin(request: FastifyRequest) {
  // Auch ohne Anmeldung 404 statt 401 – so verrät die API nicht, dass es den Bereich gibt
  if (!request.user || request.user.status !== 'active' || !isAdmin(request.user)) throw Errors.notFound();
}
