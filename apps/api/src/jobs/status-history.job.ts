/**
 * Job: Status-Verlauf. Speichert alle 5 Minuten den Zustand jeder Komponente
 * (inkl. manueller Angaben aus dem Admin-Bereich) – daraus wird die Uptime berechnet.
 */
import { recordStatusSnapshot } from '../services/status.service';
import type { JobDefinition } from './types';

export const statusHistoryJob: JobDefinition = {
  name: 'status-history',
  intervalMs: 5 * 60_000,
  leaseMs: 4 * 60_000,
  async run() {
    return recordStatusSnapshot();
  },
};
