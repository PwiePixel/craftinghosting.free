import { cleanupJob } from './cleanup.job';
import { cycleJob } from './cycle.job';
import { discordRewardsJob } from './discord-rewards.job';
import { discordSocialJob } from './discord-social.job';
import { discordStatusFeedJob } from './discord-status-feed.job';
import { discordSyncJob } from './discord-sync.job';
import { discordJoinJob } from './discord-join.job';
import { enforceFairUseJob } from './enforce-fair-use.job';
import { newsletterJob } from './newsletter.job';
import { notificationEmailsJob } from './notification-emails.job';
import { partnerSessionsJob } from './partner-sessions.job';
import { partnerSoftwareJob } from './partner-software.job';
import { userSanctionsJob } from './user-sanctions.job';
import { postInstallJob } from './post-install.job';
import { partnerWebhooksJob } from './partner-webhooks.job';
import { provisioningJob } from './provisioning.job';
import { serverTransfersJob } from './server-transfers.job';
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
  serverTransfersJob,
  partnerSessionsJob,
  partnerWebhooksJob,
  partnerSoftwareJob,
  userSanctionsJob,
  postInstallJob,
  syncPanelJob,
  notificationEmailsJob,
  newsletterJob,
  cleanupJob,
  statusHistoryJob,
  discordSyncJob,
  discordJoinJob,
  discordStatusFeedJob,
  discordRewardsJob,
  discordSocialJob,
];
