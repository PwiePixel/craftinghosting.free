/**
 * Schranken des Verwarnungs-Systems für Aktionen des Nutzers. Eigenes kleines Modul ohne weitere Abhängigkeiten,
 * damit es überall eingebunden werden kann (die eigentliche Logik steht in warnings.service.ts).
 */
import { and, eq, gt, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { formatDateTime, freeHostingConfig } from '@chfree/shared';
import { db } from '../db/client';
import { bannedIdentities, servers, userWarnings, type User } from '../db/schema';
import { sha256 } from '../lib/crypto';
import { ApiError, Errors, L } from '../lib/errors';

/** Datum mit Uhrzeit in unserer Zeitzone – so wie in allen anderen Nachrichten */
export const fmtSanctionDate = (d: Date, locale: 'de' | 'en') => formatDateTime(d, freeHostingConfig.fairUse.timezone, locale);

/** Läuft für diesen Nutzer gerade eine Auszeit? */
export const inTimeout = (user: Pick<User, 'suspendedUntil'>, now = new Date()): boolean => !!user.suspendedUntil && user.suspendedUntil > now;

/** Während einer Auszeit lassen sich keine Server erstellen oder reaktivieren */
export function assertNoTimeout(user: Pick<User, 'suspendedUntil'>, now = new Date()): void {
  if (!inTimeout(user, now)) return;
  throw new ApiError(
    409,
    'account_timeout',
    L(
      `Wegen einer Verwarnung sind deine Dienste bis ${fmtSanctionDate(user.suspendedUntil!, 'de')} offline. So lange lassen sich keine Server erstellen oder starten.`,
      `Because of a warning your services are offline until ${fmtSanctionDate(user.suspendedUntil!, 'en')}. Until then no servers can be created or started.`,
    ),
    { until: user.suspendedUntil!.toISOString() },
  );
}

/* ---- Sperrliste (Ban): Fingerabdruck von E-Mail-Adresse bzw. Discord-Konto ---- */

export const emailHash = (email: string) => sha256(`email:${email.trim().toLowerCase()}`);

/**
 * Dieselbe Adresse in ihrer Grundform: ohne „+Zusatz“, bei Gmail ohne Punkte und mit einheitlicher Domain. So hilft es
 * nicht, sich nach einem Ban als name+1@… oder n.ame@gmail.com neu anzumelden – es ist dasselbe Postfach.
 */
export function canonicalEmail(email: string): string {
  const [localRaw = '', domainRaw = ''] = email.trim().toLowerCase().split('@');
  const domain = domainRaw === 'googlemail.com' ? 'gmail.com' : domainRaw;
  let local = localRaw.split('+')[0] ?? localRaw;
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

/** Alle Fingerabdrücke einer Adresse: wie angegeben und in der Grundform */
export const emailHashes = (email: string): string[] => [...new Set([emailHash(email), emailHash(canonicalEmail(email))])];
export const discordHash = (id: string) => sha256(`discord:${id.trim()}`);

/** Ist diese E-Mail-Adresse bzw. dieses Discord-Konto wegen eines Bans gesperrt? */
export async function isBannedIdentity(identity: { email?: string | null; discordId?: string | null }): Promise<boolean> {
  const conds = [];
  if (identity.email) conds.push(and(eq(bannedIdentities.kind, 'email'), inArray(bannedIdentities.hash, emailHashes(identity.email))));
  if (identity.discordId) conds.push(and(eq(bannedIdentities.kind, 'discord'), eq(bannedIdentities.hash, discordHash(identity.discordId))));
  if (conds.length === 0) return false;
  const [hit] = await db
    .select({ id: bannedIdentities.id })
    .from(bannedIdentities)
    .where(or(...conds))
    .limit(1);
  return !!hit;
}

const BANNED_TEXT = L(
  'Diese E-Mail-Adresse bzw. dieses Discord-Konto ist bei uns wegen wiederholter Regelverstöße dauerhaft gesperrt. Bei Fragen öffne bitte ein Ticket auf unserem Discord-Server.',
  'This email address or Discord account is permanently banned from our service for repeated rule violations. If you have questions, please open a ticket on our Discord server.',
);
export const bannedError = () => Errors.forbidden(BANNED_TEXT);

/** Meldung für ein gesperrtes Konto: beim Ban mit Begründung, sonst allgemein */
export const lockedError = (user: Pick<User, 'bannedAt'>) =>
  Errors.forbidden(
    user.bannedAt
      ? L('Dein Konto ist wegen wiederholter Regelverstöße dauerhaft gesperrt. Bei Fragen öffne bitte ein Ticket auf unserem Discord-Server.', 'Your account has been permanently banned for repeated rule violations. If you have questions, please open a ticket on our Discord server.')
      : L('Dein Account ist gesperrt. Bitte kontaktiere den Support.', 'Your account is locked. Please contact support.'),
  );

/**
 * E-Mail-Adresse und Discord-Verknüpfung lassen sich nicht ändern, solange Verwarnungen aktiv sind, eine Auszeit läuft
 * oder ein Server eine Abuse-Markierung trägt. Sonst ließe sich kurz vor einem Ban (oder vor dem Löschen des Kontos)
 * die Identität tauschen – und Sperrliste bzw. Verwarnungen hingen dann an einer Wegwerf-Adresse.
 */
export async function assertIdentityFree(user: Pick<User, 'id' | 'suspendedUntil'>, now = new Date()): Promise<void> {
  const frozen = async () => {
    if (inTimeout(user, now)) return true;
    const [warning] = await db
      .select({ id: userWarnings.id })
      .from(userWarnings)
      .where(and(eq(userWarnings.userId, user.id), isNull(userWarnings.revokedAt), gt(userWarnings.expiresAt, now)))
      .limit(1);
    if (warning) return true;
    const [flagged] = await db
      .select({ id: servers.id })
      .from(servers)
      .where(and(eq(servers.userId, user.id), ne(servers.status, 'deleted'), isNotNull(servers.abuseAt)))
      .limit(1);
    return !!flagged;
  };
  if (await frozen()) {
    throw Errors.conflict(
      'abuse_locked',
      L(
        'Solange zu deinem Konto eine Verwarnung oder Abuse-Meldung besteht, lassen sich E-Mail-Adresse und Discord-Verknüpfung nicht ändern. Öffne dazu bitte ein Ticket auf unserem Discord-Server.',
        'While there is a warning or abuse report for your account, the email address and Discord link cannot be changed. Please open a ticket on our Discord server.',
      ),
    );
  }
}
