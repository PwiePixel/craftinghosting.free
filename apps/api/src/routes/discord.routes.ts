import { checkSocialAccounts, resolveSocialAccount, sendSocialTest, socialAdminStatus } from '../discord/social-ping';
import { boostOverview, setManualBoosts } from '../discord/boost-rewards';
import { setupHoneypot } from '../discord/honeypot';
import { inviteLeaderboard } from '../discord/invite-rewards';
import { sendRewardAnnouncement } from '../discord/rewards';
import { sendStatusFeedTest } from '../discord/status-feed';
import type { FastifyInstance } from 'fastify';
import { and, count, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { isLocale, isSnowflake, localePath, type DiscordMeDTO, type Locale } from '@chfree/shared';
import { db } from '../db/client';
import { servers, users } from '../db/schema';
import { rolePanelMessage, ticketPanelMessage } from '../discord/messages';
import { discordErrorText } from '../discord/rest';
import {
  afterLinkUrl,
  botRequest,
  discordAdminStatus,
  discordAuthorizeUrl,
  discordConfig,
  connectDiscordForChat,
  discordGate,
  exchangeDiscordCode,
  langFromState,
  linkDiscordAccount,
  parseDiscordState,
  setupDiscord,
  syncCustomerRole,
  syncCustomerRoles,
  unlinkDiscordAccount,
} from '../discord/service';
import { CHAT_COOKIE } from './chat.routes';
import { attachDiscordToConversation, chatNote, findConversation, startHandoff } from '../chat/service';
import { getDiscordState, saveDiscordSecrets } from '../discord/store';
import { env } from '../env';
import { ApiError, L } from '../lib/errors';
import { currentUser, requireAdmin, requireAuth, setSessionCookie } from '../plugins/auth';
import { clearSignupCookies, newNonce, readOAuthCookie, readSignupCookie, setOAuthCookie } from '../lib/signup-cookie';
import { accountForDiscordLogin, accountForDiscordSignup, completeDiscordLogin, finishDiscordSignup, twoFactorTicket, type DiscordAccount } from '../services/auth.service';
import { createSession } from '../services/session.service';
import { audit } from '../services/audit.service';
import { activatePendingServers } from '../services/server.service';
import { getSettings, invalidatePublicSite } from '../services/settings.service';
import { assertIdentityFree } from '../services/sanction-gate';

const strict = (max: number, timeWindow: string) => ({ config: { rateLimit: { max, timeWindow } } });
/** Server in diesen Zuständen hängen an der Discord-Mitgliedschaft */
const HELD = ['pending', 'provisioning', 'provisioning_failed', 'active', 'expiring', 'suspended'] as const;

/** Discord-Konto verknüpfen und prüfen (für angemeldete Nutzer) */
export async function discordRoutes(app: FastifyInstance) {
  /** Zurück auf die Website mit geöffnetem Chat */
  const backToChat = (lang: Locale) => `${env.APP_URL}${localePath(lang, 'home')}?chat=open`;

  /**
   * Start der Verknüpfung: leitet zu Discord weiter (normaler Link, kein API-Aufruf aus dem Browser-Skript).
   * `chat=1`: aus dem Support-Chat heraus – das geht auch ohne Anmeldung, dann ist die Verbindung an die Unterhaltung gebunden.
   */
  app.get('/discord/connect', strict(20, '10 minutes'), async (request, reply) => {
    const query = request.query as { lang?: string; chat?: string };
    const lang: Locale = isLocale(query.lang) ? query.lang : request.lang;
    const fromChat = query.chat === '1';
    const user = request.user && request.user.status === 'active' ? request.user : null;
    if (user) {
      const url = await discordAuthorizeUrl({ kind: 'user', id: user.id, chat: fromChat }, lang);
      return reply.redirect(url ?? (fromChat ? backToChat(lang) : afterLinkUrl(lang, 'unavailable')));
    }
    if (!fromChat) return reply.redirect(`${env.APP_URL}${localePath(lang, 'login')}`);
    const conversation = await findConversation(request.cookies[CHAT_COOKIE]);
    if (!conversation) return reply.redirect(backToChat(lang));
    return reply.redirect((await discordAuthorizeUrl({ kind: 'chat', id: conversation.id }, lang)) ?? backToChat(lang));
  });

  /** Anmeldung über Discord: leitet zu Discord weiter. Der Zufallswert bindet die Anmeldung an diesen Browser. */
  app.get('/discord/login', strict(20, '10 minutes'), async (request, reply) => {
    const query = request.query as { lang?: string };
    const lang: Locale = isLocale(query.lang) ? query.lang : request.lang;
    const nonce = newNonce();
    const url = await discordAuthorizeUrl({ kind: 'login', id: nonce }, lang);
    if (!url) return reply.redirect(`${env.APP_URL}${localePath(lang, 'login')}?discord=unavailable`);
    setOAuthCookie(reply, nonce);
    return reply.redirect(url);
  });

  /** Rückweg von Discord */
  app.get('/discord/callback', strict(20, '10 minutes'), async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    const lang = langFromState(query.state);
    const state = query.state ? parseDiscordState(query.state) : null;
    const user = request.user && request.user.status === 'active' ? request.user : null;

    // Aus dem Chat ohne Anmeldung: Der Zustand gehört zu genau der Unterhaltung, deren Cookie dieser Browser hält
    if (state?.kind === 'chat') {
      const conversation = await findConversation(request.cookies[CHAT_COOKIE]);
      if (!conversation || conversation.id !== state.id) return reply.redirect(backToChat(lang));
      if (query.code && !query.error) {
        const result = await connectDiscordForChat(query.code);
        if (result.ok) {
          const updated = await attachDiscordToConversation(conversation, result.discordUser);
          await startHandoff(updated, null).catch((err) => request.log.warn({ err }, 'Chat: Übergabe nach der Discord-Verbindung fehlgeschlagen'));
        } else {
          await chatNote(conversation, result.reason).catch(() => {});
        }
      } else {
        await chatNote(conversation, 'denied').catch(() => {});
      }
      return reply.redirect(backToChat(lang));
    }

    // Registrierung bzw. Anmeldung über Discord: Das Discord-Konto ist die Identität
    if (state?.kind === 'signup' || state?.kind === 'login') {
      const signup = state.kind === 'signup';
      const back = (reason: string) => reply.redirect(`${env.APP_URL}${localePath(lang, signup ? 'start' : 'login')}?discord=${reason}`);
      const intent = signup ? readSignupCookie(request) : null;
      const nonce = signup ? intent?.nonce : readOAuthCookie(request);
      // Der Zustand gilt nur in dem Browser, der die Anmeldung gestartet hat
      if (!nonce || nonce !== state.id) return back('state');
      if (query.error || !query.code) return back(query.error === 'access_denied' ? 'denied' : 'failed');
      const meta = { ip: request.ip, locale: lang };
      const found: { account?: DiscordAccount } = {};
      const result = await exchangeDiscordCode(query.code, async (discordUser) => {
        found.account = signup && intent ? await accountForDiscordSignup(discordUser, intent.input.email, meta) : await accountForDiscordLogin(discordUser);
        return found.account.ok ? null : found.account.reason;
      });
      clearSignupCookies(reply);
      if (!result.ok || !found.account?.ok) return back(result.ok ? 'failed' : result.reason);
      const account = found.account.user;
      if (signup && intent) {
        // Anfrage speichern und die (freiwillige) Bestätigungsmail schicken – ein Fehler hier kippt die Anmeldung nicht
        await finishDiscordSignup(account, intent.input, meta).catch((err) => request.log.warn({ err }, 'Registrierung über Discord: Anfrage konnte nicht gespeichert werden'));
      }
      // Zweite Stufe eingeschaltet: erst nach Passwort bzw. App-Code gibt es eine Sitzung
      if (account.twoFactorMethod) {
        return reply.redirect(`${env.APP_URL}${localePath(lang, 'login')}?tf=${encodeURIComponent(twoFactorTicket(account.id))}&m=${account.twoFactorMethod}`);
      }
      const session = await createSession(account.id, { ip: request.ip, userAgent: request.headers['user-agent'] });
      setSessionCookie(reply, session.token, session.expiresAt, session.persistent);
      const done = await completeDiscordLogin(account.id, meta).catch((err) => {
        request.log.warn({ err }, 'Anmeldung über Discord: nächster Schritt konnte nicht bestimmt werden');
        return null;
      });
      await syncCustomerRole(account.id).catch(() => {});
      // Offene Schritte (Panel-Zugang, Discord-Beitritt, Warteliste) zeigt die Startseite; sonst geht es zu „Meine Server“
      const open = signup || !done || done.next !== 'overview';
      return reply.redirect(`${env.APP_URL}${open ? `${localePath(lang, 'start')}?resume=1` : localePath(lang, 'myServers')}`);
    }

    if (!user) return reply.redirect(`${env.APP_URL}${localePath(lang, 'login')}`);
    const fromChat = state?.kind === 'user' && state.chat;
    const done = (result: string) => reply.redirect(fromChat ? backToChat(lang) : afterLinkUrl(lang, result));
    // Der Zustand gilt nur für den Account, der die Verknüpfung gestartet hat (Schutz vor untergeschobenen Links)
    if (!state || state.kind !== 'user' || state.id !== user.id) return done('state');
    if (query.error || !query.code) return done(query.error === 'access_denied' ? 'denied' : 'failed');
    const result = await linkDiscordAccount(user, query.code, request.ip);
    if (result === 'linked' || result === 'linked_not_member') {
      const [fresh] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
      if (fresh) {
        // Wartende Server freischalten und die Customer-Rolle setzen – Fehler hier dürfen die Verknüpfung nicht kippen
        if (result === 'linked') await activatePendingServers(fresh, request.ip).catch((err) => request.log.warn({ err }, 'Discord: Server konnten nach der Verknüpfung nicht aktiviert werden'));
        await syncCustomerRole(fresh.id).catch(() => {});
      }
    }
    if (fromChat) {
      // Die Übergabe an das Team läuft von selbst weiter
      const conversation = await findConversation(request.cookies[CHAT_COOKIE]);
      if (conversation) {
        const [fresh] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
        if (result === 'linked' || result === 'linked_not_member') await startHandoff(conversation, fresh ?? user).catch((err) => request.log.warn({ err }, 'Chat: Übergabe nach der Discord-Verbindung fehlgeschlagen'));
        else await chatNote(conversation, result).catch(() => {});
      }
    }
    // Konto ohne Panel-Zugang mit wartender Anfrage (z. B. mit E-Mail und Passwort registriert): Nach dem Verbinden
    // geht es direkt mit dem nächsten Schritt weiter – Panel-Zugang festlegen, danach wird der Server erstellt.
    if (!fromChat && (result === 'linked' || result === 'linked_not_member')) {
      const [fresh] = await db.select({ ptero: users.pteroUserId }).from(users).where(eq(users.id, user.id)).limit(1);
      const [open] = await db.select({ id: servers.id }).from(servers).where(and(eq(servers.userId, user.id), eq(servers.status, 'pending'))).limit(1);
      if (fresh && !fresh.ptero && open) return reply.redirect(`${env.APP_URL}${localePath(lang, 'start')}?resume=1`);
    }
    return done(result);
  });

  /** Stand der Verknüpfung für „Meine Server“ */
  app.get('/discord/me', { preHandler: requireAuth }, async (request): Promise<{ discord: DiscordMeDTO }> => {
    const user = currentUser(request);
    const cfg = await discordConfig();
    const gate = cfg.linkReady && (cfg.settings.required || user.discordId) ? await discordGate({ discordId: user.discordId }, { cached: true }) : ({ ok: true } as const);
    // Ohne Pflicht prüft discordGate nichts – die Mitgliedschaft wird dann nur für verknüpfte Konten angezeigt
    return {
      discord: {
        available: cfg.linkReady,
        required: cfg.settings.required && cfg.linkReady,
        linked: user.discordId ? { id: user.discordId, username: user.discordUsername ?? '' } : null,
        blocked: gate.ok ? null : gate.reason,
      },
    };
  });

  /** „Erneut prüfen“: Wer inzwischen beigetreten ist, bekommt seine wartenden Server */
  app.post('/discord/check', { preHandler: requireAuth, ...strict(12, '10 minutes') }, async (request) => {
    const user = currentUser(request);
    const gate = await discordGate(user);
    let activated = 0;
    if (gate.ok) {
      activated = (await activatePendingServers(user, request.ip)).length;
      await syncCustomerRole(user.id).catch(() => {});
    }
    return { ok: gate.ok, reason: gate.ok ? null : gate.reason, activated };
  });

  app.post('/discord/unlink', { preHandler: requireAuth, ...strict(6, '15 minutes') }, async (request) => {
    const user = currentUser(request);
    const cfg = await discordConfig();
    if (cfg.settings.required && cfg.linkReady) {
      const [held] = await db.select({ n: count() }).from(servers).where(and(eq(servers.userId, user.id), inArray(servers.status, [...HELD])));
      if (Number(held?.n ?? 0) > 0) {
        throw new ApiError(
          409,
          'discord_required',
          L('Solange du einen Server bei uns hast, muss dein Discord-Konto verknüpft bleiben. Lösche zuerst deine Server.', 'While you have a server with us, your Discord account must stay linked. Delete your servers first.'),
        );
      }
    }
    // Verwarnungs-System: kein Lösen der Verknüpfung, solange eine Verwarnung oder Abuse-Meldung besteht
    await assertIdentityFree(user);
    await unlinkDiscordAccount(user, request.ip);
    return { ok: true };
  });
}

