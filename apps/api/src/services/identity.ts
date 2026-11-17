/**
 * Wann gilt ein Account als „echt“? Früher: bestätigte E-Mail-Adresse. Seit der Anmeldung über Discord genügt
 * das verknüpfte Discord-Konto – die E-Mail-Bestätigung ist freiwillig (und Voraussetzung, um Partner zu werden).
 */
import { isNotNull, or, type SQL } from 'drizzle-orm';
import { users, type User } from '../db/schema';

export const identityConfirmed = (user: Pick<User, 'emailVerifiedAt' | 'discordId'>): boolean => !!user.emailVerifiedAt || !!user.discordId;

/** Dieselbe Bedingung für Abfragen */
export const identityConfirmedSql = (): SQL => or(isNotNull(users.emailVerifiedAt), isNotNull(users.discordId))!;
