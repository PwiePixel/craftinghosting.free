import { and, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
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
/** Nächste Prüfung je Server (nur im Speicher – nach einem Neustart wird einmal sofort nachgesehen) */
const nextCheck = new Map<string, number>();

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
          // Angelegt (bzw. zuletzt umgeschaltet) in den letzten 2 Stunden – älteres übernimmt der minütliche Abgleich
          gt(servers.powerStateAt, new Date(now.getTime() - 2 * 60 * 60_000)),
        ),
      )
      .orderBy(desc(servers.powerStateAt))
      .limit(20);
    const stats = { checked: rows.length, ready: 0 };
    const ptero = pterodactyl();
    await mapLimit(rows, 4, async (server) => {
      // Gestaffelt nachsehen (jede Abfrage zählt gegen das Anfrage-Limit des Panels): in der ersten Minute alle
      // 5 Sekunden (die Schnellinstallation ist oft in Sekunden fertig), bis 3 Minuten alle 15 Sekunden, bis 10 Minuten
      // alle 30 Sekunden. Danach übernimmt der minütliche Abgleich (sync-power-states).
      const age = now.getTime() - (server.powerStateAt?.getTime() ?? 0);
      if (age > 10 * 60_000) return;
      if (now.getTime() < (nextCheck.get(server.id) ?? 0)) return;
      nextCheck.set(server.id, now.getTime() + (age < 60_000 ? 0 : age < 3 * 60_000 ? 15_000 : 30_000));
      const panel = await ptero.getServer(server.pteroServerId!);
      // Fertig installiert: kein Status mehr (nicht „installing“/„install_failed“), nicht gesperrt
      // Fehlgeschlagen oder gesperrt: übernimmt der minütliche Abgleich (sync-power-states)
      if (!panel || panel.status !== null || panel.suspended) {
        if (panel && (panel.status === 'install_failed' || panel.suspended)) nextCheck.set(server.id, now.getTime() + 10 * 60_000);
        return;
      }
      try {
        if (await runPostProvision({ ...server, powerState: server.powerState === 'installing' || server.powerState === 'unknown' ? 'offline' : server.powerState })) stats.ready++;
        nextCheck.delete(server.id);
      } catch (err) {
        // z. B. Backup-Zeitplan konnte nicht angelegt werden: nicht alle 5 Sekunden erneut, sondern in 5 Minuten
        nextCheck.set(server.id, now.getTime() + 5 * 60_000);
        throw err;
      }
    });
    return stats;
  },
};
