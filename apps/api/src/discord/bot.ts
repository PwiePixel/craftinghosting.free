/**
 * Der Discord-Bot: reagiert auf Ereignisse der Gateway-Verbindung.
 *  – Beitritt: Auto-Rollen und Willkommensnachricht
 *  – Befehle: /rolle, /wartung, /ticketpanel, /rollenpanel (nur Administratoren)
 *  – Buttons: Rollen-Panels und Ticketsystem
 */
import { and, count, desc, eq, gt, inArray } from 'drizzle-orm';
import { getServerType, type DiscordSettings } from '@chfree/shared';
import { db } from '../db/client';
import { discordTickets, servers, users } from '../db/schema';
import { env } from '../env';
import { audit } from '../services/audit.service';
import { buildCommands } from './commands';
import { onBoostMessage, setPremium } from './boost-rewards';
import { isPowerButton, onDirectMessage, onPowerButton } from './dm-power';
import { onGuildMessage } from './honeypot';
import { isRewardButton, onRewardButton, recordInvite, recordLeave, recordReturn } from './invite-rewards';
import { isRewardsCommand, onRewardsMessage } from './rewards';
import { sendTicketTranscript } from './transcripts';
import { TICKET, closeButton, deleteButton, rolePanelMessage, ticketPanelMessage, welcomeMessage } from './messages';
import {
  CHANNEL,
  DISCORD_CODES,
  DiscordApiError,
  PERM,
  discordErrorText,
  discordRequest,
  hasPerm,
  userDisplayName,
  type DiscordChannel,
  type DiscordInvite,
  type DiscordMember,
  type DiscordOverwrite,
  type DiscordRole,
  type DiscordUser,
} from './rest';
import { botRequest, discordConfig } from './service';
import { PRODUCT, openTicket } from './tickets';
import { getDiscordMaintenance, getDiscordState, patchDiscordState, saveDiscordMaintenance, type DiscordMaintenance } from './store';

export interface BotLogger {
  info(msg: string): void;
  warn(obj: unknown, msg?: string): void;
}

const EPHEMERAL = 64;
/** Antwortarten auf Interaktionen */
const REPLY = { message: 4, deferred: 5, update: 7, modal: 9 } as const;

interface Interaction {
  id: string;
  token: string;
  application_id: string;
  /** 2 = Befehl, 3 = Button/Auswahl, 5 = Formular */
  type: number;
  guild_id?: string;
  channel_id?: string;
  locale?: string;
  member?: DiscordMember;
  data?: {
    name?: string;
    custom_id?: string;
    values?: string[];
    options?: InteractionOption[];
    components?: { components?: { custom_id: string; value: string }[] }[];
    resolved?: { roles?: Record<string, DiscordRole>; users?: Record<string, DiscordUser> };
  };
}
interface InteractionOption {
  name: string;
  type: number;
  value?: string;
  options?: InteractionOption[];
}

/* ------------------------------------------------------------ Hilfen */

const de = (i: Interaction) => (i.locale ?? '').startsWith('de');
/** Text in der Sprache des Discord-Clients (Deutsch oder Englisch) */
const tr = (i: Interaction, german: string, english: string) => (de(i) ? german : english);

const reply = (i: Interaction, type: number, data?: unknown) => discordRequest('POST', `/interactions/${i.id}/${i.token}/callback`, { json: { type, ...(data ? { data } : {}) } });
const say = (i: Interaction, content: string) => reply(i, REPLY.message, { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } });
const defer = (i: Interaction) => reply(i, REPLY.deferred, { flags: EPHEMERAL });
/** Ändert die (aufgeschobene) Antwort. Das Token gilt 15 Minuten – danach schlägt die Änderung still fehl. */
const edit = (i: Interaction, content: string, extra: Record<string, unknown> = {}) =>
  discordRequest('PATCH', `/webhooks/${i.application_id}/${i.token}/messages/@original`, { json: { content, allowed_mentions: { parse: [] }, ...extra } }).catch(() => null);

const isAdmin = (i: Interaction) => hasPerm(i.member?.permissions, PERM.administrator);
const sub = (i: Interaction) => i.data?.options?.[0];
const opt = (o: InteractionOption | undefined, name: string) => o?.options?.find((x) => x.name === name)?.value;

const bits = (v: string | undefined) => {
  try {
    return BigInt(v ?? '0');
  } catch {
    return 0n;
  }
};

/** Alle Mitglieder des Servers (braucht den „Server Members Intent“ im Developer Portal) */
async function eachMember(guildId: string, fn: (member: DiscordMember) => Promise<void>): Promise<number> {
  let after = '0';
  let total = 0;
  for (;;) {
    const page = await botRequest<DiscordMember[]>('GET', `/guilds/${guildId}/members?limit=1000&after=${after}`);
    for (const m of page) {
      if (!m.user) continue;
      total++;
      await fn(m);
    }
    if (page.length < 1000) return total;
    after = page[page.length - 1]!.user!.id;
  }
}

/* ------------------------------------------------------------ Zustand im Speicher */

const memory = {
  memberCount: null as number | null,
  /** Einladungen und ihre Nutzungen – so lässt sich erkennen, über welche Einladung jemand kam */
  invites: new Map<string, { uses: number; inviterId: string | null; inviterName: string | null }>(),
  invitesLoaded: false,
};

async function loadInvites(guildId: string): Promise<DiscordInvite[] | null> {
  try {
    return await botRequest<DiscordInvite[]>('GET', `/guilds/${guildId}/invites`);
  } catch {
    return null; // ohne „Server verwalten“ gibt es keine Einladungsliste – dann bleibt die Herkunft unbekannt
  }
}

