import { cleanupJob } from './cleanup.job';
import { cycleJob } from './cycle.job';
import { enforceFairUseJob } from './enforce-fair-use.job';
import { newsletterJob } from './newsletter.job';
import { notificationEmailsJob } from './notification-emails.job';
import { provisioningJob } from './provisioning.job';
import { syncPanelJob } from './sync-panel.job';
import { syncPowerStatesJob } from './sync-power-states.job';
import { statusHistoryJob } from './status-history.job';
import type { JobDefinition } from './types';

/** Reihenfolge = Startreihenfolge beim Hochfahren */
export const allJobs: JobDefinition[] = [
  syncPowerStatesJob,
  enforceFairUseJob,
  cycleJob,
  provisioningJob,
  syncPanelJob,
  notificationEmailsJob,
  newsletterJob,
  cleanupJob,
  statusHistoryJob,
];
