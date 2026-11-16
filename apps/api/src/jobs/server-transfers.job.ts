/**
 * Job: laufende Umzüge von Servern auf eine andere Node (Admin → Server → „Upgrade / Umzug“).
 * Prüft jede Minute, ob der Server laut Panel auf der neuen Node liegt, übernimmt dann die neue Adresse
 * und informiert den Kunden.
 */
import { checkServerTransfers } from '../services/admin-upgrade.service';
import type { JobDefinition } from './types';

export const serverTransfersJob: JobDefinition = {
  name: 'server-transfers',
  intervalMs: 60_000,
  leaseMs: 5 * 60_000,
  async run() {
    return checkServerTransfers();
  },
};