function rememberInvites(list: DiscordInvite[]) {
  memory.invites = new Map(list.map((x) => [x.code, { uses: x.uses ?? 0, inviterId: x.inviter?.id ?? null, inviterName: x.inviter ? userDisplayName(x.inviter) : null }]));
  memory.invitesLoaded = true;
}

/** Findet heraus, wer das neue Mitglied eingeladen hat (Vergleich der Nutzungen vorher/nachher). */
async function findInviter(guildId: string, userId: string, botId: string | null): Promise<{ inviter: string | null; invites: number; inviterId?: string; code?: string }> {
  const before = memory.invites;
  const known = memory.invitesLoaded;
  const now = await loadInvites(guildId);
  if (now) {
    rememberInvites(now);
    const used = known ? now.filter((x) => (x.uses ?? 0) > (before.get(x.code)?.uses ?? 0)) : [];
    const hit = used.length === 1 ? used[0]! : null;
    if (hit?.inviter && hit.inviter.id !== botId) {
      const total = now.filter((x) => x.inviter?.id === hit.inviter!.id).reduce((sum, x) => sum + (x.uses ?? 0), 0);
      return { inviter: userDisplayName(hit.inviter), invites: total, inviterId: hit.inviter.id, code: hit.code };
    }
    // Einladung des Bots = der Link von der Website
    if (hit) return { inviter: 'Website', invites: hit.uses ?? 0 };
  }
  // Über die Verknüpfung auf der Website beigetreten (kein Einladungslink im Spiel)
  const [linked] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.discordId, userId), gt(users.discordLinkedAt, new Date(Date.now() - 10 * 60_000))))
    .limit(1);
  return linked ? { inviter: 'Website', invites: 0 } : { inviter: null, invites: 0 };
}

/* ------------------------------------------------------------ Beitritt */

/**
 * Gibt einem neuen Mitglied mehrere Rollen. Ab vier Rollen in EINER Anfrage (sonst bräuchte jeder Beitritt
 * bis zu 20 Anfragen und liefe ins Anfrage-Limit). Scheitert die Sammel-Anfrage – etwa weil eine Rolle gelöscht
 * wurde oder über der Bot-Rolle steht –, werden die Rollen einzeln vergeben, damit die gültigen trotzdem ankommen.
 */
async function giveJoinRoles(guildId: string, userId: string, roles: string[], log: BotLogger): Promise<void> {
  if (roles.length === 0) return;
  const reason = 'Automatische Rolle beim Beitritt';
  if (roles.length > 3) {
    try {
      // Aktuelle Rollen frisch lesen, damit Rollen anderer Bots erhalten bleiben
      const member = await botRequest<DiscordMember>('GET', `/guilds/${guildId}/members/${userId}`);
      await botRequest('PATCH', `/guilds/${guildId}/members/${userId}`, { json: { roles: [...new Set([...member.roles, ...roles])] }, reason });
      return;
    } catch (err) {
      log.warn({ err: discordErrorText(err) }, 'Discord: Auto-Rollen ließen sich nicht gesammelt vergeben – versuche sie einzeln');
    }
  }
  for (const roleId of roles) {
    await botRequest('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, { reason }).catch((err) =>
      log.warn({ err: discordErrorText(err), roleId }, 'Discord: Auto-Rolle konnte nicht vergeben werden'),
    );
  }
}

async function onMemberAdd(member: DiscordMember & { guild_id: string }, log: BotLogger): Promise<void> {
  const cfg = await discordConfig();
  const user = member.user;
  if (!cfg.botReady || !user || member.guild_id !== cfg.settings.guildId) return;
  if (memory.memberCount !== null) memory.memberCount++;
  if (user.bot) return;
  const guildId = cfg.settings.guildId;

  // Herkunft immer ermitteln (genau einmal je Beitritt) und merken – Grundlage für die Einladungs-Belohnungen
  const botId = (await getDiscordState()).bot?.id ?? null;
  const origin = await findInviter(guildId, user.id, botId).catch(() => ({ inviter: null, invites: 0 }) as Awaited<ReturnType<typeof findInviter>>);
  if (origin.inviterId) await recordInvite(user.id, origin.inviterId, origin.code ?? null).catch((err) => log.warn({ err }, 'Discord: Einladung konnte nicht gespeichert werden'));
  else await recordReturn(user.id).catch(() => {});

  // Auto-Rollen – und während einer Wartung auch die Rolle „Wartung“
  const maintenance = await getDiscordMaintenance();
  const roles = [...cfg.settings.autoRoleIds, ...(maintenance?.roleId ? [maintenance.roleId] : [])];
  // Läuft neben der Willkommensnachricht her – viele Rollen sollen die Begrüßung nicht verzögern
  const rolesGiven = giveJoinRoles(guildId, user.id, roles, log);

  const w = cfg.settings.welcome;
  if (!w.enabled || !w.channelId) return void (await rolesGiven);
  try {
    const state = await getDiscordState();
    // Das Banner steht nur im vollständigen Profil
    const full = await botRequest<DiscordUser>('GET', `/users/${user.id}`).catch(() => user);
    const message = welcomeMessage(cfg.settings, state, {
      user: { ...user, ...full },
      inviter: origin.inviter,
      invites: origin.invites,
      memberCount: memory.memberCount ?? state.guild?.memberCount ?? null,
      joinedAt: member.joined_at ? new Date(member.joined_at) : new Date(),
    });
    await botRequest('POST', `/channels/${w.channelId}/messages`, { json: message });
  } catch (err) {
    log.warn({ err: discordErrorText(err) }, 'Discord: Willkommensnachricht konnte nicht gesendet werden');
  }
  await rolesGiven;
}

/* ------------------------------------------------------------ /rolle */

