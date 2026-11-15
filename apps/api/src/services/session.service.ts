import { and, eq, gt, lt } from 'drizzle-orm';
import { env } from '../env';
import { affectedRows, db } from '../db/client';
import { authSessions, users, type User } from '../db/schema';
import { generateToken, sha256 } from '../lib/crypto';

/**
 * Sessions sind bewusst kurzlebig – man muss sich regelmäßig neu per E-Mail-Link anmelden:
 *  – Abmeldung nach SESSION_IDLE_MINUTES ohne Aktivität (Standard 30 min)
 *  – spätestens nach SESSION_MAX_HOURS (Standard 12 h), auch bei Aktivität
 *  – das Cookie hat kein Ablaufdatum und endet mit dem Schließen des Browsers (außer SESSION_PERSISTENT=true)
 */
const IDLE_MS = env.SESSION_IDLE_MINUTES * 60_000;
const MAX_MS = env.SESSION_MAX_HOURS * 3_600_000;
/** Aktivität höchstens einmal pro Minute speichern */
const TOUCH_INTERVAL_MS = 60_000;

function nextExpiry(createdAt: Date, now: Date): Date {
  return new Date(Math.min(now.getTime() + IDLE_MS, createdAt.getTime() + MAX_MS));
}

export async function createSession(userId: string, meta: { ip?: string; userAgent?: string }) {
  const token = generateToken();
  const now = new Date();
  const expiresAt = nextExpiry(now, now);
  await db.insert(authSessions).values({
    id: sha256(token),
    userId,
    expiresAt,
    lastSeenAt: now,
    createdAt: now,
    ip: meta.ip?.slice(0, 64) ?? null,
    userAgent: meta.userAgent?.slice(0, 255) ?? null,
  });
  return { token, expiresAt };
}

export interface SessionUser {
  user: User;
  sessionId: string;
  expiresAt: Date;
  refreshed: boolean;
}

export async function getSessionUser(token: string): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const now = new Date();
  const rows = await db
    .select({ session: authSessions, user: users })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(and(eq(authSessions.id, id), gt(authSessions.expiresAt, now), gt(authSessions.createdAt, new Date(now.getTime() - MAX_MS))))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  let expiresAt = row.session.expiresAt;
  let refreshed = false;
  // Gleitende Verlängerung bei Aktivität – nie über die Höchstdauer hinaus
  if (now.getTime() - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    expiresAt = nextExpiry(row.session.createdAt, now);
    refreshed = true;
    await db.update(authSessions).set({ lastSeenAt: now, expiresAt }).where(eq(authSessions.id, id));
  }
  return { user: row.user, sessionId: id, expiresAt, refreshed };
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(authSessions).where(eq(authSessions.id, sha256(token)));
}

export async function destroyAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
  const rows = await db.select({ id: authSessions.id }).from(authSessions).where(eq(authSessions.userId, userId));
  for (const r of rows) {
    if (r.id !== exceptSessionId) await db.delete(authSessions).where(eq(authSessions.id, r.id));
  }
}

export async function deleteExpiredSessions(): Promise<number> {
  const res = await db.delete(authSessions).where(lt(authSessions.expiresAt, new Date()));
  return affectedRows(res);
}
