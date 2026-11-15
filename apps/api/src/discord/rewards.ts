/**
 * Belohnungssystem auf Discord – gemeinsamer Teil für Einladungen und Server-Boosts:
 *  – zusätzliche Slots eines Website-Accounts (für die Server-Grenzen)
 *  – die Übersicht, die der Bot auf „!rewards“ per Direktnachricht schickt
 *  – die Ankündigung des Systems in einem Kanal (Knopf im Admin-Bereich)
 */
import type { BonusSlot, Localized, SiteSettings } from '@chfree/shared';
import { db } from '../db/client';
import { discordBoosts, users, type User } from '../db/schema';
import { env } from '../env';
import { eq } from 'drizzle-orm';
import { getSettings } from '../services/settings.service';
import { boostBonusSlots, boostCount, boostSlots, slotsText } from './boost-rewards';
import { inviteBonusSlots, inviteOverview, inviteTierLines } from './invite-rewards';
import type { DiscordUser } from './rest';
import { botRequest } from './service';

const COLOR = 0xf59e0b;
const both = (t: Localized) => `🇩🇪 ${t.de}\n🇬🇧 ${t.en}`;

/** Alle zusätzlichen Slots eines Accounts: eingelöste Einladungs-Belohnungen und laufende Boosts */
export async function bonusSlotsFor(user: Pick<User, 'id' | 'discordId'>): Promise<BonusSlot[]> {
  const settings = await getSettings();
  if (!settings.discord.enabled) return [];
  const [invites, boosts] = await Promise.all([inviteBonusSlots(user.id), boostBonusSlots(user.discordId, settings)]);
  return [...invites, ...boosts];
}

/** Stufen der Boost-Belohnungen als Text */
function boostTierLines(settings: SiteSettings, lang: 'de' | 'en', current = -1): string[] {
  return settings.discord.boostRewards.tiers.map((t, i, all) => {
    const last = i === all.length - 1;
    const reached = current >= t.boosts && (last || current < all[i + 1]!.boosts);
    const n = `${t.boosts}${last ? '+' : ''} ${t.boosts === 1 && !last ? 'Boost' : 'Boosts'}`;
    return `${current < 0 ? '' : reached ? '✅ ' : '▫️ '}**${n}** → ${slotsText(boostSlots(settings, t.boosts), lang)}`;
  });
}

export const isRewardsCommand = (content: string | undefined) => /^!?\s*(rewards?|geschenke?|belohnung(en)?|einladungen|invites?|boosts?)\s*[!.]?$/i.test((content ?? '').trim());

/** Direktnachricht „!rewards“: Stand der Einladungen und Boosts, Stufen und Buttons zum Einlösen */
export async function onRewardsMessage(d: { channel_id: string; author: DiscordUser; guild_id?: string }): Promise<void> {
  if (d.guild_id || d.author.bot) return;
  const settings = await getSettings();
  if (!settings.discord.enabled) return;
  const send = (json: unknown) => botRequest('POST', `/channels/${d.channel_id}/messages`, { json });
  const invitesOn = settings.discord.inviteRewards.enabled && settings.discord.inviteRewards.tiers.length > 0;
  const boostsOn = settings.discord.boostRewards.enabled && settings.discord.boostRewards.tiers.length > 0;
  if (!invitesOn && !boostsOn) {
    return void (await send({ content: both({ de: 'Das Belohnungssystem ist derzeit nicht aktiv.', en: 'The reward system is not active at the moment.' }) }));
  }
  const invite = invitesOn ? await inviteOverview(d.author.id, settings) : { text: '', components: [] };
  const parts: string[] = [];
  if (invite.text) parts.push(invite.text);
  if (boostsOn) {
    const [row] = await db.select().from(discordBoosts).where(eq(discordBoosts.discordId, d.author.id)).limit(1);
    const boosts = boostCount(row);
    parts.push(
      [
        `🇩🇪 **Server-Boosts** – du boostest gerade **${boosts}×**\n${boostTierLines(settings, 'de', boosts).join('\n')}`,
        'Es gilt immer die höchste erreichte Stufe, solange dein Boost läuft. Hast du schon einen Server im kleineren Paket, wird er beim Aufstieg automatisch hochgestuft.',
        '',
        `🇬🇧 **Server boosts** – you currently boost **${boosts}×**\n${boostTierLines(settings, 'en', boosts).join('\n')}`,
        'The highest tier you reach always applies while your boost is active. If you already have a server in the smaller plan, it is upgraded automatically when you move up.',
      ].join('\n'),
    );
  }
  const [account] = await db.select({ id: users.id }).from(users).where(eq(users.discordId, d.author.id)).limit(1);
  if (!account) {
    parts.push(
      both({
        de: `Belohnungen gelten für deinen CraftingHosting.free-Account – verknüpfe dein Discord-Konto unter ${env.APP_URL}/de/meine-server`,
        en: `Rewards apply to your CraftingHosting.free account – link your Discord account at ${env.APP_URL}/my-servers`,
      }),
    );
  }
  await send({
    embeds: [{ title: '🎁 Belohnungen · Rewards', color: COLOR, description: parts.join('\n\n').slice(0, 4000) }],
    components: invite.components,
  });
}

