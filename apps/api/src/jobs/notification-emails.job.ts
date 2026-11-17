/**
 * Job: E-Mail-Outbox für Benachrichtigungen.
 * Jede Mail wird per bedingtem UPDATE geclaimt (email_attempts), damit
 * parallele Worker sie nicht doppelt versenden. Zusätzlich geht jede Nachricht einmal als Discord-Direktnachricht
 * raus (abschaltbar), und nicht erreichbare Adressen werden nach zwei Fehlversuchen nicht mehr angeschrieben.
 */
import { and, asc, eq } from 'drizzle-orm';
import { affectedRows, db } from '../db/client';
import { notifications, servers, users } from '../db/schema';
import { discordConfig } from '../discord/service';
import { sendDm } from '../discord/invite-rewards';
import { noteMailDelivered, noteMailFailure } from '../services/mail/health';
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
      .select({ n: notifications, email: users.email, locale: users.locale, discordId: users.discordId, undeliverable: users.emailUndeliverableAt, identifier: servers.pteroIdentifier })
      .from(notifications)
      .innerJoin(users, eq(users.id, notifications.userId))
      .leftJoin(servers, eq(servers.id, notifications.serverId))
      .where(eq(notifications.emailStatus, 'pending'))
      .orderBy(asc(notifications.createdAt))
      .limit(50);
    const discord = pending.length ? await discordConfig() : null;
    const dmEnabled = !!discord?.botReady && discord.settings.notifyByDm;

    const stats = { sent: 0, failed: 0, dm: 0, skipped: 0 };
    for (const { n, email, locale, discordId, undeliverable, identifier } of pending) {
      const claim = await db
        .update(notifications)
        .set({ emailAttempts: n.emailAttempts + 1 })
        .where(and(eq(notifications.id, n.id), eq(notifications.emailStatus, 'pending'), eq(notifications.emailAttempts, n.emailAttempts)));
      if (affectedRows(claim) !== 1) continue;

      // Dieselbe Nachricht als Discord-Direktnachricht – einmal, unabhängig davon, ob die E-Mail ankommt.
      // So erreichen wichtige Hinweise auch Nutzer, bei denen E-Mails verloren gehen.
      if (!n.dmSentAt) {
        await db.update(notifications).set({ dmSentAt: new Date() }).where(eq(notifications.id, n.id));
        if (dmEnabled && discordId) {
          const delivered = await sendDm(discordId, {
            embeds: [{ title: n.title.slice(0, 250), color: 0x3b82f6, description: `${n.body.slice(0, 3500)}\n\n${manageUrl(locale)}`, footer: { text: 'CraftingHosting.free' } }],
          }).catch(() => false);
          if (delivered) stats.dm++;
        }
      }

      // Adresse gilt als nicht erreichbar: nichts mehr dorthin schicken
      if (undeliverable) {
        await db.update(notifications).set({ emailStatus: 'failed', emailLastError: 'Nicht versendet: Die E-Mail-Adresse ist nicht erreichbar.' }).where(eq(notifications.id, n.id));
        stats.skipped++;
        continue;
      }
      try {
        // „Server bereit“ führt direkt ins Panel, alles andere zur Übersicht (Reaktivieren etc.)
        const panelLink = identifier ? panelServerUrl({ pteroIdentifier: identifier }) : null;
        const cta =
          n.type === 'server.ready' && panelLink
            ? { label: locale === 'en' ? 'Open in panel' : 'Im Panel öffnen', url: panelLink }
            : { label: locale === 'en' ? 'My servers' : 'Meine Server', url: manageUrl(locale) };
        await sendMail(email, notificationMail(n.title, n.body, cta, locale));
        await db.update(notifications).set({ emailStatus: 'sent', emailSentAt: new Date(), emailLastError: null }).where(eq(notifications.id, n.id));
        await noteMailDelivered(n.userId);
        stats.sent++;
      } catch (err) {
        // Lehnt der Mailserver die Adresse zum zweiten Mal ab, ist Schluss (Team und Nutzer werden informiert)
        const unreachable = await noteMailFailure(n.userId, err).catch(() => false);
        const final = unreachable || n.emailAttempts + 1 >= MAX_ATTEMPTS;
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
