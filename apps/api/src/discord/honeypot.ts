/**
 * Honeypot-Kanal zur Bot-Erkennung (Admin → Discord → Honeypot).
 * Der Kanal ist für alle sichtbar und beschreibbar; ein Warnhinweis erklärt, dass dort niemand schreiben soll.
 * Spam-Bots posten in jeden Kanal, den sie sehen – wer in diesem Kanal eine Nachricht sendet, wird deshalb
 * automatisch gebannt (samt Löschen seiner Nachrichten der letzten Stunde).
 * Ausgenommen sind Bots, der Besitzer des Servers und Mitglieder mit dem Recht „Administrator“.
 */
import type { DiscordSettings, Localized } from '@chfree/shared';
import { audit } from '../services/audit.service';
import { discordErrorText, type DiscordUser } from './rest';
import { botRequest, discordConfig } from './service';
import { patchDiscordState } from './store';

const RED = 0xef4444;
const ADMINISTRATOR = 0x8n;
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const READ_HISTORY = 1n << 16n;
const both = (t: Localized) => `🇩🇪 ${t.de}\n\n🇬🇧 ${t.en}`;

/** Warnhinweis im Honeypot-Kanal */
export function honeypotMessage(): unknown {
  return {
    embeds: [
      {
        title: '⚠️ Achtung · Warning',
        color: RED,
        description: both({
          de: '**Dieser Kanal dient zur Bot-Erkennung.**\nWer hier eine Nachricht sendet, wird automatisch gebannt.\n\n🚫 Bitte schreibe hier nichts. Am besten den Kanal stummschalten, ignorieren oder einfach weiterscrollen.',
          en: '**This channel is used to detect bots.**\nAnyone who sends a message here is banned automatically.\n\n🚫 Please do not write anything here. It is best to mute the channel, ignore it or simply scroll on.',
        }),
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

/** Kanal für alle sichtbar und beschreibbar machen und den Warnhinweis posten */
export async function setupHoneypot(guildId: string, channelId: string): Promise<void> {
  // @everyone (ID = Server-ID): sehen, Verlauf lesen und schreiben dürfen – sonst tappt kein Bot hinein
  await botRequest('PUT', `/channels/${channelId}/permissions/${guildId}`, {
    json: { type: 0, allow: String(VIEW_CHANNEL | SEND_MESSAGES | READ_HISTORY), deny: '0' },
    reason: 'Honeypot-Kanal: für alle sichtbar',
  });
  await botRequest('POST', `/channels/${channelId}/messages`, { json: honeypotMessage() });
}

let roleCache: { at: number; guildId: string; admins: Set<string>; ownerId: string | null } | null = null;

/** Rollen mit dem Recht „Administrator“ und der Besitzer des Servers (5 Minuten Cache) */
async function exemptions(guildId: string): Promise<{ admins: Set<string>; ownerId: string | null }> {
  if (roleCache && roleCache.guildId === guildId && Date.now() - roleCache.at < 5 * 60_000) return roleCache;
  const [roles, guild] = await Promise.all([
    botRequest<{ id: string; permissions: string }[]>('GET', `/guilds/${guildId}/roles`),
    botRequest<{ owner_id?: string }>('GET', `/guilds/${guildId}`).catch(() => ({ owner_id: undefined })),
  ]);
  const admins = new Set(roles.filter((r) => (BigInt(r.permissions) & ADMINISTRATOR) === ADMINISTRATOR).map((r) => r.id));
  roleCache = { at: Date.now(), guildId, admins, ownerId: guild.owner_id ?? null };
  return roleCache;
}

interface GuildMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author?: DiscordUser;
  member?: { roles?: string[] };
  webhook_id?: string;
}

/** Nachricht in einem Server-Kanal: Landet sie im Honeypot, wird der Absender gebannt. @returns true = gebannt */
export async function onGuildMessage(d: GuildMessage, settings: DiscordSettings, log: { warn: (obj: unknown, msg: string) => void }): Promise<boolean> {
  const hp = settings.honeypot;
  if (!hp.enabled || !hp.channelId || d.channel_id !== hp.channelId || d.guild_id !== settings.guildId) return false;
  const author = d.author;
  if (!author || author.bot || d.webhook_id) return false;
  try {
    const ex = await exemptions(settings.guildId);
    // Team nicht aussperren: Besitzer und Administratoren dürfen hier schreiben (ihre Nachricht bleibt stehen)
    if (author.id === ex.ownerId || (d.member?.roles ?? []).some((r) => ex.admins.has(r)) || ex.admins.has(settings.guildId)) return false;
    await botRequest('PUT', `/guilds/${settings.guildId}/bans/${author.id}`, {
      json: { delete_message_seconds: 3600 },
      reason: 'Honeypot: Nachricht im Kanal zur Bot-Erkennung',
    });
    await botRequest('DELETE', `/channels/${d.channel_id}/messages/${d.id}`).catch(() => null);
    await audit({ actor: 'system', action: 'discord.honeypot_ban', message: `Honeypot: Discord-Konto ${author.username} (${author.id}) automatisch gebannt` });
    await patchDiscordState({ honeypotError: null }).catch(() => {});
    return true;
  } catch (err) {
    const message = discordErrorText(err);
    log.warn({ err: message, userId: author.id }, 'Discord: Honeypot-Bann fehlgeschlagen');
    await patchDiscordState({ honeypotError: { at: new Date().toISOString(), message } }).catch(() => {});
    return false;
  }
}

/** Nur prüfen, ob die Anbindung bereit ist – für die Routen im Admin-Bereich */
export async function honeypotReady(): Promise<{ guildId: string } | null> {
  const cfg = await discordConfig();
  return cfg.botReady ? { guildId: cfg.settings.guildId } : null;
}
