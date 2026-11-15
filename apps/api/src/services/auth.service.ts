/**
 * Konten ohne Passwort auf der Website:
 *  – Server anfordern → E-Mail-Link → Bestätigung + Anmeldung
 *  – Später anmelden per E-Mail-Link („Magic Link“)
 * Das einzige Passwort ist das des Pterodactyl-Panels; es wird nur an
 * Pterodactyl übergeben und nie von uns gespeichert.
 */
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { localePath, type Locale, type StartInput, type UserDTO, type VerifyNext, type WaitlistInfo } from '@chfree/shared';
import { env } from '../env';
import { affectedRows, db } from '../db/client';
import { emailTokens, servers, users, type User } from '../db/schema';
import { encryptField, generateToken, sha256, uuid } from '../lib/crypto';
import { Errors, L } from '../lib/errors';
import { isAdmin } from '../plugins/auth';
import { audit } from './audit.service';
import { sendMail } from './mail/mailer';
import { loginMail, verifyServerMail, verifyWaitlistMail, type MailContent } from './mail/templates';
import { getSettings } from './settings.service';
import { confirmWaitlist, hasWaitlistEntry, waitlistForUser } from './waitlist.service';
import { rememberUserLocale } from './locale.service';
import { linkExistingPanelAccount } from './provisioning.service';
import { activatePendingServers, assertConfigAvailable, countOwnedServers, registrationClosed, savePendingServer } from './server.service';

type TokenType = 'verify_email' | 'login';

const TTL: Record<TokenType, number> = {
  verify_email: 24 * 60 * 60 * 1000,
  login: 30 * 60 * 1000,
};
/** Mindestabstand zwischen zwei Mails derselben Art an dieselbe Adresse */
const RESEND_COOLDOWN_MS = 45 * 1000;

export function toUserDTO(user: User): UserDTO {
  return {
    id: user.id,
    email: user.email,
    emailVerified: !!user.emailVerifiedAt,
    panelLinked: !!user.pteroUserId,
    panelUsername: user.pteroUsername,
    role: isAdmin(user) ? 'admin' : 'user',
    locale: user.locale,
    createdAt: user.createdAt.toISOString(),
  };
}

async function findUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user;
}

export async function getUser(id: string): Promise<User> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw Errors.notFound();
  return user;
}

/** Erstellt ein Token (ältere, unbenutzte derselben Art werden entwertet). null = Cooldown aktiv. */
async function issueToken(userId: string, type: TokenType): Promise<string | null> {
  const now = new Date();
  const [last] = await db
    .select({ createdAt: emailTokens.createdAt })
    .from(emailTokens)
    .where(and(eq(emailTokens.userId, userId), eq(emailTokens.type, type)))
    .orderBy(desc(emailTokens.createdAt))
    .limit(1);
  if (last && now.getTime() - last.createdAt.getTime() < RESEND_COOLDOWN_MS) return null;

  await db
    .update(emailTokens)
    .set({ usedAt: now })
    .where(and(eq(emailTokens.userId, userId), eq(emailTokens.type, type), isNull(emailTokens.usedAt)));
  const token = generateToken();
  await db.insert(emailTokens).values({ id: uuid(), userId, type, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + TTL[type]) });
  return token;
}

/** Löst ein Token genau einmal ein (atomar über usedAt IS NULL). */
async function consumeToken(token: string): Promise<{ userId: string; type: TokenType }> {
  const now = new Date();
  const [row] = await db.select().from(emailTokens).where(eq(emailTokens.tokenHash, sha256(token))).limit(1);
  const invalid = () => Errors.badRequest(
      'invalid_token',
      L('Der Link ist ungültig, abgelaufen oder wurde bereits verwendet.', 'This link is invalid, has expired or has already been used.'),
    );
  if (!row || row.usedAt || row.expiresAt <= now) throw invalid();
  const res = await db
    .update(emailTokens)
    .set({ usedAt: now })
    .where(and(eq(emailTokens.id, row.id), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, now)));
  if (affectedRows(res) !== 1) throw invalid();
  return { userId: row.userId, type: row.type };
}

const link = (token: string, locale: Locale) => `${env.APP_URL}${localePath(locale, 'verify', { token })}`;

const mailFailed = () =>
  Errors.unavailable(
    L(
      'Die E-Mail konnte gerade nicht gesendet werden. Bitte versuche es in ein paar Minuten erneut.',
      'The email could not be sent right now. Please try again in a few minutes.',
    ),
  );

/**
 * Erstellt ein Token und verschickt die Mail. Schlägt der Versand fehl, wird das Token
 * wieder entfernt – so greift die Sperre für erneutes Senden nicht und der Nutzer kann es gleich nochmal versuchen.
 */
async function sendTokenMail(user: User, type: TokenType, build: (token: string) => MailContent): Promise<void> {
  const token = await issueToken(user.id, type);
  if (!token) return;
  try {
    await sendMail(user.email, build(token));
  } catch (err) {
    await db.delete(emailTokens).where(eq(emailTokens.tokenHash, sha256(token)));
    throw err;
  }
}

/**
 * Server anfordern (ohne Anmeldung). Antwortet immer gleich – verrät also nicht,
 * ob es die E-Mail-Adresse schon gibt.
 */
