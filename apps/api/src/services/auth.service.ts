/**
 * Anmeldung ohne Pflicht-Passwort:
 *  – Registrieren und anmelden über Discord (sobald die Discord-Anbindung eingerichtet ist): Das Discord-Konto ist
 *    die Identität. Die E-Mail-Adresse wird angegeben, ihre Bestätigung per Code ist freiwillig
 *    (Voraussetzung, um Partner zu werden).
 *  – Ohne eingerichtete Discord-Anbindung wie früher: Server anfordern → Code per E-Mail → Bestätigung + Anmeldung
 *  – Bestehende Konten können sich weiter mit E-Mail-Adresse und Code anmelden
 *  – Freiwillige zweite Stufe: eigenes Passwort oder Authenticator-App (two-factor.service.ts)
 * Das Passwort des Pterodactyl-Panels wird nur an Pterodactyl übergeben und nie von uns gespeichert.
 */
import { discordGate } from '../discord/service';
import { and, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { findPlan, isEmailBlocked, serverLimitBlock, type Locale, type StartInput, type TwoFactorMethod, type UserDTO, type VerifyNext, type WaitlistInfo } from '@chfree/shared';
import { affectedRows, db, isUniqueViolation } from '../db/client';
import { emailTokens, servers, users, type User } from '../db/schema';
import { generateCode, hashCode } from '../lib/auth-crypto';
import { encryptField, sha256, signToken, uuid, verifySignedToken } from '../lib/crypto';
import { Errors, L } from '../lib/errors';
import { canUseBeta, isAdmin } from '../plugins/auth';
import { audit } from './audit.service';
import { sendMail } from './mail/mailer';
import { CODE_MINUTES, loginMail, verifyEmailMail, verifyServerMail, verifyWaitlistMail, type MailContent } from './mail/templates';
import { isRecipientFailure, noteMailDelivered, noteMailFailure, resetMailHealth } from './mail/health';
import { pterodactyl } from '../pterodactyl';
import { PterodactylError } from '../pterodactyl/types';
import { activateSignupSubscription, subscribe } from './newsletter.service';
import { getSettings } from './settings.service';
import { checkSecondFactor, type SecondFactorInput } from './two-factor.service';
import { confirmWaitlist, hasWaitlistEntry, waitlistForUser } from './waitlist.service';
import { rememberUserLocale } from './locale.service';
import { linkExistingPanelAccount } from './provisioning.service';
import { bonusSlotsFor } from '../discord/rewards';
import { activatePendingServers, assertConfigAvailable, countOwnedServers, ownedServerRefs, registrationClosed, savePendingServer } from './server.service';

type TokenType = 'verify_email' | 'login';

const TTL: Record<TokenType, number> = {
  verify_email: CODE_MINUTES.verify_email * 60_000,
  login: CODE_MINUTES.login * 60_000,
};
/** Mindestabstand zwischen zwei Mails an dieselbe Adresse */
const RESEND_COOLDOWN_MS = 45 * 1000;
/** Nach so vielen falschen Eingaben ist ein Code verbraucht – sechs Ziffern lassen sich so nicht durchprobieren */
const MAX_CODE_ATTEMPTS = 5;

export function toUserDTO(user: User): UserDTO {
  return {
    id: user.id,
    email: user.email,
    emailVerified: !!user.emailVerifiedAt,
    emailUndeliverable: !!user.emailUndeliverableAt,
    panelLinked: !!user.pteroUserId,
    panelUsername: user.pteroUsername,
    role: isAdmin(user) ? 'admin' : 'user',
    beta: canUseBeta(user),
    locale: user.locale,
    discord: user.discordId ? { id: user.discordId, username: user.discordUsername ?? '' } : null,
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

/** Der Hash ist an den Account gebunden: derselbe Code bei zwei Personen ergibt zwei verschiedene Einträge */
const codeHash = (userId: string, code: string) => hashCode(code, `login:${userId}`);

/** Erstellt einen Code (ältere, unbenutzte werden entwertet – es gilt immer nur der neueste). null = Cooldown aktiv. */
async function issueCode(userId: string, type: TokenType): Promise<string | null> {
  const now = new Date();
  // Sperre für erneutes Senden: nur solange ein frischer, noch unbenutzter Code im Postfach liegt.
  // Wer sich gerade angemeldet hat und es gleich noch einmal tut, bekommt sofort einen neuen.
  const [last] = await db
    .select({ createdAt: emailTokens.createdAt })
    .from(emailTokens)
    .where(and(eq(emailTokens.userId, userId), isNull(emailTokens.usedAt)))
    .orderBy(desc(emailTokens.createdAt))
    .limit(1);
  if (last && now.getTime() - last.createdAt.getTime() < RESEND_COOLDOWN_MS) return null;

  await db.update(emailTokens).set({ usedAt: now }).where(and(eq(emailTokens.userId, userId), isNull(emailTokens.usedAt)));
  const code = generateCode();
  await db.insert(emailTokens).values({ id: uuid(), userId, type, tokenHash: codeHash(userId, code), expiresAt: new Date(now.getTime() + TTL[type]) });
  return code;
}

const invalidCode = () => {
  const msg = L('Der Code ist falsch oder abgelaufen. Bitte prüfe ihn oder fordere einen neuen an.', 'The code is wrong or has expired. Please check it or request a new one.');
  return Errors.badRequest('invalid_code', msg, { code: msg });
};

/** Löst einen Code genau einmal ein. Die Antwort verrät nicht, ob es die E-Mail-Adresse gibt. */
async function consumeCode(email: string, code: string): Promise<{ userId: string }> {
  const user = await findUserByEmail(email);
  if (!user) throw invalidCode();
  const now = new Date();
  const [row] = await db
    .select()
    .from(emailTokens)
    .where(and(eq(emailTokens.userId, user.id), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, now)))
    .orderBy(desc(emailTokens.createdAt))
    .limit(1);
  if (!row) throw invalidCode();
  if (row.tokenHash !== codeHash(user.id, code)) {
    const attempts = row.attempts + 1;
    await db
      .update(emailTokens)
      .set({ attempts: sql`${emailTokens.attempts} + 1`, ...(attempts >= MAX_CODE_ATTEMPTS ? { usedAt: now } : {}) })
      .where(eq(emailTokens.id, row.id));
    if (attempts >= MAX_CODE_ATTEMPTS) {
      const msg = L('Zu viele falsche Eingaben. Bitte fordere einen neuen Code an.', 'Too many wrong attempts. Please request a new code.');
      throw Errors.badRequest('code_locked', msg, { code: msg });
    }
    throw invalidCode();
  }
  const res = await db
    .update(emailTokens)
    .set({ usedAt: now })
    .where(and(eq(emailTokens.id, row.id), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, now)));
  if (affectedRows(res) !== 1) throw invalidCode();
  return { userId: user.id };
}

/** Links aus E-Mails, die vor der Umstellung auf Codes verschickt wurden, bleiben bis zum Ablauf gültig. */
async function consumeLegacyLink(token: string): Promise<{ userId: string }> {
  const now = new Date();
  const [row] = await db.select().from(emailTokens).where(eq(emailTokens.tokenHash, sha256(token))).limit(1);
  const invalid = () =>
    Errors.badRequest('invalid_token', L('Der Link ist ungültig, abgelaufen oder wurde bereits verwendet. Bitte melde dich neu an – du bekommst dann einen Code.', 'This link is invalid, has expired or has already been used. Please sign in again – you will receive a code.'));
  if (!row || row.usedAt || row.expiresAt <= now) throw invalid();
  const res = await db
    .update(emailTokens)
    .set({ usedAt: now })
    .where(and(eq(emailTokens.id, row.id), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, now)));
  if (affectedRows(res) !== 1) throw invalid();
  return { userId: row.userId };
}

