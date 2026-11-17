/**
 * Kurzlebige Cookies für die Registrierung und Anmeldung über Discord.
 *  – chf_signup: die Server-Anfrage (Paket, Name, E-Mail …), signiert – sie wird nach der Rückkehr von Discord gespeichert
 *  – chf_oauth:  Zufallswert, der die Anmeldung an diesen Browser bindet (Schutz vor untergeschobenen Links)
 */
import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { startSchema, type Locale, type StartInput } from '@chfree/shared';
import { cookieSecure, env } from '../env';
import { signToken, verifySignedToken } from './crypto';

const SIGNUP_COOKIE = 'chf_signup';
const OAUTH_COOKIE = 'chf_oauth';
const PURPOSE = 'signup-intent';
const TTL_SECONDS = 30 * 60;

const options = { path: '/', httpOnly: true, secure: cookieSecure, sameSite: 'lax' as const, domain: env.COOKIE_DOMAIN || undefined };

export interface SignupIntent {
  input: StartInput;
  locale: Locale;
  nonce: string;
}

export const newNonce = () => randomBytes(16).toString('hex');

export function setSignupCookie(reply: FastifyReply, intent: SignupIntent): void {
  const payload = Buffer.from(JSON.stringify({ ...intent, exp: Date.now() + TTL_SECONDS * 1000 })).toString('base64url');
  reply.setCookie(SIGNUP_COOKIE, signToken(payload, PURPOSE), { ...options, maxAge: TTL_SECONDS });
}

/** null = fehlt, abgelaufen oder verändert */
export function readSignupCookie(request: FastifyRequest): SignupIntent | null {
  const raw = request.cookies[SIGNUP_COOKIE];
  const payload = raw ? verifySignedToken(raw, PURPOSE) : null;
  if (!payload) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { input?: unknown; locale?: unknown; nonce?: unknown; exp?: unknown };
    if (typeof data.exp !== 'number' || data.exp < Date.now() || typeof data.nonce !== 'string') return null;
    const input = startSchema.safeParse(data.input);
    if (!input.success) return null;
    return { input: input.data, locale: data.locale === 'en' ? 'en' : 'de', nonce: data.nonce };
  } catch {
    return null;
  }
}

export function setOAuthCookie(reply: FastifyReply, nonce: string): void {
  reply.setCookie(OAUTH_COOKIE, nonce, { ...options, maxAge: TTL_SECONDS });
}

export const readOAuthCookie = (request: FastifyRequest): string | null => request.cookies[OAUTH_COOKIE] ?? null;

export function clearSignupCookies(reply: FastifyReply): void {
  reply.clearCookie(SIGNUP_COOKIE, options);
  reply.clearCookie(OAUTH_COOKIE, options);
}
