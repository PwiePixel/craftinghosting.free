/**
 * Job: fehlgeschlagene oder hängende Server-Anlagen erneut versuchen
 * (mit exponentiellem Backoff, maximal MAX_PROVISIONING_ATTEMPTS Versuche).
 */
import { and, eq, inArray, lt, or } from 'drizzle-orm';
import { db } from '../db/client';
import { servers } from '../db/schema';
import { MAX_PROVISIONING_ATTEMPTS, provisionServer } from '../services/provisioning.service';
import type { JobDefinition } from './types';

export const provisioningJob: JobDefinition = {
  name: 'provisioning-retry',
  intervalMs: 2 * 60_000,
  leaseMs: 10 * 60_000,
  async run({ now }) {
    const stuckBefore = new Date(now.getTime() - 3 * 60_000);
    const rows = await db
      .select()
      .from(servers)
      .where(
        and(
          inArray(servers.status, ['provisioning', 'provisioning_failed']),
          lt(servers.provisioningAttempts, MAX_PROVISIONING_ATTEMPTS),
          or(eq(servers.status, 'provisioning_failed'), lt(servers.createdAt, stuckBefore)),
        ),
      );

    const stats = { candidates: rows.length, provisioned: 0, failed: 0, backoff: 0 };
    for (const server of rows) {
      // Backoff: 1, 4, 9, 16 … Minuten nach dem letzten Versuch
      const waitMs = Math.max(1, server.provisioningAttempts) ** 2 * 60_000;
      if (server.lastProvisionAttemptAt && now.getTime() - server.lastProvisionAttemptAt.getTime() < waitMs) {
        stats.backoff++;
        continue;
      }
      const result = await provisionServer(server.id, 'system');
      if (result === 'active') stats.provisioned++;
      if (result === 'failed') stats.failed++;
    }
    return stats;
  },
};