const mailFailed = () =>
  Errors.unavailable(
    L(
      'Die E-Mail konnte gerade nicht gesendet werden. Bitte versuche es in ein paar Minuten erneut.',
      'The email could not be sent right now. Please try again in a few minutes.',
    ),
  );

/**
 * Erstellt einen Code und verschickt die Mail. Schlägt der Versand fehl, wird der Code
 * wieder entfernt – so greift die Sperre für erneutes Senden nicht und der Nutzer kann es gleich nochmal versuchen.
 */
async function sendCodeMail(user: User, type: TokenType, build: (code: string) => MailContent): Promise<void> {
  const code = await issueCode(user.id, type);
  if (!code) return;
  try {
    await sendMail(user.email, build(code));
  } catch (err) {
    await db.delete(emailTokens).where(eq(emailTokens.tokenHash, codeHash(user.id, code)));
    throw err;
  }
}

const emailBlocked = () => {
  const msg = L('Diese E-Mail-Adresse kann nicht verwendet werden. Bitte nimm eine andere.', 'This email address cannot be used. Please use a different one.');
  return Errors.badRequest('email_blocked', msg, { email: msg });
};

/** Vorprüfung einer Server-Anfrage: Registrierung offen, Adresse nicht gesperrt, Paket verfügbar */
export async function prepareSignup(input: StartInput) {
  const settings = await getSettings();
  if (settings.registration.mode === 'closed') throw registrationClosed();
  // Sperrliste (Admin → Einstellungen): gesperrte Adressen/Domains und Wegwerf-Anbieter
  if (isEmailBlocked(input.email, settings.blocklist)) throw emailBlocked();
  await assertConfigAvailable(input);
  return settings;
}