export async function requestServer(input: StartInput, meta: { ip?: string; locale: Locale }): Promise<void> {
  const settings = await getSettings();
  if (settings.registration.mode === 'closed') throw registrationClosed();
  const waitlistMode = settings.registration.mode === 'preregistration';
  await assertConfigAvailable(input);

  let user = await findUserByEmail(input.email);
  if (!user) {
    const id = uuid();
    await db
      .insert(users)
      .values({ id, email: input.email, acceptedTermsAt: new Date(), locale: meta.locale, registrationIp: encryptField(meta.ip?.slice(0, 64)) })
      .onConflictDoNothing();
    user = await findUserByEmail(input.email);
    if (!user) throw new Error('Benutzer konnte nicht angelegt werden');
    await audit({ userId: user.id, actor: 'user', action: 'account.created', message: 'Server angefordert – Konto angelegt', ip: meta.ip });
  }
  if (user.status !== 'active') return;
  await rememberUserLocale(user, meta.locale);

  // Hat der Nutzer schon einen Server (bzw. in der Early-Access-Phase einen Wartelisten-Platz), schicken wir nur einen Anmeldelink.
  const owned = await countOwnedServers(user.id);
  if (owned >= settings.registration.maxServersPerUser || (waitlistMode && (owned > 0 || (await hasWaitlistEntry(user.id))))) {
    await sendTokenMail(user, 'login', (token) => loginMail(link(token, meta.locale), meta.locale)).catch(() => {
      throw mailFailed();
    });
    return;
  }

  if (waitlistMode) {
    await savePendingServer(user.id, input, 'waitlist');
    // Bereits bestätigte Nutzer bekommen ihren Platz sofort, alle anderen nach dem Klick auf den Link
    if (user.emailVerifiedAt) await confirmWaitlist(user.id);
    await sendTokenMail(user, user.emailVerifiedAt ? 'login' : 'verify_email', (token) => verifyWaitlistMail(input.name, link(token, meta.locale), meta.locale)).catch(() => {
      throw mailFailed();
    });
    return;
  }

  await savePendingServer(user.id, input);
  await sendTokenMail(user, 'verify_email', (token) => verifyServerMail(input.name, link(token, meta.locale), meta.locale)).catch(() => {
    throw mailFailed();
  });
}

export async function requestLoginLink(email: string, locale: Locale): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user || user.status !== 'active') return;
  await rememberUserLocale(user, locale);
  // Fehler werden im Route-Handler nur geloggt – die Antwort verrät nicht, ob die Adresse existiert
  await sendTokenMail(user, user.emailVerifiedAt ? 'login' : 'verify_email', (token) => loginMail(link(token, locale), locale));
}

/**
 * Klick auf einen E-Mail-Link: bestätigt die Adresse, meldet an und bestimmt den nächsten Schritt.
 */
export async function verifyToken(
  token: string,
  meta: { ip?: string; locale: Locale },
): Promise<{ user: User; next: VerifyNext; existingPanelAccount: boolean; waitlist: WaitlistInfo | null }> {
  const { userId } = await consumeToken(token);
  await db.update(users).set({ emailVerifiedAt: new Date(), lastLoginAt: new Date() }).where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
  // IP des letzten Logins – nur verschlüsselt gespeichert
  await db
    .update(users)
    .set({ lastLoginAt: new Date(), ...(meta.ip ? { lastLoginIp: encryptField(meta.ip.slice(0, 64)) } : {}) })
    .where(eq(users.id, userId));
  let user = await getUser(userId);
  if (user.status !== 'active') {
    throw Errors.forbidden(L('Dein Account ist gesperrt. Bitte kontaktiere den Support.', 'Your account is locked. Please contact support.'));
  }
  await rememberUserLocale(user, meta.locale);
  user = { ...user, locale: meta.locale };

  const pending = await db
    .select({ id: servers.id })
    .from(servers)
    .where(and(eq(servers.userId, user.id), eq(servers.status, 'pending')));

  // Early Access: Platz in der Warteliste vergeben (erst jetzt, nach der Bestätigung)
  await confirmWaitlist(user.id);
  const waitlist = await waitlistForUser(user.id);

  let existingPanelAccount = false;
  if (!user.pteroUserId && (pending.length > 0 || waitlist)) {
    // Kunden mit bestehendem Panel-Konto (gleiche, jetzt bestätigte E-Mail) direkt verknüpfen
    existingPanelAccount = await linkExistingPanelAccount(user, meta.ip).catch(() => false);
    user = await getUser(userId);
  }

  await audit({ userId, actor: 'user', action: 'auth.link_used', message: 'Per E-Mail-Link angemeldet', ip: meta.ip });

  if (pending.length > 0) {
    if (!user.pteroUserId) return { user, next: 'panel_setup', existingPanelAccount, waitlist: null };
    await activatePendingServers(user, meta.ip);
    return { user, next: 'done', existingPanelAccount, waitlist: null };
  }
  if (waitlist) return { user, next: 'waitlist', existingPanelAccount, waitlist };
  return { user, next: 'overview', existingPanelAccount, waitlist: null };
}
