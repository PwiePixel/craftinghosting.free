/**
 * Discord-Anbindung, soweit sie ohne Dauerverbindung auskommt (läuft in API und Worker):
 * Konto verknüpfen (OAuth), Mitgliedschaft prüfen, Customer-Rolle, Einladungslink, Einrichtung.
 * Befehle, Buttons, Willkommensnachricht und Tickets stehen in bot.ts (braucht die Gateway-Verbindung).
 */
import { and, eq, exists, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { localePath, snowflakeDate, type AdminDiscordDTO, type DiscordSettings, type DiscordSetupStep, type Locale } from '@chfree/shared';
import { db, isUniqueViolation } from '../db/client';
import { servers, users, type User } from '../db/schema';
import { env } from '../env';
import { signToken, verifySignedToken } from '../lib/crypto';
import { audit } from '../services/audit.service';
import { getSettings, invalidatePublicSite } from '../services/settings.service';
import { buildCommands } from './commands';
import {
  CHANNEL,
  DISCORD_CODES,
  DiscordApiError,
  discordErrorText,
  discordRequest,
  userDisplayName,
  type DiscordChannel,
  type DiscordGuild,
  type DiscordInvite,
  type DiscordMember,
  type DiscordRequest,
  type DiscordUser,
} from './rest';
import { getDiscordSecrets, getDiscordState, patchDiscordState } from './store';

/** Server in diesen Zuständen machen ihren Besitzer zum „Customer“ */
const CUSTOMER_STATUSES = ['provisioning', 'provisioning_failed', 'active', 'expiring', 'suspended'] as const;

export interface DiscordConfig {
  settings: DiscordSettings;
  botToken: string | null;
  clientSecret: string | null;
  /** Bot kann arbeiten: eingeschaltet, Token und Server-ID vorhanden */
  botReady: boolean;
  /** Verknüpfen ist möglich: zusätzlich Client-ID und Client-Secret vorhanden */
  linkReady: boolean;
}

export async function discordConfig(): Promise<DiscordConfig> {
  const [site, secrets] = await Promise.all([getSettings(), getDiscordSecrets()]);
  const s = site.discord;
  const botReady = s.enabled && !!secrets.botToken && !!s.guildId;
  return { settings: s, ...secrets, botReady, linkReady: botReady && !!s.clientId && !!secrets.clientSecret };
}

/** Anfrage mit dem Bot-Token */
export async function botRequest<T = unknown>(method: string, path: string, opts: Omit<DiscordRequest, 'botToken' | 'bearer'> = {}): Promise<T> {
  const { botToken } = await getDiscordSecrets();
  if (!botToken) throw new Error('Es ist kein Bot-Token hinterlegt.');
  return discordRequest<T>(method, path, { ...opts, botToken });
}

/* ------------------------------------------------------------ Verknüpfen (OAuth) */

const STATE_PURPOSE = 'discord-oauth';
const STATE_TTL_MS = 15 * 60_000;

export const discordRedirectUri = () => `${env.APP_URL}/api/v1/discord/callback`;

/**
 * Wer die Verbindung gestartet hat: ein angemeldeter Account (`chat` = aus dem Support-Chat heraus)
 * oder – ohne Anmeldung – eine Unterhaltung im Support-Chat.
 */
export type OAuthSubject = { kind: 'user'; id: string; chat: boolean } | { kind: 'chat'; id: string };

/** Adresse, auf der Discord nach der Zustimmung fragt. Der Zustand ist an den Account bzw. die Unterhaltung gebunden. */
export async function discordAuthorizeUrl(subject: OAuthSubject, lang: Locale): Promise<string | null> {
  const cfg = await discordConfig();
  if (!cfg.linkReady) return null;
  const value = [subject.kind === 'user' ? 'u' : 'c', subject.id, Date.now() + STATE_TTL_MS, lang, subject.kind === 'user' && subject.chat ? 1 : 0].join(':');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.settings.clientId,
    // guilds.join: Der Bot darf das Konto dem Discord-Server hinzufügen – so ist Verknüpfen = Beitreten.
    // Aus dem Chat heraus immer, weil die Übergabe an das Team die Mitgliedschaft voraussetzt.
    scope: cfg.settings.autoJoin || subject.kind === 'chat' || subject.chat ? 'identify guilds.join' : 'identify',
    redirect_uri: discordRedirectUri(),
    state: signToken(value, STATE_PURPOSE),
    prompt: 'consent',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export type LinkResult = 'linked' | 'linked_not_member' | 'state' | 'taken' | 'too_new' | 'bot_account' | 'unavailable' | 'failed';

/** Sprache aus dem Zustand – auch wenn die Prüfung fehlschlägt, soll die Meldung in der richtigen Sprache kommen */
export function langFromState(state: string | undefined): Locale {
  return state?.split('.')[0]?.split(':')[3] === 'en' ? 'en' : 'de';
}

/** Prüft Signatur und Ablauf des Zustands. null = ungültig oder abgelaufen. */
export function parseDiscordState(state: string): (OAuthSubject & { lang: Locale }) | null {
  const [kind, id, expires, lang, chat] = verifySignedToken(state, STATE_PURPOSE)?.split(':') ?? [];
  if (!id || Number(expires) < Date.now()) return null;
  const locale: Locale = lang === 'en' ? 'en' : 'de';
  if (kind === 'u') return { kind: 'user', id, chat: chat === '1', lang: locale };
  if (kind === 'c') return { kind: 'chat', id, lang: locale };
  return null;
}

type Exchange = { ok: true; discordUser: DiscordUser; member: boolean } | { ok: false; reason: 'too_new' | 'bot_account' | 'unavailable' | 'failed' };

/**
 * Löst den Code von Discord ein, prüft das Konto und lässt es – wenn erlaubt – dem Server beitreten.
 * Das Zugriffstoken wird nur dafür benutzt und nicht gespeichert.
 */
async function exchangeDiscordCode(code: string, before?: (discordUser: DiscordUser) => Promise<LinkResult | null>): Promise<Exchange | { ok: false; reason: LinkResult }> {
  const cfg = await discordConfig();
  if (!cfg.linkReady) return { ok: false, reason: 'unavailable' };
  let discordUser: DiscordUser;
  let accessToken: string;
  let scope: string;
  try {
    const token = await discordRequest<{ access_token: string; scope?: string }>('POST', '/oauth2/token', {
      form: { client_id: cfg.settings.clientId, client_secret: cfg.clientSecret!, grant_type: 'authorization_code', code, redirect_uri: discordRedirectUri() },
    });
    accessToken = token.access_token;
    scope = token.scope ?? '';
    discordUser = await discordRequest<DiscordUser>('GET', '/users/@me', { bearer: accessToken });
  } catch {
    return { ok: false, reason: 'failed' };
  }
  if (discordUser.bot) return { ok: false, reason: 'bot_account' };
  // Frisch angelegte Konten sind das typische Werkzeug für Mehrfach-Anmeldungen
  if (cfg.settings.minAccountAgeDays > 0 && Date.now() - snowflakeDate(discordUser.id).getTime() < cfg.settings.minAccountAgeDays * 86_400_000) return { ok: false, reason: 'too_new' };
  // Schritt des Aufrufers (z. B. im Account speichern) – bricht ab, wenn das Konto schon vergeben ist
  const stop = await before?.(discordUser);
  if (stop) return { ok: false, reason: stop };

  // Dem Server beitreten lassen (201 = hinzugefügt, 204 = war schon Mitglied)
  let member = false;
  if (scope.split(' ').includes('guilds.join')) {
    try {
      await botRequest('PUT', `/guilds/${cfg.settings.guildId}/members/${discordUser.id}`, { json: { access_token: accessToken } });
      member = true;
    } catch {
      /* z. B. gebannt oder Bot ohne Berechtigung – die Prüfung unten entscheidet */
    }
  }
  if (!member) member = (await fetchDiscordMember(discordUser.id).catch(() => null)) !== null;
  return { ok: true, discordUser, member };
}

/** Zweiter Schritt der Verknüpfung mit einem Account: Code einlösen, Konto prüfen, speichern, dem Server beitreten lassen */
export async function linkDiscordAccount(user: User, code: string, ip?: string): Promise<LinkResult> {
  const result = await exchangeDiscordCode(code, async (discordUser) => {
    const [other] = await db.select({ id: users.id }).from(users).where(and(eq(users.discordId, discordUser.id), ne(users.id, user.id))).limit(1);
    if (other) return 'taken';
    try {
      await db
        .update(users)
        .set({ discordId: discordUser.id, discordUsername: discordUser.username.slice(0, 64), discordLinkedAt: new Date(), discordCustomerRole: false, discordSyncAt: null })
        .where(eq(users.id, user.id));
    } catch (err) {
      if (isUniqueViolation(err)) return 'taken';
      throw err;
    }
    await audit({ userId: user.id, actor: 'user', action: 'discord.linked', message: `Discord-Konto ${userDisplayName(discordUser)} (${discordUser.id}) verknüpft`, ip });
    return null;
  });
  if (!result.ok) return result.reason;
  return result.member ? 'linked' : 'linked_not_member';
}

/**
 * Verbindung aus dem Support-Chat ohne Website-Account: Das Discord-Konto wird nicht mit einem Account verknüpft,
 * sondern nur für die Übergabe an das Team festgestellt (und dem Server hinzugefügt).
 */
export async function connectDiscordForChat(code: string): Promise<{ ok: true; discordUser: DiscordUser; member: boolean } | { ok: false; reason: LinkResult }> {
  return exchangeDiscordCode(code);
}

/** Löst die Verknüpfung (und nimmt die Customer-Rolle). */
export async function unlinkDiscordAccount(user: User, ip?: string): Promise<void> {
  if (!user.discordId) return;
  const cfg = await discordConfig();
  if (cfg.botReady && cfg.settings.customerRoleId) {
    await botRequest('DELETE', `/guilds/${cfg.settings.guildId}/members/${user.discordId}/roles/${cfg.settings.customerRoleId}`, { reason: 'Verknüpfung gelöst' }).catch(() => {});
  }
  await db.update(users).set({ discordId: null, discordUsername: null, discordLinkedAt: null, discordCustomerRole: false, discordSyncAt: null }).where(eq(users.id, user.id));
  await audit({ userId: user.id, actor: 'user', action: 'discord.unlinked', message: 'Discord-Verknüpfung gelöst', ip });
}

/** Vor dem Löschen eines Accounts: Customer-Rolle auf dem Discord-Server entfernen (ohne Fehler, wenn Discord nicht erreichbar ist) */
export async function releaseDiscordFor(userId: string): Promise<void> {
  const [row] = await db.select({ discordId: users.discordId }).from(users).where(eq(users.id, userId)).limit(1);
  const cfg = await discordConfig();
  if (!row?.discordId || !cfg.botReady || !cfg.settings.customerRoleId) return;
  await botRequest('DELETE', `/guilds/${cfg.settings.guildId}/members/${row.discordId}/roles/${cfg.settings.customerRoleId}`, { reason: 'Account gelöscht' }).catch(() => {});
}

/* ------------------------------------------------------------ Mitgliedschaft */

/** Mitglied des Discord-Servers (null = kein Mitglied) */
export async function fetchDiscordMember(discordId: string): Promise<DiscordMember | null> {
  const { settings } = await discordConfig();
  try {
    return await botRequest<DiscordMember>('GET', `/guilds/${settings.guildId}/members/${discordId}`);
  } catch (err) {
    if (err instanceof DiscordApiError && (err.status === 404 || err.code === DISCORD_CODES.unknownMember)) return null;
    throw err;
  }
}

const memberCache = new Map<string, { at: number; member: boolean }>();

export type DiscordGate = { ok: true } | { ok: false; reason: 'not_linked' | 'not_member' | 'unavailable' };

/**
 * Darf dieser Account kostenlose Server bekommen? Gilt nur, wenn die Pflicht eingeschaltet UND die Anbindung
 * vollständig eingerichtet ist – eine halb eingerichtete Anbindung sperrt niemanden aus.
 */
export async function discordGate(user: Pick<User, 'discordId'>, opts: { cached?: boolean } = {}): Promise<DiscordGate> {
  const cfg = await discordConfig();
  if (!cfg.settings.required || !cfg.linkReady) return { ok: true };
  if (!user.discordId) return { ok: false, reason: 'not_linked' };
  // Nur für die Anzeige („Meine Server“ lädt sich während der Einrichtung alle paar Sekunden neu):
  // ein bis zu 60 Sekunden alter Stand genügt und schont das Anfrage-Kontingent bei Discord
  const known = memberCache.get(user.discordId);
  if (opts.cached && known && Date.now() - known.at < 60_000) return known.member ? { ok: true } : { ok: false, reason: 'not_member' };
  try {
    const member = (await fetchDiscordMember(user.discordId)) !== null;
    if (memberCache.size > 5000) memberCache.clear();
    memberCache.set(user.discordId, { at: Date.now(), member });
    return member ? { ok: true } : { ok: false, reason: 'not_member' };
  } catch {
    // Discord nicht erreichbar: lieber kurz warten lassen als die Prüfung zu umgehen
    return { ok: false, reason: 'unavailable' };
  }
}

/* ------------------------------------------------------------ Customer-Rolle */

const hasServer = (userId: typeof users.id) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(servers)
      .where(and(eq(servers.userId, userId), inArray(servers.status, [...CUSTOMER_STATUSES]))),
  );

/** Setzt bzw. entfernt die Customer-Rolle für einen Account. @returns true, wenn Discord die Änderung bestätigt hat */
async function applyCustomerRole(user: Pick<User, 'id' | 'discordId'>, desired: boolean, cfg: DiscordConfig): Promise<boolean> {
  if (!user.discordId) return false;
  const path = `/guilds/${cfg.settings.guildId}/members/${user.discordId}/roles/${cfg.settings.customerRoleId}`;
  let applied = desired;
  let ok = true;
  try {
    await botRequest(desired ? 'PUT' : 'DELETE', path, { reason: desired ? 'Hat einen Server bei CraftingHosting.free' : 'Hat keinen Server mehr' });
  } catch (err) {
    if (err instanceof DiscordApiError && err.code === DISCORD_CODES.unknownMember) applied = false; // nicht (mehr) auf dem Server – keine Rolle
    else {
      ok = false;
      // Sichtbar machen, warum es nicht klappt (häufig: Bot-Rolle steht unter der Customer-Rolle) – im Protokoll und im Admin-Bereich
      const reason = discordErrorText(err);
      console.warn(`[discord] Customer-Rolle konnte nicht ${desired ? 'vergeben' : 'entfernt'} werden: ${reason}`);
      await patchDiscordState({ roleError: { at: new Date().toISOString(), message: reason } }).catch(() => {});
    }
  }
  // discordSyncAt merkt nur FEHLVERSUCHE (nächster Versuch frühestens nach 30 Minuten). Nach einem Erfolg wird es geleert,
  // damit eine spätere Änderung – z. B. der erste Server nach dem Verknüpfen – beim nächsten Abgleich sofort greift.
  await db
    .update(users)
    .set(ok ? { discordCustomerRole: applied, discordSyncAt: null } : { discordSyncAt: new Date() })
    .where(eq(users.id, user.id));
  if (ok && desired) await clearRoleError();
  return ok;
}

/** Letzten Fehler der Rollenvergabe vergessen, sobald sie wieder klappt */
async function clearRoleError(): Promise<void> {
  const state = await getDiscordState();
  if (state.roleError) await patchDiscordState({ roleError: null }).catch(() => {});
}

/** Customer-Rolle eines Accounts sofort abgleichen (nach Verknüpfung, Server-Erstellung, Löschung) */
export async function syncCustomerRole(userId: string): Promise<void> {
  const cfg = await discordConfig();
  if (!cfg.botReady || !cfg.settings.customerRoleId) return;
  const [row] = await db.select({ id: users.id, discordId: users.discordId, desired: sql<number>`${hasServer(users.id)}` }).from(users).where(eq(users.id, userId)).limit(1);
  if (row?.discordId) await applyCustomerRole(row, !!row.desired, cfg);
}

/** Wie syncCustomerRole, aber ohne zu warten und ohne Fehler nach außen – für Stellen, an denen ein Server entsteht oder verschwindet */
export function syncCustomerRoleSoon(userId: string): void {
  void syncCustomerRole(userId).catch((err) => console.warn(`[discord] Abgleich der Customer-Rolle fehlgeschlagen: ${discordErrorText(err)}`));
}

/**
 * Abgleich für alle: Wer einen Server hat, bekommt die Rolle; wer keinen mehr hat, verliert sie.
 * Normal werden nur Abweichungen bearbeitet (fehlgeschlagene Versuche frühestens nach 30 Minuten erneut).
 */
export async function syncCustomerRoles(opts: { all?: boolean; limit?: number } = {}): Promise<{ checked: number; failed: number }> {
  const cfg = await discordConfig();
  if (!cfg.botReady || !cfg.settings.customerRoleId) return { checked: 0, failed: 0 };
  const desired = sql<number>`${hasServer(users.id)}`;
  const retryBefore = new Date(Date.now() - 30 * 60_000);
  const rows = await db
    .select({ id: users.id, discordId: users.discordId, desired })
    .from(users)
    .where(
      opts.all
        ? isNotNull(users.discordId)
        : and(isNotNull(users.discordId), sql`${hasServer(users.id)} != ${users.discordCustomerRole}`, or(isNull(users.discordSyncAt), lt(users.discordSyncAt, retryBefore))),
    )
    .limit(opts.limit ?? 40);
  let failed = 0;
  for (const row of rows) if (!(await applyCustomerRole(row, !!row.desired, cfg))) failed++;
  return { checked: rows.length, failed };
}

/* ------------------------------------------------------------ Einladungslink */

export const inviteUrlOf = (code: string | null) => (code ? `https://discord.gg/${code}` : null);

/** Kanal für die Einladung: Admin-Einstellung → Systemkanal → Regelkanal → erster Textkanal */
async function pickInviteChannel(settings: DiscordSettings): Promise<string | null> {
  if (settings.inviteChannelId) return settings.inviteChannelId;
  const guild = await botRequest<DiscordGuild>('GET', `/guilds/${settings.guildId}`);
  if (guild.system_channel_id) return guild.system_channel_id;
  if (guild.rules_channel_id) return guild.rules_channel_id;
  const channels = await botRequest<DiscordChannel[]>('GET', `/guilds/${settings.guildId}/channels`);
  return channels.filter((c) => c.type === CHANNEL.text).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]?.id ?? null;
}