/* ------------------------------------------------------------ Registrierung und Anmeldung über Discord */

type DiscordIdentity = { id: string; username: string };
export type DiscordAccount = { ok: true; user: User; created: boolean } | { ok: false; reason: 'email_taken' | 'locked' | 'taken' | 'no_account' };

async function findUserByDiscord(discordId: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.discordId, discordId)).limit(1);
  return user;
}

/** Anmeldung: Das Discord-Konto muss schon zu einem Account gehören */
export async function accountForDiscordLogin(discord: DiscordIdentity): Promise<DiscordAccount> {
  const user = await findUserByDiscord(discord.id);
  if (!user) return { ok: false, reason: 'no_account' };
  if (user.status !== 'active') return { ok: false, reason: 'locked' };
  return { ok: true, user, created: false };
}

/**
 * Registrierung: Das Discord-Konto ist die Identität.
 *  – Gehört es schon zu einem Account, ist das eine Anmeldung (die angegebene E-Mail-Adresse spielt dann keine Rolle).
 *  – Sonst entsteht ein Account mit der angegebenen E-Mail-Adresse. Gibt es für sie schon ein noch leeres, nie
 *    bestätigtes Konto ohne Discord, wird es übernommen. Ein bestehendes echtes Konto lässt sich so nicht kapern.
 */
export async function accountForDiscordSignup(discord: DiscordIdentity, email: string, meta: { ip?: string; locale: Locale }): Promise<DiscordAccount> {
  const known = await findUserByDiscord(discord.id);
  if (known) return known.status === 'active' ? { ok: true, user: known, created: false } : { ok: false, reason: 'locked' };
  const link = { discordId: discord.id, discordUsername: discord.username.slice(0, 64), discordLinkedAt: new Date(), discordCustomerRole: false, discordSyncAt: null };
  const byEmail = await findUserByEmail(email);
  try {
    if (byEmail) {
      if (byEmail.discordId || byEmail.emailVerifiedAt || byEmail.pteroUserId) return { ok: false, reason: 'email_taken' };
      if (byEmail.status !== 'active') return { ok: false, reason: 'locked' };
      await db.update(users).set(link).where(and(eq(users.id, byEmail.id), isNull(users.discordId)));
    } else {
      await db.insert(users).values({ id: uuid(), email, acceptedTermsAt: new Date(), locale: meta.locale, registrationIp: encryptField(meta.ip?.slice(0, 64)), ...link });
    }
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: (await findUserByDiscord(discord.id)) ? 'taken' : 'email_taken' };
    throw err;
  }
  const user = await findUserByDiscord(discord.id);
  if (!user) return { ok: false, reason: 'email_taken' };
  await audit({ userId: user.id, actor: 'user', action: 'account.created', message: `Mit Discord registriert (${discord.username}, ${discord.id})`, ip: meta.ip });
  return { ok: true, user, created: true };
}

