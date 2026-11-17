import { and, eq, gt, lt } from 'drizzle-orm';
import { env } from '../env';
import { affectedRows, db } from '../db/client';
import { authSessions, users, type User } from '../db/schema';
import { encryptField, generateToken, sha256 } from '../lib/crypto';

/**
 * Sessions sind bewusst kurzlebig – man muss sich regelmäßig neu per E-Mail-Link anmelden:
 *  – Abmeldung nach SESSION_IDLE_MINUTES ohne Aktivität (Standard 30 min)
 *  – spätestens nach SESSION_MAX_HOURS (Standard 12 h), auch bei Aktivität
 *  – das Cookie hat kein Ablaufdatum und endet mit dem Schließen des Browsers (außer SESSION_PERSISTENT=true)
 * Mit „Angemeldet bleiben“ (Schalter im Kontobereich) gilt für die Sitzungen dieses Accounts stattdessen:
 *  – Abmeldung erst nach SESSION_STAY_DAYS ohne Aktivität (Standard 30 Tage), spätestens nach dem Dreifachen
 *  – das Cookie bleibt auch nach dem Schließen des Browsers erhalten
 */
const IDLE_MS = env.SESSION_IDLE_MINUTES * 60_000;
const MAX_MS = env.SESSION_MAX_HOURS * 3_600_000;
/** Aktivität höchstens einmal pro Minute speichern */
const TOUCH_INTERVAL_MS = 60_000;

const STAY_IDLE_MS = env.SESSION_STAY_DAYS * 86_400_000;
const STAY_MAX_MS = STAY_IDLE_MS * 3;
const maxAge = (persistent: boolean) => (persistent ? STAY_MAX_MS : MAX_MS);

function nextExpiry(createdAt: Date, now: Date, persistent = false): Date {
  return new Date(Math.min(now.getTime() + (persistent ? STAY_IDLE_MS : IDLE_MS), createdAt.getTime() + maxAge(persistent)));
}

export async function createSession(userId: string, meta: { ip?: string; userAgent?: string }) {
  const token = generateToken();
  const now = new Date();
  // „Angemeldet bleiben“ ist eine Einstellung des Accounts und gilt für jede neue Anmeldung
  const [owner] = await db.select({ stay: users.staySignedIn }).from(users).where(eq(users.id, userId)).limit(1);
  const persistent = !!owner?.stay;
  const expiresAt = nextExpiry(now, now, persistent);
  await db.insert(authSessions).values({
    id: sha256(token),
    userId,
    expiresAt,
    lastSeenAt: now,
    persistent,
    createdAt: now,
    // IP und User-Agent werden nur verschlüsselt gespeichert
    ip: encryptField(meta.ip?.slice(0, 64)),
    userAgent: encryptField(meta.userAgent?.slice(0, 255)),
  });
  return { token, expiresAt, persistent };
}

export interface SessionUser {
  user: User;
  sessionId: string;
  expiresAt: Date;
  refreshed: boolean;
  /** „Angemeldet bleiben“: Das Cookie bekommt ein Ablaufdatum */
  persistent: boolean;
}

export async function getSessionUser(token: string): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const now = new Date();
  const rows = await db
    .select({ session: authSessions, user: users })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(and(eq(authSessions.id, id), gt(authSessions.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  // Höchstdauer: auch bei Aktivität ist irgendwann Schluss
  if (!row || row.session.createdAt.getTime() + maxAge(row.session.persistent) <= now.getTime()) return null;

  let expiresAt = row.session.expiresAt;
  let refreshed = false;
  // Gleitende Verlängerung bei Aktivität – nie über die Höchstdauer hinaus
  if (now.getTime() - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    expiresAt = nextExpiry(row.session.createdAt, now, row.session.persistent);
    refreshed = true;
    await db.update(authSessions).set({ lastSeenAt: now, expiresAt }).where(eq(authSessions.id, id));
  }
  return { user: row.user, sessionId: id, expiresAt, refreshed, persistent: row.session.persistent };
}

/**
 * „Angemeldet bleiben“ ein- oder ausschalten: gilt für künftige Anmeldungen und sofort für alle laufenden Sitzungen
 * des Accounts. Gibt das neue Ablaufdatum der angegebenen Sitzung zurück (für das Cookie).
 */
export async function setStaySignedIn(userId: string, enabled: boolean, sessionId: string | null): Promise<Date | null> {
  await db.update(users).set({ staySignedIn: enabled }).where(eq(users.id, userId));
  const now = new Date();
  const rows = await db.select().from(authSessions).where(eq(authSessions.userId, userId));
  let current: Date | null = null;
  for (const row of rows) {
    const expiresAt = nextExpiry(row.createdAt, now, enabled);
    await db.update(authSessions).set({ persistent: enabled, expiresAt, lastSeenAt: now }).where(eq(authSessions.id, row.id));
    if (row.id === sessionId) current = expiresAt;
  }
  return current;
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
