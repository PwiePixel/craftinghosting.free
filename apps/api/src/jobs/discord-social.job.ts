/**
 * Job: Social Ping. Prüft alle 5 Minuten die hinterlegten Konten (YouTube-Kanäle, Feeds) auf neue Videos
 * und postet sie in den eingestellten Discord-Kanal.
 */
import { checkSocialAccounts } from '../discord/social-ping';
import type { JobDefinition } from './types';

export const discordSocialJob: JobDefinition = {
  name: 'discord-social',
  intervalMs: 5 * 60_000,
  leaseMs: 4 * 60_000,
  async run() {
    return checkSocialAccounts();
  },
};