/**
 * Sorgt dafür, dass es eine dauerhafte Einladung gibt, die der Bot erstellt hat – die Website verwendet sie überall
 * als Discord-Link. Eine gelöschte Einladung wird ersetzt.
 */
export async function ensureDiscordInvite(force = false): Promise<string | null> {
  const cfg = await discordConfig();
  if (!cfg.botReady) return null;
  const state = await getDiscordState(true);
  const channelWanted = cfg.settings.inviteChannelId || state.inviteChannelId;
  if (state.inviteCode && !force && (!cfg.settings.inviteChannelId || cfg.settings.inviteChannelId === state.inviteChannelId)) {
    try {
      await botRequest<DiscordInvite>('GET', `/invites/${state.inviteCode}`);
      await patchDiscordState({ inviteCheckedAt: new Date().toISOString() });
      return inviteUrlOf(state.inviteCode);
    } catch (err) {
      if (!(err instanceof DiscordApiError) || err.status !== 404) return inviteUrlOf(state.inviteCode); // Discord gerade nicht erreichbar – Link behalten
    }
  }
  const channelId = (await pickInviteChannel(cfg.settings)) ?? channelWanted;
  if (!channelId) throw new Error('Auf dem Discord-Server wurde kein Textkanal für die Einladung gefunden.');
  const invite = await botRequest<DiscordInvite>('POST', `/channels/${channelId}/invites`, {
    json: { max_age: 0, max_uses: 0, temporary: false, unique: false },
    reason: 'Einladungslink für die Website',
  });
  await patchDiscordState({ inviteCode: invite.code, inviteChannelId: channelId, inviteCheckedAt: new Date().toISOString() });
  invalidatePublicSite();
  return inviteUrlOf(invite.code);
}

