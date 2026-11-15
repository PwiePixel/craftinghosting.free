/**
 * Support-Tickets auf Discord anlegen. Wird vom Ticket-Panel (Bot) und vom Support-Chat der Website
 * verwendet – beide brauchen nur die HTTP-API, keine Dauerverbindung.
 */
import { eq } from 'drizzle-orm';
import { getServerType, type DiscordSettings } from '@chfree/shared';
import { db } from '../db/client';
import { discordTickets, type Server, type User } from '../db/schema';
import { audit } from '../services/audit.service';
import { closeButton } from './messages';
import { CHANNEL, PERM, type DiscordChannel, type DiscordOverwrite } from './rest';
import { botRequest } from './service';
import { getDiscordState, patchDiscordState } from './store';

export const PRODUCT = { minecraft: { de: 'Minecraft-Server', en: 'Minecraft server' }, discord: { de: 'Discord-Bot', en: 'Discord bot' } } as const;

/** Kategorie für Ticket-Kanäle: Admin-Einstellung → vom Bot angelegte → vorhandene „Tickets“ → neu anlegen */
export async function ticketCategory(settings: DiscordSettings): Promise<string> {
  const state = await getDiscordState(true);
  const wanted = settings.ticketCategoryId || state.ticketCategoryId;
  const channels = await botRequest<DiscordChannel[]>('GET', `/guilds/${settings.guildId}/channels`);
  if (wanted && channels.some((c) => c.id === wanted && c.type === CHANNEL.category)) return wanted;
  const existing = channels.find((c) => c.type === CHANNEL.category && c.name?.toLowerCase() === 'tickets');
  const id =
    existing?.id ??
    (
      await botRequest<DiscordChannel>('POST', `/guilds/${settings.guildId}/channels`, {
        json: { name: 'Tickets', type: CHANNEL.category, permission_overwrites: [{ id: settings.guildId, type: 0, allow: '0', deny: PERM.viewChannel.toString() }] },
        reason: 'Kategorie für Support-Tickets',
      })
    ).id;
  await patchDiscordState({ ticketCategoryId: id });
  return id;
}

export interface OpenTicketInput {
  settings: DiscordSettings;
  discordUser: { id: string; username: string };
  /** Verknüpfter Account und betroffenes Produkt (falls bekannt) */
  user: User | null;
  server: Server | null;
  subject: string;
  text: string;
  german: boolean;
  /** Weitere Embeds unter der Ticket-Übersicht, z. B. der Verlauf aus dem Website-Chat */
  extraEmbeds?: unknown[];
  /** Hinweis über der Übersicht, z. B. „Übergabe von Crafting AI“ */
  note?: string;
}

/** Legt den Ticket-Kanal an und postet die Übersicht (Account-ID, Server-ID, Anliegen). */
export async function openTicket(input: OpenTicketInput): Promise<{ id: number; number: string; channelId: string; url: string }> {
  const { settings, discordUser, user, server, german: g } = input;
  const subject = input.subject.slice(0, 100);
  const [ticket] = await db.insert(discordTickets).values({ discordUserId: discordUser.id, userId: user?.id ?? null, serverId: server?.id ?? null, subject }).returning({ id: discordTickets.id });
  const number = String(ticket!.id).padStart(4, '0');
  try {
    const state = await getDiscordState();
    const access = (PERM.viewChannel | PERM.sendMessages | PERM.readHistory | PERM.attachFiles | PERM.embedLinks).toString();
    const overwrites: DiscordOverwrite[] = [
      { id: settings.guildId, type: 0, allow: '0', deny: PERM.viewChannel.toString() },
      { id: discordUser.id, type: 1, allow: access, deny: '0' },
      ...(settings.supportRoleId ? [{ id: settings.supportRoleId, type: 0 as const, allow: access, deny: '0' }] : []),
      ...(state.bot ? [{ id: state.bot.id, type: 1 as const, allow: (BigInt(access) | PERM.manageChannels).toString(), deny: '0' }] : []),
    ];
    const channel = await botRequest<DiscordChannel>('POST', `/guilds/${settings.guildId}/channels`, {
      json: {
        name: `ticket-${number}-${discordUser.username}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 90),
        type: CHANNEL.text,
        parent_id: await ticketCategory(settings),
        topic: `Ticket #${number} · ${subject}`.slice(0, 1000),
        permission_overwrites: overwrites,
      },
      reason: `Ticket #${number}`,
    });
    await db.update(discordTickets).set({ channelId: channel.id }).where(eq(discordTickets.id, ticket!.id));

    const inline = (name: string, value: string) => ({ name, value, inline: true });
    await botRequest('POST', `/channels/${channel.id}/messages`, {
      json: {
        content: `<@${discordUser.id}>${settings.supportRoleId ? ` <@&${settings.supportRoleId}>` : ''}${input.note ? `\n${input.note}` : ''}`.slice(0, 1900),
        allowed_mentions: { users: [discordUser.id], roles: settings.supportRoleId ? [settings.supportRoleId] : [] },
        embeds: [
          {
            title: `Ticket #${number} · ${subject}`.slice(0, 256),
            description: input.text.slice(0, 3500),
            color: 0x2563eb,
            fields: [
              inline(g ? 'Produkt' : 'Product', server ? `${PRODUCT[server.kind][g ? 'de' : 'en']}: ${server.name}` : g ? 'Allgemeine Frage' : 'General question'),
              inline('Account-ID', user ? `\`${user.id}\`` : g ? 'nicht verknüpft' : 'not linked'),
              ...(server
                ? [
                    inline('Server-ID', `\`${server.id}\``),
                    inline('Panel', server.pteroIdentifier ? `\`${server.pteroIdentifier}\`${server.pteroServerId ? ` (#${server.pteroServerId})` : ''}` : '–'),
                    inline(g ? 'Paket' : 'Plan', `${server.planId} · ${getServerType(server.serverType)?.name ?? server.serverType}`),
                    inline('Status', server.status),
                  ]
                : []),
              inline('Discord', `<@${discordUser.id}> (\`${discordUser.id}\`)`),
            ],
            footer: { text: g ? 'Das Support-Team meldet sich hier. Bitte keine Passwörter oder Tokens posten.' : 'The support team will reply here. Please do not post passwords or tokens.' },
            timestamp: new Date().toISOString(),
          },
          ...(input.extraEmbeds ?? []),
        ],
        components: [closeButton(g ? 'Ticket schließen' : 'Close ticket')],
      },
    });
    await audit({ userId: user?.id ?? null, serverId: server?.id ?? null, actor: 'user', action: 'discord.ticket_opened', message: `Ticket #${number} auf Discord eröffnet: ${subject}` });
    return { id: ticket!.id, number, channelId: channel.id, url: `https://discord.com/channels/${settings.guildId}/${channel.id}` };
  } catch (err) {
    // Kanal konnte nicht angelegt werden → das Ticket zählt nicht als offen
    await db.update(discordTickets).set({ status: 'closed', closedAt: new Date() }).where(eq(discordTickets.id, ticket!.id));
    throw err;
  }
}