/**
 * Nach der Registrierung über Discord: die Server-Anfrage speichern (soweit die Grenzen es erlauben) und die
 * Bestätigungsmail schicken. Die Bestätigung ist freiwillig – schlägt der Versand fehl, geht es trotzdem weiter.
 */
export async function finishDiscordSignup(user: User, input: StartInput, meta: { ip?: string; locale: Locale }): Promise<void> {
  const settings = await getSettings();
  await rememberUserLocale(user, meta.locale);
  if (input.newsletter && settings.newsletter.enabled) {
    await subscribe(user.email, meta.locale, { ip: meta.ip, source: 'signup', sendMail: false }).catch(() => {});
    if (user.emailVerifiedAt) await activateSignupSubscription(user.email).catch(() => {});
  }
  const waitlistMode = settings.registration.mode === 'preregistration';
  const owned = await countOwnedServers(user.id);
  const limitBlock = serverLimitBlock(settings.registration.limits, await ownedServerRefs(user.id), findPlan(settings, input.planId)?.kind ?? 'minecraft', input.planId, await bonusSlotsFor(user));
  const [open] = await db.select({ id: servers.id }).from(servers).where(and(eq(servers.userId, user.id), eq(servers.status, 'pending'))).limit(1);
  // Grenze erreicht oder schon eine offene Anfrage (z. B. doppelt abgeschickt): Es bleibt bei der Anmeldung
  if (settings.registration.mode !== 'closed' && limitBlock === null && !open && !(waitlistMode && (owned > 0 || (await hasWaitlistEntry(user.id))))) {
    await assertConfigAvailable(input);
    await savePendingServer(user.id, input, waitlistMode ? 'waitlist' : 'pending');
    if (waitlistMode) await confirmWaitlist(user.id);
  }
  if (!user.emailVerifiedAt && !user.emailUndeliverableAt) {
    await sendEmailVerification(user, meta.locale).catch(() => {});
  }
}

/* ------------------------------------------------------------ E-Mail-Adresse bestätigen und ändern (freiwillig) */

const emailUnreachable = () =>
  Errors.badRequest(
    'email_unreachable',
    L('An diese E-Mail-Adresse lässt sich nichts zustellen – der Mailserver lehnt sie ab. Bitte ändere deine E-Mail-Adresse.', 'Email cannot be delivered to this address – the mail server rejects it. Please change your email address.'),
  );

/** Schickt den Code zum Bestätigen der E-Mail-Adresse */
export async function sendEmailVerification(user: User, locale: Locale): Promise<void> {
  if (user.emailVerifiedAt) throw Errors.conflict('already_verified', L('Deine E-Mail-Adresse ist schon bestätigt.', 'Your email address is already confirmed.'));
  if (user.emailUndeliverableAt) throw emailUnreachable();
  const code = await issueCode(user.id, 'verify_email');
  if (!code) throw Errors.badRequest('cooldown', L('Wir haben dir gerade erst einen Code geschickt. Bitte warte kurz, bevor du einen neuen anforderst.', 'We have just sent you a code. Please wait a moment before requesting a new one.'));
  try {
    await sendMail(user.email, verifyEmailMail(code, locale));
    await noteMailDelivered(user.id);
  } catch (err) {
    await db.delete(emailTokens).where(eq(emailTokens.tokenHash, codeHash(user.id, code)));
    // Lehnt der Mailserver die Adresse (zum zweiten Mal) ab, gilt sie als nicht erreichbar – das Team wird informiert
    const unreachable = await noteMailFailure(user.id, err).catch(() => false);
    throw unreachable || isRecipientFailure(err) ? emailUnreachable() : mailFailed();
  }
}

