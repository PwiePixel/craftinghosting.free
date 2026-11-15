/**
 * Job: Status-Verlauf. Speichert alle 5 Minuten den Zustand jeder Komponente
 * (inkl. manueller Angaben aus dem Admin-Bereich) – daraus wird die Uptime berechnet.
 */
import { syncStatusFeed } from '../discord/status-feed';
import { recordStatusSnapshot } from '../services/status.service';
import type { JobDefinition } from './types';

export const statusHistoryJob: JobDefinition = {
  name: 'status-history',
  intervalMs: 5 * 60_000,
  leaseMs: 4 * 60_000,
  async run() {
    const stats = await recordStatusSnapshot();
    // Nach jeder Messung: Zustandswechsel für die Status-Meldungen im Discord bestätigen
    const feed = await syncStatusFeed({ snapshot: true }).catch(() => ({ posted: 0 }));
    return { ...stats, posted: feed.posted };
  },
};
