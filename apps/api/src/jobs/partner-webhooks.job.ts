/**
 * Job: Webhooks der Partner-API zustellen (signiert, mit Wiederholungen) und alte Ereignisse aufräumen.
 */
import { deliverPartnerWebhooks } from '../services/partner-webhooks.service';
import type { JobDefinition } from './types';

export const partnerWebhooksJob: JobDefinition = {
  name: 'partner-webhooks',
  intervalMs: 15_000,
  leaseMs: 5 * 60_000,
  async run({ now }) {
    return deliverPartnerWebhooks(now);
  },
};