/** Code aus der Bestätigungsmail einlösen */
export async function confirmEmail(user: User, code: string, ip?: string): Promise<User> {
  if (user.emailVerifiedAt) return user;
  await consumeCode(user.email, code);
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
  await resetMailHealth(user.id);
  await activateSignupSubscription(user.email).catch(() => {});
  await audit({ userId: user.id, actor: 'user', action: 'account.email_verified', message: `E-Mail-Adresse ${user.email} bestätigt`, ip });
  return getUser(user.id);
}

/**
 * E-Mail-Adresse ändern (z. B. vertippt oder nicht erreichbar). Die neue Adresse ist unbestätigt; das Panel-Konto
 * bekommt sie ebenfalls. Nur für Accounts mit Discord – so bleibt die Anmeldung in jedem Fall möglich.
 */
export async function changeEmail(user: User, email: string, meta: { ip?: string; locale: Locale }): Promise<User> {
  if (!user.discordId) {
    throw Errors.forbidden(L('Verknüpfe zuerst dein Discord-Konto – danach kannst du deine E-Mail-Adresse ändern.', 'Link your Discord account first – then you can change your email address.'));
  }
  const taken = () => {
    const msg = L('Diese E-Mail-Adresse wird schon von einem anderen Konto verwendet.', 'This email address is already used by another account.');
    return Errors.badRequest('email_taken', msg, { email: msg });
  };
  if (email === user.email) {
    const msg = L('Das ist bereits deine E-Mail-Adresse.', 'This already is your email address.');
    throw Errors.badRequest('email_same', msg, { email: msg });
  }
  if (isEmailBlocked(email, (await getSettings()).blocklist)) throw emailBlocked();
  if (await findUserByEmail(email)) throw taken();
  if (user.pteroUserId) {
    try {
      await pterodactyl().updateUserEmail(user.pteroUserId, email);
    } catch (err) {
      if (err instanceof PterodactylError && err.status === 422) {
        const msg = L('Diese E-Mail-Adresse wird im Panel schon von einem anderen Konto verwendet.', 'This email address is already used by another account in the panel.');
        throw Errors.badRequest('email_taken', msg, { email: msg });
      }
      throw Errors.unavailable(L('Die E-Mail-Adresse konnte im Panel gerade nicht geändert werden. Bitte versuche es später erneut.', 'The email address could not be changed in the panel right now. Please try again later.'));
    }
  }
  try {
    await db.update(users).set({ email, emailVerifiedAt: null, emailFailCount: 0, emailUndeliverableAt: null }).where(eq(users.id, user.id));
  } catch (err) {
    if (isUniqueViolation(err)) throw taken();
    throw err;
  }
  // Codes an die alte Adresse gelten nicht mehr
  await db.update(emailTokens).set({ usedAt: new Date() }).where(and(eq(emailTokens.userId, user.id), isNull(emailTokens.usedAt)));
  await audit({ userId: user.id, actor: 'user', action: 'account.email_changed', message: `E-Mail-Adresse geändert: ${user.email} → ${email}`, ip: meta.ip });
  const fresh = await getUser(user.id);
  await sendEmailVerification(fresh, meta.locale).catch(() => {});
  return fresh;
}

/**
 * Server anfordern (ohne Anmeldung). Antwortet immer gleich – verrät also nicht,
 * ob es die E-Mail-Adresse schon gibt.
 */
