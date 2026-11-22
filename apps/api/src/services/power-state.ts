/**
 * Überträgt einen beobachteten Power-Zustand in die Datenbank und
 * führt die Laufzeit-Sessions nach. Idempotent: wiederholte Aufrufe mit
 * demselben Zustand ändern nichts; der Unique-Index auf der offenen
 * Session verhindert Duplikate auch bei parallelen Aufrufen.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { PowerState } from '@chfree/shared';
import { affectedRows, db } from '../db/client';
import { serverSessions, servers, type Server } from '../db/schema';
import { isOnline } from './runtime';

type EndReason = 'detected' | 'user' | 'fair_use_session' | 'fair_use_weekly' | 'cycle' | 'deleted';

export async function applyPowerState(
  server: Pick<Server, 'id' | 'powerState'>,
  state: PowerState,
  now: Date,
  endReason: EndReason = 'detected',
  /** Tatsächlicher Startzeitpunkt (aus der vom Panel gemeldeten Laufzeit) – für Starts, die erst verspätet auffallen */
  startedAt?: Date,
): Promise<{ opened: boolean; closed: boolean }> {
  let opened = false;
  let closed = false;

  if (state !== server.powerState) {
    const patch: Partial<Server> = { powerState: state, powerStateAt: now };
    await db.update(servers).set(patch).where(eq(servers.id, server.id));
  }

  if (state === 'unknown') return { opened, closed };

  if (isOnline(state)) {
    const [open] = await db
      .select({ id: serverSessions.id })
      .from(serverSessions)
      .where(and(eq(serverSessions.serverId, server.id), isNull(serverSessions.endedAt)))
      .limit(1);
    if (!open) {
      const res = await db.insert(serverSessions).values({ serverId: server.id, startedAt: startedAt && startedAt < now ? startedAt : now }).onConflictDoNothing();
      opened = affectedRows(res) === 1;
    }
  } else {
    const res = await db
      .update(serverSessions)
      .set({ endedAt: now, endReason })
      .where(and(eq(serverSessions.serverId, server.id), isNull(serverSessions.endedAt)));
    closed = affectedRows(res) > 0;
  }
  return { opened, closed };
}

/** Schließt eine offene Session sofort (z. B. nach einem erzwungenen Stopp). */
export async function closeOpenSession(serverId: string, now: Date, endReason: EndReason): Promise<void> {
  await db
    .update(serverSessions)
    .set({ endedAt: now, endReason })
    .where(and(eq(serverSessions.serverId, serverId), isNull(serverSessions.endedAt)));
}
