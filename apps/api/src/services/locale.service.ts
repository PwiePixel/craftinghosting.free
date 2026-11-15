/**
 * Sprache der Nutzer – für E-Mails, Chat-Hinweise im Minecraft-Server und die
 * Serverbeschreibung im Panel. Maßgeblich ist die Sprache, in der der Nutzer
 * zuletzt auf der Website eine Aktion ausgeführt hat.
 */
import { eq } from 'drizzle-orm';
import { isLocale, type Locale } from '@chfree/shared';
import { db } from '../db/client';
import { users, type User } from '../db/schema';

const TTL_MS = 60_000;
const cache = new Map<string, { locale: Locale; at: number }>();

export async function getUserLocale(userId: string): Promise<Locale> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.locale;
  const [row] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1);
  const locale: Locale = isLocale(row?.locale) ? row.locale : 'de';
  cache.set(userId, { locale, at: Date.now() });
  return locale;
}

/** Speichert die Sprache, falls sie sich geändert hat. */
export async function rememberUserLocale(user: Pick<User, 'id' | 'locale'>, locale: Locale): Promise<void> {
  cache.set(user.id, { locale, at: Date.now() });
  if (user.locale === locale) return;
  await db.update(users).set({ locale }).where(eq(users.id, user.id));
}