async function validRole(i: Interaction, guildId: string, roleId: string | undefined): Promise<DiscordRole | string> {
  const role = roleId ? i.data?.resolved?.roles?.[roleId] : undefined;
  if (!role) return tr(i, 'Diese Rolle kenne ich nicht.', 'I do not know this role.');
  if (role.id === guildId) return tr(i, '@everyone lässt sich nicht vergeben.', '@everyone cannot be assigned.');
  if (role.managed) return tr(i, 'Diese Rolle gehört zu einer Integration und lässt sich nicht von Hand vergeben.', 'This role belongs to an integration and cannot be assigned manually.');
  return role;
}

async function commandRole(i: Interaction, settings: DiscordSettings): Promise<void> {
  const s = sub(i);
  const guildId = settings.guildId;
  const role = await validRole(i, guildId, opt(s, 'rolle'));
  if (typeof role === 'string') return void (await say(i, `❌ ${role}`));

  if (s?.name === 'alle') {
    await defer(i);
    let done = 0;
    let failed = 0;
    let lastError = '';
    try {
      const total = await eachMember(guildId, async (m) => {
        if (m.user!.bot || m.roles.includes(role.id)) return;
        try {
          await botRequest('PUT', `/guilds/${guildId}/members/${m.user!.id}/roles/${role.id}`, { reason: `/rolle alle (${i.member?.user?.username ?? '?'})` });
          done++;
          if (done % 25 === 0) void edit(i, tr(i, `⏳ <@&${role.id}> wird vergeben … ${done} Mitglieder bisher.`, `⏳ Assigning <@&${role.id}> … ${done} members so far.`));
        } catch (err) {
          failed++;
          lastError = discordErrorText(err);
        }
      });
      const text = tr(
        i,
        `✅ <@&${role.id}> an ${done} Mitglieder vergeben (${total} geprüft${failed ? `, ${failed} fehlgeschlagen: ${lastError}` : ''}).`,
        `✅ Gave <@&${role.id}> to ${done} members (${total} checked${failed ? `, ${failed} failed: ${lastError}` : ''}).`,
      );
      // Bei sehr vielen Mitgliedern ist die Antwort nach 15 Minuten nicht mehr änderbar – dann als normale Nachricht
      if (!(await edit(i, text)) && i.channel_id) await botRequest('POST', `/channels/${i.channel_id}/messages`, { json: { content: text, allowed_mentions: { parse: [] } } }).catch(() => {});
    } catch (err) {
      await edit(i, `❌ ${discordErrorText(err)}${err instanceof DiscordApiError && err.status === 403 ? tr(i, ' Ist der „Server Members Intent“ im Developer Portal eingeschaltet?', ' Is the “Server Members Intent” enabled in the Developer Portal?') : ''}`);
    }
    return;
  }

  const userId = opt(s, 'nutzer');
  if (!userId) return void (await say(i, tr(i, '❌ Bitte ein Mitglied angeben.', '❌ Please choose a member.')));
  const give = s?.name === 'geben';
  try {
    await botRequest(give ? 'PUT' : 'DELETE', `/guilds/${guildId}/members/${userId}/roles/${role.id}`, { reason: `/rolle ${s?.name} (${i.member?.user?.username ?? '?'})` });
    await say(i, give ? tr(i, `✅ <@${userId}> hat jetzt <@&${role.id}>.`, `✅ <@${userId}> now has <@&${role.id}>.`) : tr(i, `✅ <@&${role.id}> wurde <@${userId}> genommen.`, `✅ Removed <@&${role.id}> from <@${userId}>.`));
  } catch (err) {
    await say(i, `❌ ${discordErrorText(err)}`);
  }
}

/* ------------------------------------------------------------ Rollen-Panels */