/** Admin: Zugangsdaten, Einrichtung, Rollen-Abgleich, Panels senden */
export async function discordAdminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/discord', async () => ({ discord: await discordAdminStatus() }));

  /** Bot-Token und Client-Secret speichern. Leeres Feld = unverändert; die Werte werden nie zurückgegeben. */
  app.post('/admin/discord/secrets', strict(20, '10 minutes'), async (request) => {
    const body = z
      .object({
        botToken: z.string().trim().max(200).optional(),
        clientSecret: z.string().trim().max(200).optional(),
        clearBotToken: z.boolean().default(false),
        clearClientSecret: z.boolean().default(false),
      })
      .parse(request.body);
    await saveDiscordSecrets({
      botToken: body.clearBotToken ? null : body.botToken || undefined,
      clientSecret: body.clearClientSecret ? null : body.clientSecret || undefined,
    });
    invalidatePublicSite();
    const changed = [body.clearBotToken ? 'Bot-Token gelöscht' : body.botToken ? 'Bot-Token geändert' : '', body.clearClientSecret ? 'Client-Secret gelöscht' : body.clientSecret ? 'Client-Secret geändert' : ''].filter(Boolean);
    if (changed.length) await audit({ userId: currentUser(request).id, actor: 'admin', action: 'discord.secrets', message: `Discord-Zugangsdaten: ${changed.join(', ')}`, ip: request.ip });
    return { discord: await discordAdminStatus() };
  });

  /** Verbindung prüfen, Befehle registrieren, Einladungslink erstellen */
  app.post('/admin/discord/setup', strict(20, '10 minutes'), async () => {
    const steps = await setupDiscord();
    invalidatePublicSite();
    return { steps, discord: await discordAdminStatus() };
  });

  app.post('/admin/discord/sync-roles', strict(6, '10 minutes'), async () => syncCustomerRoles({ all: true, limit: 2000 }));

  /** Testnachricht in den Status-Kanal (mit den gerade eingegebenen, evtl. noch nicht gespeicherten IDs) */
  app.post('/admin/discord/status-test', strict(20, '10 minutes'), async (request) => {
    const body = z
      .object({ channelId: z.string().refine(isSnowflake, 'Bitte eine gültige Kanal-ID angeben.'), pingRoleId: z.string().refine((v) => v === '' || isSnowflake(v), 'Bitte eine gültige Rollen-ID angeben.').default('') })
      .parse(request.body);
    const cfg = await discordConfig();
    if (!cfg.botReady) throw new ApiError(409, 'discord_not_ready', L('Die Discord-Anbindung ist noch nicht eingerichtet.', 'The Discord integration is not set up yet.'));
    try {
      await sendStatusFeedTest(body.channelId, body.pingRoleId);
    } catch (err) {
      throw new ApiError(502, 'discord_error', L(discordErrorText(err), discordErrorText(err)));
    }
    return { ok: true };
  });

  /* ---------------------------------------------------------- Belohnungen und Honeypot */

  const notReady = () => new ApiError(409, 'discord_not_ready', L('Die Discord-Anbindung ist noch nicht eingerichtet.', 'The Discord integration is not set up yet.'));
  const discordFailed = (err: unknown) => new ApiError(502, 'discord_error', L(discordErrorText(err), discordErrorText(err)));
  const snowflakeField = (message: string) => z.string().refine(isSnowflake, message);

  /** Rangliste der Einladenden und alle Booster */
  app.get('/admin/discord/rewards', async () => ({ inviters: await inviteLeaderboard(), boosters: await boostOverview() }));

  /** Ankündigung des Belohnungssystems in einen Kanal posten (mit Rollen-Erwähnung) */
  app.post('/admin/discord/rewards/announce', strict(10, '10 minutes'), async (request) => {
    const body = z
      .object({ channelId: snowflakeField('Bitte eine gültige Kanal-ID angeben.'), roleId: z.string().refine((v) => v === '' || isSnowflake(v), 'Bitte eine gültige Rollen-ID angeben.').default('') })
      .parse(request.body);
    if (!(await discordConfig()).botReady) throw notReady();
    try {
      await sendRewardAnnouncement(body.channelId, body.roleId);
    } catch (err) {
      throw discordFailed(err);
    }
    await audit({ userId: currentUser(request).id, actor: 'admin', action: 'discord.rewards_announced', message: `Discord: Belohnungssystem in Kanal ${body.channelId} angekündigt`, ip: request.ip });
    return { ok: true };
  });

  /** Anzahl der Boosts eines Kontos von Hand setzen (null = wieder automatisch zählen) */
  app.post('/admin/discord/rewards/boosts', strict(60, '10 minutes'), async (request) => {
    const body = z.object({ discordId: snowflakeField('Bitte eine gültige Discord-ID angeben.'), boosts: z.number().int().min(0).max(50).nullable() }).parse(request.body);
    const boosts = await setManualBoosts(body.discordId, body.boosts);
    await audit({ userId: currentUser(request).id, actor: 'admin', action: 'discord.boosts_set', message: `Discord: Boosts von ${body.discordId} ${body.boosts === null ? 'wieder automatisch' : `auf ${body.boosts} gesetzt`}`, ip: request.ip });
    return { boosts, boosters: await boostOverview() };
  });

  /** Honeypot-Kanal einrichten: für alle sichtbar machen und den Warnhinweis posten */
  app.post('/admin/discord/honeypot/setup', strict(10, '10 minutes'), async (request) => {
    const body = z.object({ channelId: snowflakeField('Bitte eine gültige Kanal-ID angeben.') }).parse(request.body);
    const cfg = await discordConfig();
    if (!cfg.botReady) throw notReady();
    try {
      await setupHoneypot(cfg.settings.guildId, body.channelId);
    } catch (err) {
      throw discordFailed(err);
    }
    await audit({ userId: currentUser(request).id, actor: 'admin', action: 'discord.honeypot_setup', message: `Discord: Honeypot-Kanal ${body.channelId} eingerichtet`, ip: request.ip });
    return { ok: true };
  });

  /* ---------------------------------------------------------- Social Ping */

  /** Stand je Konto: letzte Prüfung, letztes Video, Fehler */
  app.get('/admin/discord/social', async () => ({ social: await socialAdminStatus() }));

  /** Link prüfen und den Feed dazu ermitteln (YouTube-Kanal oder RSS-/Atom-Feed) */
  app.post('/admin/discord/social/resolve', strict(40, '10 minutes'), async (request) => {
    const { url } = z.object({ url: z.string().trim().min(4).max(500) }).parse(request.body);
    try {
      return { account: await resolveSocialAccount(url) };
    } catch (err) {
      const message = (err as Error).message || 'Der Link konnte nicht geprüft werden.';
      throw new ApiError(400, 'social_resolve_failed', L(message, message));
    }
  });

  /** Sofort prüfen (statt auf den nächsten Lauf zu warten) */
  app.post('/admin/discord/social/check', strict(20, '10 minutes'), async () => ({ result: await checkSocialAccounts(), social: await socialAdminStatus() }));

  /** Testnachricht: das neueste Video eines Kontos in den Kanal posten */
  app.post('/admin/discord/social/test', strict(20, '10 minutes'), async (request) => {
    const { accountId } = z.object({ accountId: z.string().max(40) }).parse(request.body);
    if (!(await discordConfig()).botReady) throw new ApiError(409, 'discord_not_ready', L('Die Discord-Anbindung ist noch nicht eingerichtet.', 'The Discord integration is not set up yet.'));
    try {
      await sendSocialTest(accountId);
    } catch (err) {
      const message = discordErrorText(err);
      throw new ApiError(502, 'discord_error', L(message, message));
    }
    return { ok: true };
  });

  /** Rollen-Panel oder Ticket-Panel in einen Kanal posten */
  app.post('/admin/discord/send-panel', strict(30, '10 minutes'), async (request) => {
    const body = z
      .object({ kind: z.enum(['roles', 'tickets']), panelId: z.string().max(40).optional(), channelId: z.string().refine(isSnowflake, 'Bitte eine gültige Kanal-ID angeben.') })
      .parse(request.body);
    const cfg = await discordConfig();
    if (!cfg.botReady) throw new ApiError(409, 'discord_not_ready', L('Die Discord-Anbindung ist noch nicht eingerichtet.', 'The Discord integration is not set up yet.'));
    const state = await getDiscordState(true);
    let message: unknown;
    if (body.kind === 'tickets') message = ticketPanelMessage(state);
    else {
      const panel = (await getSettings()).discord.rolePanels.find((p) => p.id === body.panelId);
      if (!panel) throw new ApiError(404, 'panel_not_found', L('Dieses Panel gibt es nicht (mehr). Bitte zuerst speichern.', 'This panel does not exist (any more). Please save first.'));
      if (!panel.buttons.some((b) => b.roleId)) throw new ApiError(400, 'panel_empty', L('Für dieses Panel ist noch keine Rollen-ID eingetragen.', 'No role ID has been entered for this panel yet.'));
      message = rolePanelMessage(panel, state);
    }
    try {
      await botRequest('POST', `/channels/${body.channelId}/messages`, { json: message });
    } catch (err) {
      throw new ApiError(502, 'discord_error', L(discordErrorText(err), discordErrorText(err)));
    }
    await audit({ userId: currentUser(request).id, actor: 'admin', action: 'discord.panel_sent', message: `Discord: ${body.kind === 'tickets' ? 'Ticket-Panel' : `Rollen-Panel „${body.panelId}“`} in Kanal ${body.channelId} gepostet`, ip: request.ip });
    return { ok: true };
  });
}
