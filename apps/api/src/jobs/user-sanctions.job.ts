import { runSanctions } from '../services/warnings.service';
import type { JobDefinition } from './types';

/** Verwarnungs-System: beendet abgelaufene Auszeiten und löscht die Server gebannter Konten nach Ablauf der Frist */
export const userSanctionsJob: JobDefinition = {
  name: 'user-sanctions',
  intervalMs: 60_000,
  leaseMs: 10 * 60_000,
  async run({ now }) {
    return runSanctions(now);
  },
};