/* ------------------------------------------------------------ Einrichtung */

export type SetupStep = DiscordSetupStep;

/** Berechtigungen, mit denen der Bot eingeladen wird: Administrator (nötig, damit /wartung alle Kanäle sperren und wieder freigeben kann) */
export const botInviteUrl = (clientId: string) => `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=8`;

/** Prüft Token und Server, registriert die Befehle und erstellt den Einladungslink. Jeder Schritt meldet sein Ergebnis. */
export async function setupDiscord(): Promise<SetupStep[]> {
  const steps: SetupStep[] = [];
  const cfg = await discordConfig();
  const add = (name: string, ok: boolean, detail: string) => void steps.push({ name, ok, detail });
  if (!cfg.settings.enabled) add('Anbindung', false, 'Die Discord-Anbindung ist ausgeschaltet.');
  if (!cfg.botToken) add('Bot-Token', false, 'Es ist kein Bot-Token hinterlegt.');
  if (!cfg.settings.guildId) add('Server-ID', false, 'Die ID des Discord-Servers fehlt.');
  if (steps.length) return steps;

  let botUser: DiscordUser;
  try {
    botUser = await botRequest<DiscordUser>('GET', '/users/@me');
    add('Bot-Token', true, `Angemeldet als ${botUser.username}`);
  } catch (err) {
    add('Bot-Token', false, discordErrorText(err));
    return steps;
  }
  if (cfg.settings.clientId && cfg.settings.clientId !== botUser.id) {
    add('Client-ID', false, `Die Client-ID gehört nicht zu diesem Bot (erwartet: ${botUser.id}).`);
  }

  let guild: DiscordGuild | null = null;
  try {
    guild = await botRequest<DiscordGuild>('GET', `/guilds/${cfg.settings.guildId}?with_counts=true`);
    add('Discord-Server', true, `${guild.name}${guild.approximate_member_count ? ` · ca. ${guild.approximate_member_count} Mitglieder` : ''}`);
  } catch (err) {
    add('Discord-Server', false, `Der Bot ist nicht auf diesem Server oder die Server-ID stimmt nicht. ${discordErrorText(err)}`);
    return steps;
  }
  await patchDiscordState({
    bot: { id: botUser.id, username: botUser.username, avatar: botUser.avatar ?? null },
    guild: { name: guild.name, icon: guild.icon ?? null, memberCount: guild.approximate_member_count ?? null },
    setupAt: new Date().toISOString(),
  });

  try {
    const commands = buildCommands(cfg.settings);
    await botRequest('PUT', `/applications/${botUser.id}/guilds/${cfg.settings.guildId}/commands`, { json: commands });
    await patchDiscordState({ commandsAt: new Date().toISOString() });
    add('Befehle', true, commands.map((c) => `/${c.name}`).join(' '));
  } catch (err) {
    add('Befehle', false, `${discordErrorText(err)} – der Bot muss mit „applications.commands“ eingeladen sein.`);
  }

  try {
    const url = await ensureDiscordInvite();
    add('Einladungslink', !!url, url ?? 'Es konnte kein Einladungslink erstellt werden.');
  } catch (err) {
    add('Einladungslink', false, discordErrorText(err));
  }

  // Rollen prüfen: vorhanden und unterhalb der Bot-Rolle?
  const wanted: [string, string][] = [
    ['Customer-Rolle', cfg.settings.customerRoleId],
    ['Support-Rolle', cfg.settings.supportRoleId],
    ...cfg.settings.autoRoleIds.map((id, i): [string, string] => [`Auto-Rolle ${i + 1}`, id]),
    ...cfg.settings.rolePanels.flatMap((p) => p.buttons.filter((b) => b.roleId).map((b): [string, string] => [`Rollen-Panel „${p.title}“ · ${b.label}`, b.roleId])),
  ];
  if (wanted.some(([, id]) => id)) {
    try {
      const [roles, me] = await Promise.all([
        botRequest<{ id: string; name: string; position: number; managed?: boolean }[]>('GET', `/guilds/${cfg.settings.guildId}/roles`),
        botRequest<DiscordMember>('GET', `/guilds/${cfg.settings.guildId}/members/${botUser.id}`),
      ]);
      const top = Math.max(0, ...roles.filter((r) => me.roles.includes(r.id)).map((r) => r.position));
      for (const [label, id] of wanted) {
        if (!id) continue;
        const role = roles.find((r) => r.id === id);
        if (!role) add(label, false, `Rolle ${id} gibt es auf dem Server nicht.`);
        else if (label !== 'Support-Rolle' && role.position >= top) add(label, false, `„${role.name}“ steht über der Bot-Rolle – der Bot kann sie nicht vergeben. Bot-Rolle in den Servereinstellungen nach oben ziehen.`);
        else add(label, true, role.name);
      }
    } catch (err) {
      add('Rollen', false, discordErrorText(err));
    }
  }
  return steps;
}

