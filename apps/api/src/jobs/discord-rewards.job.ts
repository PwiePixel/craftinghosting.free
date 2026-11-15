/**
 * Job: Belohnungssystem auf Discord. Prüft alle 10 Minuten, wer eine Stufe der Einladungs-Belohnungen erreicht hat
 * (und benachrichtigt), und gleicht die Booster mit der Mitgliederliste ab.
 */
import { syncBoosters } from '../discord/boost-rewards';
import { evaluateAllInviters } from '../discord/invite-rewards';
import type { JobDefinition } from './types';

export const discordRewardsJob: JobDefinition = {
  name: 'discord-rewards',
  intervalMs: 10 * 60_000,
  leaseMs: 9 * 60_000,
  async run() {
    const invites = await evaluateAllInviters();
    const boosts = await syncBoosters().catch(() => ({ boosters: 0 }));
    return { ...invites, boosters: boosts.boosters };
  },
};
