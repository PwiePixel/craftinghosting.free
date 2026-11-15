/**
 * Beta-Programm: Übergang von der Hauptseite auf die Beta-Instanz.
 *
 * Die Beta-Instanz ist eine zweite Installation mit DERSELBEN Datenbank. Dort kann man sich nicht anmelden –
 * hinein kommt nur, wer auf der Hauptseite angemeldet ist und vom Admin Beta-Zugang bekommen hat:
 *
 *  1. Hauptseite, „Meine Server“ → Beta → Bestätigen  →  POST /beta/enter prüft die Freigabe und stellt ein
 *     Einmal-Ticket aus (signiert, 2 Minuten gültig).
 *  2. Der Browser wechselt mit dem Ticket auf die Beta-Instanz  →  POST /beta/session prüft Signatur, Ablauf,
 *     Einmaligkeit und ERNEUT die Freigabe und legt erst dann eine Sitzung für die Beta-Seite an.
 *
 * Wird die Freigabe entzogen, endet der Zugang sofort: Die Beta-Instanz prüft sie bei jeder Anfrage (plugins/auth.ts).
 */
import { eq } from 'drizzle-orm';
import { affectedRows, db } from '../db/client';
import { dedupeMarks, users, type User } from '../db/schema';
import { env } from '../env';
import { generateToken, signToken, verifySignedToken } from '../lib/crypto';
import { Errors, L } from '../lib/errors';
import { canUseBeta } from '../plugins/auth';
import { audit } from './audit.service';

const PURPOSE = 'beta-enter';
const TICKET_TTL_MS = 2 * 60_000;

export const betaUrl = () => (env.BETA_URL || '').replace(/\/$/, '') || null;
export const mainUrl = () => (env.MAIN_URL || '').replace(/\/$/, '') || null;

export const notInBeta = () => Errors.forbidden(L('Du bist nicht im Beta-Programm.', 'You are not part of the beta programme.'));

/** Hauptseite: Ticket für die Beta-Instanz ausstellen – nur für freigeschaltete Nutzer */
export async function createBetaTicket(user: User, ip?: string): Promise<{ url: string }> {
  const target = betaUrl();
  if (env.BETA_MODE || !target) throw Errors.notFound();
  if (!canUseBeta(user)) throw notInBeta();
  const ticket = signToken(`${user.id}:${Date.now() + TICKET_TTL_MS}:${generateToken().slice(0, 16)}`, PURPOSE);
  await audit({ userId: user.id, actor: 'user', action: 'beta.enter', message: 'Wechsel auf die Beta-Instanz bestätigt', ip });
  return { url: `${target}/beta-access?ticket=${encodeURIComponent(ticket)}` };
}

/** Beta-Instanz: Ticket einlösen → Nutzer, für den eine Sitzung angelegt werden darf */
export async function redeemBetaTicket(ticket: string): Promise<User> {
  const invalid = () => Errors.badRequest('invalid_ticket', L('Dieser Link ist abgelaufen. Öffne die Beta-Seite bitte erneut über „Meine Server“.', 'This link has expired. Please open the beta site again via “My servers”.'));
  if (!env.BETA_MODE) throw Errors.notFound();
  const value = verifySignedToken(ticket, PURPOSE);
  if (!value) throw invalid();
  const [userId, expires, nonce] = value.split(':');
  if (!userId || !nonce || !(Number(expires) > Date.now())) throw invalid();
  // Jedes Ticket genau einmal
  const once = await db.insert(dedupeMarks).values({ key: `beta-ticket:${nonce}`.slice(0, 191) }).onConflictDoNothing();
  if (affectedRows(once) !== 1) throw invalid();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  // Die Freigabe wird hier – auf der Beta-Instanz – noch einmal geprüft
  if (!user || !canUseBeta(user)) throw notInBeta();
  await audit({ userId: user.id, actor: 'user', action: 'beta.session', message: 'Beta-Instanz geöffnet' });
  return user;
}
