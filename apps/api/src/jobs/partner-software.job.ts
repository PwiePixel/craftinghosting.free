import { runSoftwareJobs } from '../services/partner-software.service';
import type { JobDefinition } from './types';

/** Richtet die Server-Software von Partner-Servern ein (Typ-/Versionswechsel): je Lauf ein Schritt weiter */
export const partnerSoftwareJob: JobDefinition = {
  name: 'partner-software',
  intervalMs: 5_000,
  leaseMs: 12 * 60_000,
  async run({ now }) {
    return runSoftwareJobs(now);
  },
};
