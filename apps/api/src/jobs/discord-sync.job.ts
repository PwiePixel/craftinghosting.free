/**
 * Job: Discord-Abgleich.
 *  – Customer-Rolle: Wer einen Server hat, bekommt sie; wer keinen mehr hat, verliert sie.
 *  – Einladungslink: einmal pro Stunde prüfen und ersetzen, falls er gelöscht wurde.
 */
import { discordErrorText } from '../discord/rest';
import { discordConfig, ensureDiscordInvite, syncCustomerRoles } from '../discord/service';
import { getDiscordState } from '../discord/store';
import type { JobDefinition } from './types';

export const discordSyncJob: JobDefinition = {
  name: 'discord-sync',
  intervalMs: 2 * 60_000,
  leaseMs: 10 * 60_000,
  async run({ log }) {
    const cfg = await discordConfig();
    if (!cfg.botReady) return { rolesChecked: 0, rolesFailed: 0, inviteChecked: 0 };
    const roles = await syncCustomerRoles();
    let inviteChecked = 0;
    const state = await getDiscordState(true);
    if (!state.inviteCode || !state.inviteCheckedAt || Date.now() - Date.parse(state.inviteCheckedAt) > 60 * 60_000) {
      try {
        await ensureDiscordInvite();
        inviteChecked = 1;
      } catch (err) {
        log.warn({ err: discordErrorText(err) }, 'Discord: Einladungslink konnte nicht geprüft werden');
      }
    }
    return { rolesChecked: roles.checked, rolesFailed: roles.failed, inviteChecked };
  },
};
