/**
 * Job: Status-Text im Pterodactyl-Panel aktuell halten.
 * Die Server-Beschreibung zeigt z. B. „aktiv bis 29.10.2026“ oder
 * „Fair-Use-Pause bis Mo., 18:30“ – so sehen Nutzer alles direkt im Panel.
 * Es wird nur geschrieben, wenn sich der Text geändert hat.
 */
import { and, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db/client';
import { servers } from '../db/schema';
import { syncPanelDescription } from '../services/panel';
import { mapLimit, type JobDefinition } from './types';

export const syncPanelJob: JobDefinition = {
  name: 'sync-panel',
  intervalMs: 2 * 60_000,
  leaseMs: 10 * 60_000,
  async run({ now, log }) {
    const rows = await db
      .select()
      .from(servers)
      .where(and(isNotNull(servers.pteroServerId), inArray(servers.status, ['active', 'expiring', 'suspended'])));
    const stats = { checked: rows.length, updated: 0, errors: 0 };
    await mapLimit(rows, 5, async (server) => {
      try {
        if (await syncPanelDescription(server, now)) stats.updated++;
      } catch (err) {
        stats.errors++;
        log.warn({ err, serverId: server.id }, 'Panel-Beschreibung konnte nicht gesetzt werden');
      }
    });
    return stats;
  },
};