export async function requestServer(input: StartInput, meta: { ip?: string; locale: Locale }): Promise<void> {
  const settings = await prepareSignup(input);
  const waitlistMode = settings.registration.mode === 'preregistration';

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
  // Newsletter angehakt: bei bestätigten Konten sofort aktiv, sonst mit der E-Mail-Bestätigung (kein zweiter Bestätigungslink nötig)
  if (input.newsletter && settings.newsletter.enabled) {
    await subscribe(input.email, meta.locale, { ip: meta.ip, source: 'signup', sendMail: false }).catch(() => {});
    if (user.emailVerifiedAt) await activateSignupSubscription(input.email).catch(() => {});
  }

  // Hat der Nutzer schon einen Server (bzw. in der Early-Access-Phase einen Wartelisten-Platz), schicken wir nur einen Anmeldecode.
  // Die Grenzen gelten je Angebot, zusammen und je Paket (Admin → Einstellungen); auf der Warteliste ist ein Platz pro Person möglich
  const owned = await countOwnedServers(user.id);
  const limitBlock = serverLimitBlock(settings.registration.limits, await ownedServerRefs(user.id), findPlan(settings, input.planId)?.kind ?? 'minecraft', input.planId, await bonusSlotsFor(user));
  if (limitBlock !== null || (waitlistMode && (owned > 0 || (await hasWaitlistEntry(user.id))))) {
    await sendCodeMail(user, 'login', (code) => loginMail(code, meta.locale)).catch(() => {
      throw mailFailed();
    });
    return;
  }

  if (waitlistMode) {
    await savePendingServer(user.id, input, 'waitlist');
    // Bereits bestätigte Nutzer bekommen ihren Platz sofort, alle anderen nach der Eingabe des Codes
    if (user.emailVerifiedAt) await confirmWaitlist(user.id);
    const type = user.emailVerifiedAt ? 'login' : 'verify_email';
    await sendCodeMail(user, type, (code) => verifyWaitlistMail(input.name, code, meta.locale, CODE_MINUTES[type])).catch(() => {
      throw mailFailed();
    });
    return;
  }

  await savePendingServer(user.id, input);
  await sendCodeMail(user, 'verify_email', (code) => verifyServerMail(input.name, code, meta.locale)).catch(() => {
    throw mailFailed();
  });
}

/** Anmeldecode anfordern. Unbekannte Adressen bekommen keine Mail – die Antwort ist trotzdem dieselbe. */
export async function requestLoginCode(email: string, locale: Locale): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user || user.status !== 'active') return;
  await rememberUserLocale(user, locale);
  const type = user.emailVerifiedAt ? 'login' : 'verify_email';
  // Fehler werden im Route-Handler nur geloggt – die Antwort verrät nicht, ob die Adresse existiert
  await sendCodeMail(user, type, (code) => loginMail(code, locale, CODE_MINUTES[type]));
}

type LoginDone = { user: User; next: VerifyNext; existingPanelAccount: boolean; waitlist: WaitlistInfo | null; discordBlocked?: 'not_linked' | 'not_member' | 'unavailable' | null };
export type LoginStep = ({ kind: 'done' } & LoginDone) | { kind: 'two_factor'; method: TwoFactorMethod; ticket: string };

const TWO_FACTOR_PURPOSE = 'two-factor';
const TWO_FACTOR_TTL_MS = 10 * 60_000;

/**
 * Code aus der E-Mail einlösen: bestätigt die Adresse. Ohne zweite Stufe ist man damit angemeldet;
 * mit zweiter Stufe gibt es zunächst nur ein kurzlebiges Ticket für die Eingabe von Passwort bzw. App-Code.
 */
export async function verifyLogin(input: { token: string } | { email: string; code: string }, meta: { ip?: string; locale: Locale }): Promise<LoginStep> {
  const { userId } = 'token' in input ? await consumeLegacyLink(input.token) : await consumeCode(input.email, input.code);
  // Der Code beweist den Zugriff auf das Postfach – die Adresse gilt damit als bestätigt, auch wenn noch die zweite Stufe folgt
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
  const user = await getUser(userId);
  if (user.status !== 'active') {
    throw Errors.forbidden(L('Dein Account ist gesperrt. Bitte kontaktiere den Support.', 'Your account is locked. Please contact support.'));
  }
  if (user.twoFactorMethod) return { kind: 'two_factor', method: user.twoFactorMethod, ticket: twoFactorTicket(userId) };
  return { kind: 'done', ...(await completeLogin(userId, meta)) };
}

/** Kurzlebiges Ticket für die zweite Stufe (nach dem Code per E-Mail oder der Anmeldung über Discord) */
export const twoFactorTicket = (userId: string) => signToken(`${userId}:${Date.now() + TWO_FACTOR_TTL_MS}`, TWO_FACTOR_PURPOSE);

