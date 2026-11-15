/**
 * Job: E-Mail-Outbox für Benachrichtigungen.
 * Jede Mail wird per bedingtem UPDATE geclaimt (email_attempts), damit
 * parallele Worker sie nicht doppelt versenden.
 */
import { and, asc, eq } from 'drizzle-orm';
import { affectedRows, db } from '../db/client';
import { notifications, servers, users } from '../db/schema';
import { sendMail } from '../services/mail/mailer';
import { notificationMail } from '../services/mail/templates';
import { manageUrl, panelServerUrl } from '../services/panel';
import type { JobDefinition } from './types';

const MAX_ATTEMPTS = 5;

export const notificationEmailsJob: JobDefinition = {
  name: 'notification-emails',
  intervalMs: 30_000,
  leaseMs: 5 * 60_000,
  async run({ log }) {
    const pending = await db
      .select({ n: notifications, email: users.email, locale: users.locale, identifier: servers.pteroIdentifier })
      .from(notifications)
      .innerJoin(users, eq(users.id, notifications.userId))
      .leftJoin(servers, eq(servers.id, notifications.serverId))
      .where(eq(notifications.emailStatus, 'pending'))
      .orderBy(asc(notifications.createdAt))
      .limit(50);

    const stats = { sent: 0, failed: 0 };
    for (const { n, email, locale, identifier } of pending) {
      const claim = await db
        .update(notifications)
        .set({ emailAttempts: n.emailAttempts + 1 })
        .where(and(eq(notifications.id, n.id), eq(notifications.emailStatus, 'pending'), eq(notifications.emailAttempts, n.emailAttempts)));
      if (affectedRows(claim) !== 1) continue;
      try {
        // „Server bereit“ führt direkt ins Panel, alles andere zur Übersicht (Reaktivieren etc.)
        const panelLink = identifier ? panelServerUrl({ pteroIdentifier: identifier }) : null;
        const cta =
          n.type === 'server.ready' && panelLink
            ? { label: locale === 'en' ? 'Open in panel' : 'Im Panel öffnen', url: panelLink }
            : { label: locale === 'en' ? 'My servers' : 'Meine Server', url: manageUrl(locale) };
        await sendMail(email, notificationMail(n.title, n.body, cta, locale));
        await db.update(notifications).set({ emailStatus: 'sent', emailSentAt: new Date(), emailLastError: null }).where(eq(notifications.id, n.id));
        stats.sent++;
      } catch (err) {
        const final = n.emailAttempts + 1 >= MAX_ATTEMPTS;
        await db
          .update(notifications)
          .set({ emailStatus: final ? 'failed' : 'pending', emailLastError: String((err as Error).message).slice(0, 500) })
          .where(eq(notifications.id, n.id));
        stats.failed++;
        log.warn({ err, notificationId: n.id }, 'E-Mail-Versand fehlgeschlagen');
      }
    }
    return stats;
  },
};