async function buttonRole(i: Interaction, settings: DiscordSettings): Promise<void> {
  const [, panelId, roleId] = i.data?.custom_id?.split(':') ?? [];
  const panel = settings.rolePanels.find((p) => p.id === panelId);
  const userId = i.member?.user?.id;
  // Nur Rollen, die aktuell im Admin-Bereich für dieses Panel eingetragen sind
  if (!panel || !roleId || !userId || !panel.buttons.some((b) => b.roleId === roleId)) {
    return void (await say(i, tr(i, '❌ Diese Rolle wird hier nicht mehr angeboten.', '❌ This role is no longer offered here.')));
  }
  const guildId = settings.guildId;
  const has = i.member?.roles.includes(roleId) ?? false;
  try {
    if (has) {
      await botRequest('DELETE', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, { reason: `Rollen-Panel „${panel.title}“` });
      return void (await say(i, tr(i, `➖ Du hast die Rolle <@&${roleId}> nicht mehr.`, `➖ You no longer have the role <@&${roleId}>.`)));
    }
    await botRequest('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, { reason: `Rollen-Panel „${panel.title}“` });
    if (panel.exclusive) {
      for (const other of panel.buttons) {
        if (other.roleId && other.roleId !== roleId && i.member?.roles.includes(other.roleId)) {
          await botRequest('DELETE', `/guilds/${guildId}/members/${userId}/roles/${other.roleId}`, { reason: `Rollen-Panel „${panel.title}“ (nur eine Rolle)` }).catch(() => {});
        }
      }
    }
    await say(i, tr(i, `✅ Du hast jetzt die Rolle <@&${roleId}>.`, `✅ You now have the role <@&${roleId}>.`));
  } catch (err) {
    await say(i, `❌ ${discordErrorText(err)}`);
  }
}

/* ------------------------------------------------------------ Tickets */

const LIVE = ['provisioning', 'provisioning_failed', 'active', 'expiring', 'suspended', 'pending', 'waitlist'] as const;

async function accountOf(discordId: string) {
  const [user] = await db.select().from(users).where(eq(users.discordId, discordId)).limit(1);
  if (!user) return { user: null, servers: [] as (typeof servers.$inferSelect)[] };
  const list = await db
    .select()
    .from(servers)
    .where(and(eq(servers.userId, user.id), inArray(servers.status, [...LIVE])))
    .orderBy(desc(servers.createdAt))
    .limit(20);
  return { user, servers: list };
}

async function ticketOpen(i: Interaction, settings: DiscordSettings): Promise<void> {
  const discordId = i.member?.user?.id;
  if (!discordId) return;
  if (await getDiscordMaintenance()) return void (await say(i, tr(i, '🔧 Während der Wartung können keine Tickets erstellt werden.', '🔧 Tickets cannot be created during maintenance.')));
  const [open] = await db.select({ n: count() }).from(discordTickets).where(and(eq(discordTickets.discordUserId, discordId), eq(discordTickets.status, 'open')));
  if (Number(open?.n ?? 0) >= settings.maxOpenTickets) {
    return void (await say(i, tr(i, '❌ Du hast bereits offene Tickets. Bitte nutze diese oder schließe sie zuerst.', '❌ You already have open tickets. Please use those or close them first.')));
  }
  const { user, servers: list } = await accountOf(discordId);
  const options = [
    ...list.map((s) => ({
      label: `${tr(i, PRODUCT[s.kind].de, PRODUCT[s.kind].en)}: ${s.name}`.slice(0, 100),
      value: s.id,
      description: `${getServerType(s.serverType)?.name ?? s.serverType} · ${s.planId}`.slice(0, 100),
      emoji: { name: s.kind === 'discord' ? '🤖' : '⛏️' },
    })),
    { label: tr(i, 'Allgemeine Frage / kein bestimmtes Produkt', 'General question / no specific product'), value: 'general', emoji: { name: '💬' } },
  ];
  const hint = user
    ? list.length
      ? tr(i, 'Worum geht es? Wähle das betroffene Produkt aus.', 'What is it about? Choose the product concerned.')
      : tr(i, 'Zu deinem Account gibt es gerade keinen Server. Du kannst trotzdem ein allgemeines Ticket öffnen.', 'There is no server on your account right now. You can still open a general ticket.')
    : tr(
        i,
        `Dein Discord-Konto ist noch nicht mit einem CraftingHosting.free-Account verknüpft. Verknüpfe es unter ${env.APP_URL}/de/meine-server – dann erkenne ich deine Server automatisch. Ein allgemeines Ticket geht auch so.`,
        `Your Discord account is not linked to a CraftingHosting.free account yet. Link it at ${env.APP_URL}/my-servers and I will recognise your servers automatically. You can still open a general ticket.`,
      );
  await reply(i, REPLY.message, {
    content: hint,
    flags: EPHEMERAL,
    components: [{ type: 1, components: [{ type: 3, custom_id: TICKET.product, placeholder: tr(i, 'Produkt auswählen', 'Choose a product'), options }] }],
  });
}

async function ticketForm(i: Interaction): Promise<void> {
  const value = i.data?.values?.[0] ?? 'general';
  await reply(i, REPLY.modal, {
    custom_id: `${TICKET.create}:${value}`,
    title: tr(i, 'Ticket erstellen', 'Create ticket'),
    components: [
      { type: 1, components: [{ type: 4, custom_id: 'subject', style: 1, label: tr(i, 'Betreff', 'Subject'), min_length: 3, max_length: 100, required: true }] },
      { type: 1, components: [{ type: 4, custom_id: 'text', style: 2, label: tr(i, 'Was ist passiert? Was hast du schon versucht?', 'What happened? What have you tried?'), min_length: 10, max_length: 1500, required: true }] },
    ],
  });
}

async function ticketCreate(i: Interaction, settings: DiscordSettings): Promise<void> {
  const discordUser = i.member?.user;
  if (!discordUser) return;
  await defer(i);
  const choice = i.data?.custom_id?.split(':')[2] ?? 'general';
  const fields = Object.fromEntries((i.data?.components ?? []).flatMap((r) => r.components ?? []).map((c) => [c.custom_id, c.value]));
  const { user, servers: list } = await accountOf(discordUser.id);
  // Das Produkt muss wirklich zu diesem Discord-Konto gehören
  const server = choice === 'general' ? null : (list.find((s) => s.id === choice) ?? null);
  try {
    const ticket = await openTicket({ settings, discordUser, user, server, subject: String(fields.subject ?? ''), text: String(fields.text ?? ''), german: de(i) });
    await edit(i, tr(i, `✅ Dein Ticket wurde erstellt: <#${ticket.channelId}>`, `✅ Your ticket has been created: <#${ticket.channelId}>`), { components: [] });
  } catch (err) {
    await edit(i, `❌ ${discordErrorText(err)}`, { components: [] });
  }
}

const isStaff = (i: Interaction, settings: DiscordSettings) => isAdmin(i) || (!!settings.supportRoleId && (i.member?.roles.includes(settings.supportRoleId) ?? false));

async function ticketClose(i: Interaction, settings: DiscordSettings): Promise<void> {
  const [ticket] = await db.select().from(discordTickets).where(eq(discordTickets.channelId, i.channel_id ?? '')).limit(1);
  const userId = i.member?.user?.id;
  if (!ticket || !i.channel_id) return void (await say(i, tr(i, '❌ Das ist kein Ticket-Kanal.', '❌ This is not a ticket channel.')));
  if (ticket.discordUserId !== userId && !isStaff(i, settings)) return void (await say(i, tr(i, '❌ Nur du selbst oder das Team kann dieses Ticket schließen.', '❌ Only you or the team can close this ticket.')));
  if (ticket.status === 'closed') return void (await say(i, tr(i, 'Dieses Ticket ist bereits geschlossen.', 'This ticket is already closed.')));
  await defer(i);
  try {
    await db.update(discordTickets).set({ status: 'closed', closedAt: new Date() }).where(eq(discordTickets.id, ticket.id));
    // Der Ersteller verliert den Zugriff, das Team behält den Verlauf und kann den Kanal löschen
    await botRequest('PUT', `/channels/${i.channel_id}/permissions/${ticket.discordUserId}`, { json: { type: 1, allow: '0', deny: PERM.viewChannel.toString() }, reason: 'Ticket geschlossen' });
    await botRequest('PATCH', `/channels/${i.channel_id}`, { json: { name: `geschlossen-${String(ticket.id).padStart(4, '0')}` }, reason: 'Ticket geschlossen' }).catch(() => {});
    await botRequest('POST', `/channels/${i.channel_id}/messages`, {
      json: { content: `🔒 Ticket geschlossen von <@${userId}> · closed by <@${userId}>`, allowed_mentions: { parse: [] }, components: [deleteButton('Ticket löschen / Delete ticket')] },
    });
    // Transkript für die interne Aufbewahrung (Kanal aus dem Admin-Bereich) – mit dem gerade geschlossenen Stand
    const sent = await sendTicketTranscript({ ...ticket, status: 'closed', closedAt: new Date() }, settings, userId ?? null);
    await edit(i, sent === 'failed' ? tr(i, '✅ Ticket geschlossen. ⚠️ Das Transkript konnte nicht gesendet werden – es wird beim Löschen erneut versucht.', '✅ Ticket closed. ⚠️ The transcript could not be sent – it will be retried on deletion.') : tr(i, '✅ Ticket geschlossen.', '✅ Ticket closed.'));
  } catch (err) {
    await edit(i, `❌ ${discordErrorText(err)}`);
  }
}

async function ticketDelete(i: Interaction, settings: DiscordSettings): Promise<void> {
  if (!isStaff(i, settings)) return void (await say(i, tr(i, '❌ Nur das Team kann Tickets löschen.', '❌ Only the team can delete tickets.')));
  const [ticket] = await db.select().from(discordTickets).where(eq(discordTickets.channelId, i.channel_id ?? '')).limit(1);
  if (!ticket || !i.channel_id) return void (await say(i, tr(i, '❌ Das ist kein Ticket-Kanal.', '❌ This is not a ticket channel.')));
  await say(i, tr(i, '🗑️ Der Kanal wird gelöscht …', '🗑️ Deleting the channel …'));
  await db.update(discordTickets).set({ status: 'closed', closedAt: ticket.closedAt ?? new Date() }).where(eq(discordTickets.id, ticket.id));
  // Noch kein Transkript (z. B. direkt gelöscht oder beim Schließen fehlgeschlagen): jetzt, bevor der Verlauf weg ist.
  // Scheitert es, bleibt der Kanal stehen – sonst ginge der Verlauf verloren.
  const sent = await sendTicketTranscript({ ...ticket, status: 'closed', closedAt: ticket.closedAt ?? new Date() }, settings, ticket.closedAt ? null : (i.member?.user?.id ?? null));
  if (sent === 'failed') {
    await botRequest('POST', `/channels/${i.channel_id}/messages`, { json: { content: '⚠️ Das Transkript konnte nicht gesendet werden – der Kanal bleibt deshalb erhalten. Bitte prüfe den Transkript-Kanal (Rechte des Bots) und lösche das Ticket danach erneut.' } }).catch(() => {});
    return;
  }
  await botRequest('DELETE', `/channels/${i.channel_id}`, { reason: 'Ticket gelöscht' }).catch(() => {});
}

/* ------------------------------------------------------------ /wartung */

const MAINTENANCE_ROLE = 'Wartung';

/**
 * Wartung starten. So wird der Server gesperrt:
 *  1. Die Berechtigungen aller Kanäle werden gesichert.
 *  2. In jedem Kanal wird „Kanal ansehen“ für @everyone verweigert und aus allen Freigaben entfernt
 *     (Freigaben einzelner Rollen würden die Sperre sonst aufheben). Administratoren sehen weiter alles.
 *  3. Ein Hinweis-Kanal erklärt die Wartung; alle Mitglieder bekommen die Rolle „Wartung“.
 */
async function maintenanceOn(i: Interaction, settings: DiscordSettings, log: BotLogger): Promise<void> {
  await defer(i);
  if (await getDiscordMaintenance()) return void (await edit(i, tr(i, '🔧 Die Wartung läuft bereits. Beenden mit `/wartung aus`.', '🔧 Maintenance is already active. End it with `/wartung aus`.')));
  const guildId = settings.guildId;
  const state = await getDiscordState();
  try {
    const [channels, roles, me] = await Promise.all([
      botRequest<DiscordChannel[]>('GET', `/guilds/${guildId}/channels`),
      botRequest<DiscordRole[]>('GET', `/guilds/${guildId}/roles`),
      state.bot ? botRequest<DiscordMember>('GET', `/guilds/${guildId}/members/${state.bot.id}`) : Promise.resolve(null),
    ]);
    // Ohne Administrator-Recht würde sich der Bot selbst aussperren und könnte die Kanäle nicht wieder freigeben
    const botIsAdmin = !!me && roles.some((r) => (me.roles.includes(r.id) || r.id === guildId) && hasPerm(r.permissions, PERM.administrator));
    if (!botIsAdmin) {
      return void (await edit(i, tr(i, '❌ Für die Wartung braucht die Bot-Rolle das Recht „Administrator“ – sonst könnte der Bot die Kanäle später nicht wieder freigeben.', '❌ The bot role needs the “Administrator” permission for maintenance – otherwise the bot could not unlock the channels again.')));
    }

    const role =
      roles.find((r) => r.name === MAINTENANCE_ROLE && !r.managed) ??
      (await botRequest<DiscordRole>('POST', `/guilds/${guildId}/roles`, { json: { name: MAINTENANCE_ROLE, permissions: '0', color: 0xf59e0b, hoist: true, mentionable: false }, reason: 'Wartung' }));

    const maintenance: DiscordMaintenance = {
      active: true,
      startedAt: new Date().toISOString(),
      by: i.member?.user?.id ?? '',
      reason: String(opt(sub(i), 'grund') ?? '').slice(0, 300),
      roleId: role.id,
      infoChannelId: null,
      snapshot: Object.fromEntries(channels.map((c) => [c.id, c.permission_overwrites ?? []])),
    };
    // Erst sichern, dann ändern – so lässt sich alles wiederherstellen, auch wenn unterwegs etwas schiefgeht
    await saveDiscordMaintenance(maintenance);

    const view = PERM.viewChannel;
    let failed = 0;
    for (const [n, c] of channels.entries()) {
      const overwrites = c.permission_overwrites ?? [];
      try {
        for (const o of overwrites) {
          if (o.id !== guildId && bits(o.allow) & view) {
            await botRequest('PUT', `/channels/${c.id}/permissions/${o.id}`, { json: { type: o.type, allow: (bits(o.allow) & ~view).toString(), deny: o.deny }, reason: 'Wartung' });
          }
        }
        const everyone = overwrites.find((o) => o.id === guildId);
        await botRequest('PUT', `/channels/${c.id}/permissions/${guildId}`, {
          json: { type: 0, allow: (bits(everyone?.allow) & ~view).toString(), deny: (bits(everyone?.deny) | view).toString() },
          reason: 'Wartung',
        });
      } catch (err) {
        failed++;
        log.warn({ err: discordErrorText(err), channel: c.id }, 'Discord: Kanal konnte für die Wartung nicht gesperrt werden');
      }
      if ((n + 1) % 10 === 0) void edit(i, tr(i, `⏳ Kanäle werden gesperrt … ${n + 1}/${channels.length}`, `⏳ Locking channels … ${n + 1}/${channels.length}`));
    }

    // Hinweis-Kanal: das Einzige, was Mitglieder während der Wartung sehen
    try {
      const info = await botRequest<DiscordChannel>('POST', `/guilds/${guildId}/channels`, {
        json: {
          name: '🔧-wartung',
          type: CHANNEL.text,
          position: 0,
          permission_overwrites: [{ id: guildId, type: 0, allow: (PERM.viewChannel | PERM.readHistory).toString(), deny: PERM.sendMessages.toString() }],
        },
        reason: 'Wartung',
      });
      maintenance.infoChannelId = info.id;
      await saveDiscordMaintenance(maintenance);
      await botRequest('POST', `/channels/${info.id}/messages`, {
        json: {
          embeds: [
            {
              title: '🔧 Wartungsarbeiten · Maintenance',
              description: `DE: Wir arbeiten gerade an diesem Discord-Server. Die Kanäle sind in Kürze wieder für dich sichtbar.\n\nEN: We are currently working on this Discord server. The channels will be visible to you again shortly.${maintenance.reason ? `\n\n**${maintenance.reason}**` : ''}`,
              color: 0xf59e0b,
              timestamp: maintenance.startedAt,
            },
          ],
        },
      });
    } catch (err) {
      log.warn({ err: discordErrorText(err) }, 'Discord: Hinweis-Kanal für die Wartung konnte nicht angelegt werden');
    }

    await edit(
      i,
      tr(
        i,
        `🔧 Wartung aktiv: ${channels.length - failed} von ${channels.length} Kanälen gesperrt${failed ? ` (${failed} fehlgeschlagen – siehe Protokoll)` : ''}. Nur Administratoren sehen noch alle Kanäle. Die Rolle <@&${role.id}> wird jetzt an alle Mitglieder vergeben. Beenden mit \`/wartung aus\`.`,
        `🔧 Maintenance active: ${channels.length - failed} of ${channels.length} channels locked${failed ? ` (${failed} failed – see log)` : ''}. Only administrators still see all channels. The role <@&${role.id}> is now being given to all members. End it with \`/wartung aus\`.`,
      ),
    );
    await audit({ actor: 'admin', action: 'discord.maintenance_on', message: `Discord-Wartung gestartet (${channels.length} Kanäle)${maintenance.reason ? `: ${maintenance.reason}` : ''}` });

    // Rolle „Wartung“ für alle – läuft im Hintergrund weiter
    let given = 0;
    await eachMember(guildId, async (m) => {
      if (m.user!.bot || m.roles.includes(role.id) || !(await getDiscordMaintenance())) return;
      await botRequest('PUT', `/guilds/${guildId}/members/${m.user!.id}/roles/${role.id}`, { reason: 'Wartung' }).then(
        () => given++,
        () => {},
      );
    }).catch((err) => log.warn({ err: discordErrorText(err) }, 'Discord: Rolle „Wartung“ konnte nicht an alle vergeben werden (Server Members Intent eingeschaltet?)'));
    log.info(`Discord: Wartung aktiv – Rolle „${MAINTENANCE_ROLE}“ an ${given} Mitglieder vergeben`);
  } catch (err) {
    await edit(i, `❌ ${discordErrorText(err)}`);
  }
}

/** Wartung beenden: gesicherte Berechtigungen zurückspielen, Hinweis-Kanal und Rolle entfernen. Lässt sich gefahrlos wiederholen. */
async function maintenanceOff(i: Interaction, settings: DiscordSettings, log: BotLogger): Promise<void> {
  await defer(i);
  const maintenance = await getDiscordMaintenance();
  if (!maintenance) return void (await edit(i, tr(i, 'Es läuft gerade keine Wartung.', 'No maintenance is active right now.')));
  const guildId = settings.guildId;
  try {
    const channels = await botRequest<DiscordChannel[]>('GET', `/guilds/${guildId}/channels`);
    let failed = 0;
    let done = 0;
    for (const c of channels) {
      const original = maintenance.snapshot[c.id];
      if (!original) continue; // erst während der Wartung angelegt – bleibt, wie er ist
      const current = c.permission_overwrites ?? [];
      try {
        for (const o of original) {
          const now = current.find((x) => x.id === o.id);
          if (!now || now.allow !== o.allow || now.deny !== o.deny) {
            await botRequest('PUT', `/channels/${c.id}/permissions/${o.id}`, { json: { type: o.type, allow: o.allow, deny: o.deny }, reason: 'Wartung beendet' });
          }
        }
        // @everyone hatte vorher keinen eigenen Eintrag → der Sperr-Eintrag wird wieder entfernt
        if (!original.some((o) => o.id === guildId) && current.some((o) => o.id === guildId)) {
          await botRequest('DELETE', `/channels/${c.id}/permissions/${guildId}`, { reason: 'Wartung beendet' });
        }
      } catch (err) {
        failed++;
        log.warn({ err: discordErrorText(err), channel: c.id }, 'Discord: Berechtigungen eines Kanals konnten nicht wiederhergestellt werden');
      }
      if (++done % 10 === 0) void edit(i, tr(i, `⏳ Kanäle werden freigegeben … ${done}`, `⏳ Unlocking channels … ${done}`));
    }
    if (failed) {
      // Sicherung behalten – ein weiterer Aufruf setzt dort fort
      return void (await edit(i, tr(i, `⚠️ ${failed} Kanäle konnten nicht wiederhergestellt werden. Die Sicherung bleibt erhalten – bitte \`/wartung aus\` erneut ausführen.`, `⚠️ ${failed} channels could not be restored. The backup is kept – please run \`/wartung aus\` again.`)));
    }
    if (maintenance.infoChannelId) await botRequest('DELETE', `/channels/${maintenance.infoChannelId}`, { reason: 'Wartung beendet' }).catch(() => {});
    // Die Rolle zu löschen nimmt sie allen Mitgliedern auf einmal
    if (maintenance.roleId) {
      await botRequest('DELETE', `/guilds/${guildId}/roles/${maintenance.roleId}`, { reason: 'Wartung beendet' }).catch((err) => {
        if (!(err instanceof DiscordApiError) || err.code !== DISCORD_CODES.unknownRole) log.warn({ err: discordErrorText(err) }, 'Discord: Rolle „Wartung“ konnte nicht gelöscht werden');
      });
    }
    await saveDiscordMaintenance(null);
    await audit({ actor: 'admin', action: 'discord.maintenance_off', message: 'Discord-Wartung beendet' });
    await edit(i, tr(i, '✅ Wartung beendet: Alle Kanäle sind wieder wie vorher sichtbar, die Rolle „Wartung“ wurde entfernt.', '✅ Maintenance ended: all channels are visible as before and the “Wartung” role has been removed.'));
  } catch (err) {
    await edit(i, `❌ ${discordErrorText(err)}`);
  }
}

async function commandMaintenance(i: Interaction, settings: DiscordSettings, log: BotLogger): Promise<void> {
  const name = sub(i)?.name;
  if (name === 'an') return maintenanceOn(i, settings, log);
  if (name === 'aus') return maintenanceOff(i, settings, log);
  const m = await getDiscordMaintenance();
  await say(
    i,
    m
      ? tr(i, `🔧 Wartung aktiv seit <t:${Math.floor(Date.parse(m.startedAt) / 1000)}:R>, gestartet von <@${m.by}>.${m.reason ? ` Grund: ${m.reason}` : ''}`, `🔧 Maintenance active since <t:${Math.floor(Date.parse(m.startedAt) / 1000)}:R>, started by <@${m.by}>.${m.reason ? ` Reason: ${m.reason}` : ''}`)
      : tr(i, 'Es läuft gerade keine Wartung.', 'No maintenance is active right now.'),
  );
}

/* ------------------------------------------------------------ Verteiler */

async function onInteraction(i: Interaction, log: BotLogger): Promise<void> {
  const cfg = await discordConfig();
  if (!cfg.botReady) return;
  // Server per Direktnachricht steuern (!start, !stop, !restart, EULA): die einzigen Buttons, die außerhalb des Servers funktionieren
  // Belohnung einlösen (Button aus einer Direktnachricht)
  if (i.type === 3 && isRewardButton(i.data?.custom_id)) {
    return onRewardButton(i).catch((err) => log.warn({ err: discordErrorText(err) }, 'Discord: Belohnung konnte nicht eingelöst werden'));
  }
  if (i.type === 3 && isPowerButton(i.data?.custom_id)) {
    if (!cfg.settings.dmStart) return;
    return onPowerButton(i).catch((err) => log.warn({ err: discordErrorText(err) }, 'Discord: Server-Steuerung per Nachricht fehlgeschlagen'));
  }
  if (i.guild_id !== cfg.settings.guildId) return;
  const settings = cfg.settings;
  try {
    if (i.type === 2) {
      // Befehle sind nur für Administratoren – unabhängig davon, was in den Servereinstellungen freigegeben wurde
      if (!isAdmin(i)) return void (await say(i, tr(i, '❌ Dieser Befehl ist nur für Administratoren.', '❌ This command is for administrators only.')));
      const state = await getDiscordState();
      switch (i.data?.name) {
        case 'rolle':
          return await commandRole(i, settings);
        case 'wartung':
          return await commandMaintenance(i, settings, log);
        case 'ticketpanel':
          await botRequest('POST', `/channels/${i.channel_id}/messages`, { json: ticketPanelMessage(state) });
          return void (await say(i, tr(i, '✅ Ticket-Panel gepostet.', '✅ Ticket panel posted.')));
        case 'rollenpanel': {
          const panel = settings.rolePanels.find((p) => p.id === i.data?.options?.[0]?.value);
          if (!panel || !panel.buttons.some((b) => b.roleId)) {
            return void (await say(i, tr(i, '❌ Für dieses Panel sind im Admin-Bereich noch keine Rollen eingetragen.', '❌ No roles have been configured for this panel in the admin area yet.')));
          }
          await botRequest('POST', `/channels/${i.channel_id}/messages`, { json: rolePanelMessage(panel, state) });
          return void (await say(i, tr(i, '✅ Rollen-Panel gepostet.', '✅ Role panel posted.')));
        }
      }
      return;
    }
    const id = i.data?.custom_id ?? '';
    if (i.type === 3) {
      if (id.startsWith('role:')) return await buttonRole(i, settings);
      if (id === TICKET.open) return await ticketOpen(i, settings);
      if (id === TICKET.product) return await ticketForm(i);
      if (id === TICKET.close) return await ticketClose(i, settings);
      if (id === TICKET.remove) return await ticketDelete(i, settings);
    }
    if (i.type === 5 && id.startsWith(`${TICKET.create}:`)) return await ticketCreate(i, settings);
  } catch (err) {
    log.warn({ err: discordErrorText(err), interaction: i.data?.name ?? i.data?.custom_id }, 'Discord: Interaktion fehlgeschlagen');
    await say(i, `❌ ${discordErrorText(err)}`).catch(() => edit(i, `❌ ${discordErrorText(err)}`));
  }
}

/** Nach dem Verbinden: Befehle registrieren, Server-Daten und Einladungen merken */
async function onReady(d: { user: DiscordUser }, log: BotLogger): Promise<void> {
  const cfg = await discordConfig();
  if (!cfg.botReady) return;
  await patchDiscordState({ bot: { id: d.user.id, username: d.user.username, avatar: d.user.avatar ?? null } });
  try {
    await botRequest('PUT', `/applications/${d.user.id}/guilds/${cfg.settings.guildId}/commands`, { json: buildCommands(cfg.settings) });
    await patchDiscordState({ commandsAt: new Date().toISOString() });
  } catch (err) {
    log.warn({ err: discordErrorText(err) }, 'Discord: Befehle konnten nicht registriert werden');
  }
  const invites = await loadInvites(cfg.settings.guildId);
  if (invites) rememberInvites(invites);
}

/** Einstiegspunkt für alle Ereignisse der Gateway-Verbindung */
export async function handleDiscordEvent(type: string, d: any, log: BotLogger): Promise<void> {
  switch (type) {
    case 'READY':
      return onReady(d, log);
    case 'GUILD_CREATE': {
      const { settings } = await discordConfig();
      if (d.id !== settings.guildId) return;
      memory.memberCount = typeof d.member_count === 'number' ? d.member_count : null;
      await patchDiscordState({ guild: { name: d.name, icon: d.icon ?? null, memberCount: memory.memberCount } });
      return;
    }
    case 'GUILD_MEMBER_ADD':
      return onMemberAdd(d, log);
    case 'GUILD_MEMBER_REMOVE': {
      if (memory.memberCount !== null && memory.memberCount > 0) memory.memberCount--;
      const { settings } = await discordConfig();
      // Wer geht, zählt nicht mehr als Einladung – und boostet auch nicht mehr
      if (d.guild_id === settings.guildId && d.user?.id) {
        await recordLeave(d.user.id).catch(() => {});
        await setPremium(d.user.id, false).catch(() => {});
      }
      return;
    }
    case 'GUILD_MEMBER_UPDATE': {
      const { settings, botReady } = await discordConfig();
      // premium_since: gesetzt, solange das Mitglied den Server boostet
      if (botReady && d.guild_id === settings.guildId && d.user?.id && !d.user.bot && 'premium_since' in d) {
        await setPremium(d.user.id, !!d.premium_since).catch((err) => log.warn({ err }, 'Discord: Boost-Status konnte nicht gespeichert werden'));
      }
      return;
    }
    case 'INVITE_CREATE':
      memory.invites.set(d.code, { uses: 0, inviterId: d.inviter?.id ?? null, inviterName: d.inviter ? userDisplayName(d.inviter) : null });
      return;
    case 'INVITE_DELETE':
      memory.invites.delete(d.code);
      return;
    case 'MESSAGE_CREATE': {
      if (d.guild_id) {
        const { settings, botReady } = await discordConfig();
        if (!botReady || d.guild_id !== settings.guildId) return;
        // Systemnachricht „… hat den Server geboostet“ (Typen 8–11): ein Boost dieses Mitglieds
        if (typeof d.type === 'number' && d.type >= 8 && d.type <= 11 && d.author?.id && !d.author.bot) {
          return onBoostMessage(d.author.id).catch((err) => log.warn({ err }, 'Discord: Boost konnte nicht verarbeitet werden'));
        }
        return void (await onGuildMessage(d, settings, log));
      }
      // Direktnachrichten: „!rewards“ zeigt die Belohnungen, sonst Server-Steuerung
      if (isRewardsCommand(d.content)) return onRewardsMessage(d);
      return onDirectMessage(d);
    }
    case 'INTERACTION_CREATE':
      return onInteraction(d, log);
  }
}
