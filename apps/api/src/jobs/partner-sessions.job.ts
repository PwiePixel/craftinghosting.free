/**
 * Job: Sitzungen der Partner-API. Verbucht die Laufzeit, stoppt Server ohne Lebenszeichen des Launchers oder bei
 * erreichter Laufzeit-Grenze, stoppt Partner-Server ohne aktive Sitzung und löscht lange nicht gestartete Server.
 */
import { runPartnerSessions } from '../services/partner.service';
import type { JobDefinition } from './types';

export const partnerSessionsJob: JobDefinition = {
  name: 'partner-sessions',
  intervalMs: 30_000,
  leaseMs: 5 * 60_000,
  async run({ now }) {
    return runPartnerSessions(now);
  },
};
