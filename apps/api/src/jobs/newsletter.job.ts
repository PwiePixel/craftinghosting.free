/**
 * Job: Newsletter-Ausgaben versenden – in kleinen Portionen, damit der Mailserver nicht überlastet wird.
 * Die Höchstzahl pro Minute kommt aus dem Admin-Bereich (Einstellungen → Newsletter).
 */
import { processCampaigns } from '../services/newsletter.service';
import { getSettings } from '../services/settings.service';
import type { JobDefinition } from './types';

const INTERVAL_MS = 30_000;

export const newsletterJob: JobDefinition = {
  name: 'newsletter-send',
  intervalMs: INTERVAL_MS,
  leaseMs: 10 * 60_000,
  async run() {
    const { newsletter } = await getSettings();
    return processCampaigns(Math.max(1, Math.round((newsletter.ratePerMinute * INTERVAL_MS) / 60_000)));
  },
};
