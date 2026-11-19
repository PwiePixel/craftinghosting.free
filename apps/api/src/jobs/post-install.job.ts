import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { servers } from '../db/schema';
import { pterodactyl } from '../pterodactyl';
import { runPostProvision } from '../services/provisioning.service';
import { mapLimit, type JobDefinition } from './types';

/**
 * Job: Neue Server der Website, deren Installation gerade fertig geworden ist, sofort übernehmen – Backup-Zeitplan,
 * Minecraft-Server automatisch starten, Nachricht „läuft“. Der allgemeine Abgleich (sync-power-states) läuft nur jede
 * Minute; dieser Job prüft nur frisch angelegte Server, dafür alle paar Sekunden.
 */
export const postInstallJob: JobDefinition = {
  name: 'post-install',
  intervalMs: 5_000,
  leaseMs: 2 * 60_000,
  async run({ now }) {
    const rows = await db
      .select()
      .from(servers)
      .where(
        and(
          eq(servers.status, 'active'),
          eq(servers.postProvisionDone, false),
          isNull(servers.partnerId),
          sql`${servers.softwareJob} is null`,
          isNotNull(servers.pteroServerId),
          gt(servers.createdAt, new Date(now.getTime() - 24 * 60 * 60_000)),
        ),
      )
      .limit(20);
    const stats = { checked: rows.length, ready: 0 };
    const ptero = pterodactyl();
    await mapLimit(rows, 4, async (server) => {
      const panel = await ptero.getServer(server.pteroServerId!);
      // Fertig installiert: kein Status mehr (nicht „installing“/„install_failed“), nicht gesperrt
      if (!panel || panel.status !== null || panel.suspended) return;
      if (await runPostProvision({ ...server, powerState: server.powerState === 'installing' || server.powerState === 'unknown' ? 'offline' : server.powerState })) stats.ready++;
    });
    return stats;
  },
};
