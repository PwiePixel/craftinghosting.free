/**
 * Job: Extras (kostenpflichtige Add-ons) – unbezahlte Bestellungen verwerfen, vor dem Ablauf erinnern, abgelaufene
 * Buchungen beenden, offene Zahlungen beim Anbieter nachfragen und die Wirkung „24/7“ mit den Buchungen abgleichen.
 */
import { runAddons } from '../services/addons.service';
import type { JobDefinition } from './types';

export const addonsJob: JobDefinition = {
  name: 'addons',
  intervalMs: 60_000,
  leaseMs: 5 * 60_000,
  async run({ now }) {
    return runAddons(now);
  },
};