/** Anmeldung über Discord abschließen bzw. nach der Rückkehr von Discord den nächsten Schritt bestimmen */
export const completeDiscordLogin = (userId: string, meta: { ip?: string; locale: Locale }) => completeLogin(userId, meta, 'discord');
export const resumeLogin = (userId: string, meta: { ip?: string; locale: Locale }) => completeLogin(userId, meta, 'resume');

/** Zweite Stufe: Passwort, Code aus der Authenticator-App oder ein Wiederherstellungscode */
export async function verifyTwoFactor(ticket: string, input: SecondFactorInput, meta: { ip?: string; locale: Locale }): Promise<LoginDone> {
  const [userId, expires] = verifySignedToken(ticket, TWO_FACTOR_PURPOSE)?.split(':') ?? [];
  if (!userId || Number(expires) < Date.now()) {
    throw Errors.badRequest('two_factor_expired', L('Die Anmeldung ist abgelaufen. Bitte beginne noch einmal von vorn.', 'The sign-in has expired. Please start again.'));
  }
  const user = await getUser(userId);
  if (user.status !== 'active' || !user.twoFactorMethod) {
    throw Errors.badRequest('two_factor_expired', L('Die Anmeldung ist abgelaufen. Bitte beginne noch einmal von vorn.', 'The sign-in has expired. Please start again.'));
  }
  await checkSecondFactor(user, input);
  return completeLogin(userId, meta);
}

/** Anmeldung abschließen: letzter Login, Newsletter, Warteliste, Panel-Konto, offene Server – und der nächste Schritt */
async function completeLogin(userId: string, meta: { ip?: string; locale: Locale }, how: 'email' | 'discord' | 'resume' = 'email'): Promise<LoginDone> {
  // IP des letzten Logins – nur verschlüsselt gespeichert
  if (how !== 'resume') {
    await db
      .update(users)
      .set({ lastLoginAt: new Date(), ...(meta.ip ? { lastLoginIp: encryptField(meta.ip.slice(0, 64)) } : {}) })
      .where(eq(users.id, userId));
  }
  // Beim Erstellen angehakter Newsletter: Die bestätigte E-Mail-Adresse ist zugleich die Bestätigung der Anmeldung
  const [verified] = await db.select({ email: users.email }).from(users).where(and(eq(users.id, userId), isNotNull(users.emailVerifiedAt))).limit(1);
  if (verified) await activateSignupSubscription(verified.email).catch(() => {});
  let user = await getUser(userId);
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
  if (!user.pteroUserId && user.emailVerifiedAt && (pending.length > 0 || waitlist)) {
    // Kunden mit bestehendem Panel-Konto (gleiche, bestätigte E-Mail) direkt verknüpfen – nie über eine unbestätigte Adresse
    existingPanelAccount = await linkExistingPanelAccount(user, meta.ip).catch(() => false);
    user = await getUser(userId);
  }

  if (how !== 'resume') {
    const via = how === 'discord' ? 'über Discord' : 'Code per E-Mail';
    await audit({ userId, actor: 'user', action: 'auth.signed_in', message: user.twoFactorMethod ? `Angemeldet (${via} + zweite Stufe)` : `Angemeldet (${via})`, ip: meta.ip });
  }

  if (pending.length > 0) {
    if (!user.pteroUserId) return { user, next: 'panel_setup', existingPanelAccount, waitlist: null };
    const activated = await activatePendingServers(user, meta.ip);
    // Nichts erstellt, weil die Discord-Pflicht noch nicht erfüllt ist → die Website zeigt „Mit Discord verbinden“
    const gate = activated.length === 0 ? await discordGate(user) : { ok: true as const };
    return { user, next: 'done', existingPanelAccount, waitlist: null, discordBlocked: gate.ok ? null : gate.reason };
  }
  if (waitlist) return { user, next: 'waitlist', existingPanelAccount, waitlist };
  return { user, next: 'overview', existingPanelAccount, waitlist: null };
}
