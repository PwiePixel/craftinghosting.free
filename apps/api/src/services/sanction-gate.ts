/**
 * Schranken des Verwarnungs-Systems für Aktionen des Nutzers. Eigenes kleines Modul ohne weitere Abhängigkeiten,
 * damit es überall eingebunden werden kann (die eigentliche Logik steht in warnings.service.ts).
 */
import { and, eq, or } from 'drizzle-orm';
import { formatDateTime, freeHostingConfig } from '@chfree/shared';
import { db } from '../db/client';
import { bannedIdentities, type User } from '../db/schema';
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
export const discordHash = (id: string) => sha256(`discord:${id.trim()}`);

/** Ist diese E-Mail-Adresse bzw. dieses Discord-Konto wegen eines Bans gesperrt? */
export async function isBannedIdentity(identity: { email?: string | null; discordId?: string | null }): Promise<boolean> {
  const conds = [];
  if (identity.email) conds.push(and(eq(bannedIdentities.kind, 'email'), eq(bannedIdentities.hash, emailHash(identity.email))));
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
