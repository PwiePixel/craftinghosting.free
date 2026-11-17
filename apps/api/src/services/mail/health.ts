/**
 * Zustellbarkeit von E-Mails je Account.
 *
 * Lehnt der Mailserver eine Empfänger-Adresse ab (Postfach gibt es nicht, Domain nimmt keine Mail an), zählt das als
 * Fehlversuch für diese Adresse. Nach zwei Fehlversuchen in Folge gilt sie als nicht erreichbar: Es wird nichts mehr
 * dorthin geschickt, das Team bekommt eine E-Mail, und der Nutzer – falls Discord verknüpft ist – einen Hinweis per
 * Direktnachricht. Die Sperre endet, sobald der Nutzer seine Adresse ändert oder bestätigt.
 *
 * Nicht erkennbar ist, wenn ein fremder Mailserver die Nachricht erst annimmt und dann still verwirft oder in den
 * Spam-Ordner legt. Fehler auf unserer Seite (Mailserver nicht erreichbar, Anmeldung abgelehnt) zählen nicht.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { affectedRows, db } from '../../db/client';
import { users } from '../../db/schema';
import { adminEmails, env } from '../../env';
import { sendDm } from '../../discord/invite-rewards';
import { audit } from '../audit.service';
import { manageUrl } from '../panel';
import { sendMail } from './mailer';
import { notificationMail } from './templates';

export const MAX_ADDRESS_FAILURES = 2;

/** Hat der Mailserver die Empfänger-Adresse abgelehnt? (im Unterschied zu Verbindungs- oder Anmeldefehlern) */
export function isRecipientFailure(err: unknown): boolean {
  const e = err as { code?: string; responseCode?: number; command?: string; rejected?: unknown[] };
  if (e?.code === 'EENVELOPE') return true;
  if (Array.isArray(e?.rejected) && e.rejected.length > 0) return true;
  return typeof e?.responseCode === 'number' && e.responseCode >= 500 && e.responseCode < 600 && e.command === 'RCPT TO';
}

/** Versand geglückt: Der Zähler beginnt wieder bei null */
export async function noteMailDelivered(userId: string): Promise<void> {
  await db.update(users).set({ emailFailCount: 0 }).where(and(eq(users.id, userId), sql`${users.emailFailCount} > 0`));
}

/**
 * Versand gescheitert. Rückgabe true = die Adresse gilt jetzt (oder galt schon) als nicht erreichbar.
 * Beim Übergang werden Team und Nutzer genau einmal informiert.
 */
export async function noteMailFailure(userId: string, err: unknown): Promise<boolean> {
  if (!isRecipientFailure(err)) return false;
  await db.update(users).set({ emailFailCount: sql`${users.emailFailCount} + 1` }).where(eq(users.id, userId));
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return false;
  if (user.emailUndeliverableAt) return true;
  if (user.emailFailCount < MAX_ADDRESS_FAILURES) return false;
  const flagged = await db.update(users).set({ emailUndeliverableAt: new Date() }).where(and(eq(users.id, userId), isNull(users.emailUndeliverableAt)));
  if (affectedRows(flagged) !== 1) return true;

  const reason = String((err as Error)?.message ?? err).slice(0, 300);
  await audit({ userId, actor: 'system', action: 'mail.undeliverable', message: `E-Mail-Adresse ${user.email} ist nicht erreichbar (${user.emailFailCount} Fehlversuche): ${reason}` });
  const body = [
    `Der Nutzer mit der Adresse ${user.email} hat offenbar eine falsche oder nicht erreichbare E-Mail-Adresse angegeben: Der Mailserver hat sie ${user.emailFailCount}-mal abgelehnt.`,
    `Antwort des Mailservers: ${reason}`,
    user.discordId ? `Discord: ${user.discordUsername ?? ''} (${user.discordId}) – der Nutzer wurde per Direktnachricht gebeten, seine Adresse zu ändern.` : 'Es ist kein Discord-Konto verknüpft.',
    'An diese Adresse wird nichts mehr geschickt, bis der Nutzer sie unter „Meine Server“ ändert oder bestätigt.',
  ].join('\n');
  for (const admin of adminEmails) {
    if (admin.toLowerCase() === user.email.toLowerCase()) continue;
    await sendMail(admin, notificationMail(`E-Mail-Adresse nicht erreichbar: ${user.email}`, body, { label: 'Admin-Bereich', url: `${env.APP_URL}/de/admin?tab=users` }, 'de')).catch(() => {});
  }
  if (user.discordId) {
    await sendDm(user.discordId, {
      embeds: [
        {
          title: '✉️ E-Mail-Adresse nicht erreichbar · Email address unreachable',
          color: 0xf59e0b,
          description:
            `🇩🇪 Wir konnten dir keine E-Mail an **${user.email}** zustellen – die Adresse wird vom Mailserver abgelehnt. Wichtige Hinweise bekommst du deshalb vorerst hier per Direktnachricht. Bitte ändere deine E-Mail-Adresse unter „Meine Server“: ${manageUrl('de')}\n\n` +
            `🇬🇧 We could not deliver email to **${user.email}** – the mail server rejects the address. For now you will receive important notices here by direct message. Please change your email address under “My servers”: ${manageUrl('en')}`,
          footer: { text: 'CraftingHosting.free' },
        },
      ],
    }).catch(() => false);
  }
  return true;
}

/** Adresse geändert oder bestätigt: wieder zustellen */
export async function resetMailHealth(userId: string): Promise<void> {
  await db.update(users).set({ emailFailCount: 0, emailUndeliverableAt: null }).where(eq(users.id, userId));
}
