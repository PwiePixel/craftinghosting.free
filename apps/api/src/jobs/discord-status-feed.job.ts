/**
 * Job: Status-Meldungen im Discord. Prüft jede Minute, ob sich an der Statusseite etwas geändert hat
 * (neue Meldung, Beginn einer angekündigten Wartung, Ende, Wartungsmodus) und postet es in den Status-Kanal.
 * Automatisch gemessene Zustandswechsel bestätigt der Job „status-history“ (alle 5 Minuten).
 */
import { syncStatusFeed } from '../discord/status-feed';
import type { JobDefinition } from './types';

export const discordStatusFeedJob: JobDefinition = {
  name: 'discord-status-feed',
  intervalMs: 60_000,
  leaseMs: 50_000,
  async run() {
    return syncStatusFeed();
  },
};