/** Übersicht für den Admin-Bereich (ohne Geheimnisse) */
export async function discordAdminStatus(): Promise<AdminDiscordDTO> {
  const [cfg, state] = await Promise.all([discordConfig(), getDiscordState(true)]);
  const [linked] = await db.select({ n: sql<number>`count(*)` }).from(users).where(isNotNull(users.discordId));
  return {
    hasBotToken: !!cfg.botToken,
    hasClientSecret: !!cfg.clientSecret,
    botReady: cfg.botReady,
    linkReady: cfg.linkReady,
    redirectUri: discordRedirectUri(),
    botInviteUrl: cfg.settings.clientId ? botInviteUrl(cfg.settings.clientId) : null,
    inviteUrl: inviteUrlOf(state.inviteCode),
    bot: state.bot,
    guild: state.guild,
    commandsAt: state.commandsAt,
    setupAt: state.setupAt,
    gateway: state.gateway,
    roleError: state.roleError,
    statusFeedError: state.statusFeedError,
    honeypotError: state.honeypotError,
    linkedUsers: Number(linked?.n ?? 0),
  };
}

/** Adresse, auf die nach dem Verknüpfen zurückgeleitet wird */
export const afterLinkUrl = (lang: Locale, result: string) => `${env.APP_URL}${localePath(lang, 'myServers')}?discord=${result}`;
