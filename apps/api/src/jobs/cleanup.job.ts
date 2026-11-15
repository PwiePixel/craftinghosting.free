/**
 * Job: Aufräumen – abgelaufene Sessions/Tokens, nie bestätigte Anfragen,
 * alte Job-Läufe, alte Laufzeit- und Protokolldaten.
 */
import { and, eq, isNotNull, isNull, lt, notExists, or } from 'drizzle-orm';
import { affectedRows, db } from '../db/client';
import { auditLogs, consentLogs, dedupeMarks, emailTokens, jobRuns, notifications, serverSessions, servers, users } from '../db/schema';
import { deleteExpiredSessions } from '../services/session.service';
import { pruneChats } from '../chat/service';
import { pruneStatusChecks } from '../services/status.service';
import type { JobDefinition } from './types';

const DAY = 24 * 60 * 60 * 1000;

export const cleanupJob: JobDefinition = {
  name: 'cleanup',
  intervalMs: 60 * 60_000,
  leaseMs: 15 * 60_000,
  async run({ now }) {
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    const authSessions = await deleteExpiredSessions();
    const tokens = affectedRows(
      await db.delete(emailTokens).where(or(lt(emailTokens.expiresAt, ago(7)), and(isNotNull(emailTokens.usedAt), lt(emailTokens.usedAt, ago(7))))),
    );
    // Nie bestätigte Konten (inkl. ihrer Server-Anfragen) nach 3 Tagen entfernen –
    // außer sie haben einen Wartelisten-Platz (z. B. vom Admin übernommene Vormerkungen)
    const unverified = affectedRows(
      await db
        .delete(users)
        .where(
          and(
            isNull(users.emailVerifiedAt),
            lt(users.createdAt, ago(3)),
            notExists(db.select({ id: servers.id }).from(servers).where(and(eq(servers.userId, users.id), isNotNull(servers.waitlistPosition)))),
          ),
        ),
    );
    // Offene Anfragen ohne Panel-Zugang nach 14 Tagen verwerfen (gezählt ab Anfrage bzw. Freischaltung von der Warteliste)
    const pending =
      affectedRows(await db.delete(servers).where(and(eq(servers.status, 'pending'), lt(servers.cycleStartedAt, ago(14))))) +
      // nie bestätigte Wartelisten-Anfragen (ohne Platz)
      affectedRows(await db.delete(servers).where(and(eq(servers.status, 'waitlist'), isNull(servers.waitlistPosition), lt(servers.createdAt, ago(14)))));
    await pruneStatusChecks();
    // Unterhaltungen aus dem Support-Chat nach Ablauf der Aufbewahrungsfrist löschen
    await pruneChats().catch(() => 0);
    const runs = affectedRows(await db.delete(jobRuns).where(lt(jobRuns.startedAt, ago(3))));
    const sessions = affectedRows(await db.delete(serverSessions).where(and(isNotNull(serverSessions.endedAt), lt(serverSessions.endedAt, ago(90)))));
    const notes = affectedRows(await db.delete(notifications).where(lt(notifications.createdAt, ago(180))));
    const marks = affectedRows(await db.delete(dedupeMarks).where(lt(dedupeMarks.createdAt, ago(30))));
    const logs = affectedRows(await db.delete(auditLogs).where(lt(auditLogs.createdAt, ago(90))));
    // Nachweise zum Cookie-Hinweis (IP verschlüsselt) ebenfalls nur 90 Tage
    const consents = affectedRows(await db.delete(consentLogs).where(lt(consentLogs.createdAt, ago(90))));
    return { authSessions, tokens, unverified, pending, runs, sessions, notes, marks, logs, consents };
  },
};
