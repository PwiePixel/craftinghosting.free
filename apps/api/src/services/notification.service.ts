import { and, desc, eq, isNull } from 'drizzle-orm';
import type { NotificationDTO } from '@chfree/shared';
import { affectedRows, db } from '../db/client';
import { notifications } from '../db/schema';
import { uuid } from '../lib/crypto';
import { resolveText, type LText } from '../lib/text';
import { getUserLocale } from './locale.service';

export interface NotifyInput {
  userId: string;
  serverId?: string | null;
  type: string;
  /** Texte in beiden Sprachen – gespeichert wird die Sprache des Empfängers */
  title: LText;
  body: LText;
  /** Eindeutiger Schlüssel – dieselbe Benachrichtigung wird nie doppelt erzeugt. */
  dedupeKey: string;
  email?: boolean;
}

/**
 * Legt eine Benachrichtigung an (idempotent über dedupeKey).
 * E-Mails werden asynchron vom Worker (Outbox-Prinzip) versendet.
 * @returns true, wenn die Benachrichtigung neu angelegt wurde.
 */
export async function notify(input: NotifyInput): Promise<boolean> {
  const locale = await getUserLocale(input.userId);
  const result = await db
    .insert(notifications)
    .values({
      id: uuid(),
      userId: input.userId,
      serverId: input.serverId ?? null,
      type: input.type,
      title: resolveText(input.title, locale).slice(0, 160),
      body: resolveText(input.body, locale),
      dedupeKey: input.dedupeKey.slice(0, 191),
      emailStatus: input.email ? 'pending' : 'none',
    })
    .onConflictDoNothing();
  return affectedRows(result) === 1;
}

export async function listNotifications(userId: string, limit = 30): Promise<NotificationDTO[]> {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    serverId: n.serverId,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  }));
}

export async function markAllRead(userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}