/** Ankündigung des Belohnungssystems (Admin → Discord → „Ankündigung senden“) */
export async function sendRewardAnnouncement(channelId: string, roleId: string): Promise<void> {
  const settings = await getSettings();
  const invitesOn = settings.discord.inviteRewards.enabled && settings.discord.inviteRewards.tiers.length > 0;
  const boostsOn = settings.discord.boostRewards.enabled && settings.discord.boostRewards.tiers.length > 0;
  if (!invitesOn && !boostsOn) throw new Error('Es ist weder die Belohnung für Einladungen noch die für Boosts eingeschaltet.');
  const section = (lang: 'de' | 'en') =>
    [
      ...(invitesOn
        ? [
            lang === 'de' ? '**👥 Freunde einladen**' : '**👥 Invite friends**',
            ...inviteTierLines(settings, lang),
            lang === 'de'
              ? `Eine Einladung zählt, sobald die Person ihr Discord-Konto mit CraftingHosting.free verknüpft hat und ihr Server in den letzten ${settings.discord.inviteRewards.activeDays} Tagen online war. Nutze dafür deinen eigenen Einladungslink.`
              : `An invite counts as soon as the person has linked their Discord account with CraftingHosting.free and their server was online within the last ${settings.discord.inviteRewards.activeDays} days. Use your own invite link.`,
            '',
          ]
        : []),
      ...(boostsOn
        ? [
            lang === 'de' ? '**💜 Server boosten**' : '**💜 Boost the server**',
            ...boostTierLines(settings, lang),
            lang === 'de'
              ? 'Die Server gehören dir, solange dein Boost läuft. Hast du schon den kleineren Server, wird er beim nächsten Boost automatisch hochgestuft.'
              : 'The servers are yours while your boost is active. If you already have the smaller server, it is upgraded automatically with your next boost.',
            '',
          ]
        : []),
      lang === 'de'
        ? 'Schreibe mir per Direktnachricht **`!rewards`** – ich zeige dir deinen Stand und was du schon freigeschaltet hast.'
        : 'Send me **`!rewards`** as a direct message – I will show you your progress and what you have already unlocked.',
    ].join('\n');
  await botRequest('POST', `/channels/${channelId}/messages`, {
    json: {
      ...(roleId ? { content: `<@&${roleId}>` } : {}),
      embeds: [
        {
          title: '🎁 Unser Belohnungssystem ist online! · Our reward system is live!',
          color: COLOR,
          description: `🇩🇪 Hol dir zusätzliche kostenlose Server – als Dankeschön für deine Unterstützung.\n\n${section('de')}\n\n🇬🇧 Get extra free servers – as a thank-you for your support.\n\n${section('en')}`.slice(0, 4000),
          footer: { text: 'CraftingHosting.free' },
        },
      ],
      allowed_mentions: { parse: [], roles: roleId ? [roleId] : [] },
    },
  });
}
