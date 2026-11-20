/**
 * Job: Verknüpfte Discord-Konten automatisch unserem Discord-Server hinzufügen (siehe runDiscordAutoJoin).
 * Holt nach, was beim Verknüpfen nicht geklappt hat (z. B. weil dem Bot eine Berechtigung fehlte), und stellt fest,
 * wer einmal neu verbinden muss. Wer jetzt auf dem Server ist, bekommt seine wartenden Server sofort.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { runDiscordAutoJoin, syncCustomerRole } from '../discord/service';
import { activatePendingServers } from '../services/server.service';
import type { JobDefinition } from './types';

/** Nach dem Beitritt: wartende Server erstellen und die Customer-Rolle abgleichen */
export async function afterDiscordJoin(userId: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.status !== 'active') return;
  await activatePendingServers(user).catch(() => []);
  await syncCustomerRole(user.id).catch(() => {});
}

export const discordJoinJob: JobDefinition = {
  name: 'discord-join',
  intervalMs: 5 * 60_000,
  leaseMs: 10 * 60_000,
  async run({ now }) {
    return runDiscordAutoJoin(now, 150, afterDiscordJoin);
  },
};
