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
  discordGate,
  langFromState,
  linkDiscordAccount,
  setupDiscord,
  syncCustomerRole,
  syncCustomerRoles,
  unlinkDiscordAccount,
} from '../discord/service';
import { getDiscordState, saveDiscordSecrets } from '../discord/store';
import { env } from '../env';
import { ApiError, L } from '../lib/errors';
import { currentUser, requireAdmin, requireAuth } from '../plugins/auth';
import { audit } from '../services/audit.service';
import { activatePendingServers } from '../services/server.service';
import { getSettings, invalidatePublicSite } from '../services/settings.service';

const strict = (max: number, timeWindow: string) => ({ config: { rateLimit: { max, timeWindow } } });
/** Server in diesen Zuständen hängen an der Discord-Mitgliedschaft */
const HELD = ['pending', 'provisioning', 'provisioning_failed', 'active', 'expiring', 'suspended'] as const;

/** Discord-Konto verknüpfen und prüfen (für angemeldete Nutzer) */
export async function discordRoutes(app: FastifyInstance) {
  /** Start der Verknüpfung: leitet zu Discord weiter (normaler Link, kein API-Aufruf aus dem Browser-Skript) */
  app.get('/discord/connect', strict(20, '10 minutes'), async (request, reply) => {
    const query = request.query as { lang?: string };
    const lang: Locale = isLocale(query.lang) ? query.lang : request.lang;
    if (!request.user || request.user.status !== 'active') return reply.redirect(`${env.APP_URL}${localePath(lang, 'login')}`);
    const url = await discordAuthorizeUrl(request.user, lang);
    return reply.redirect(url ?? afterLinkUrl(lang, 'unavailable'));
  });

  /** Rückweg von Discord */
  app.get('/discord/callback', strict(20, '10 minutes'), async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    const lang = langFromState(query.state);
    if (!request.user || request.user.status !== 'active') return reply.redirect(`${env.APP_URL}${localePath(lang, 'login')}`);
    if (query.error || !query.code || !query.state) return reply.redirect(afterLinkUrl(lang, query.error === 'access_denied' ? 'denied' : 'failed'));
    const result = await linkDiscordAccount(request.user, query.code, query.state, request.ip);
    if (result === 'linked' || result === 'linked_not_member') {
      const [fresh] = await db.select().from(users).where(eq(users.id, request.user.id)).limit(1);
      if (fresh) {
        // Wartende Server freischalten und die Customer-Rolle setzen – Fehler hier dürfen die Verknüpfung nicht kippen
        if (result === 'linked') await activatePendingServers(fresh, request.ip).catch((err) => request.log.warn({ err }, 'Discord: Server konnten nach der Verknüpfung nicht aktiviert werden'));
        await syncCustomerRole(fresh.id).catch(() => {});
      }
    }
    return reply.redirect(afterLinkUrl(lang, result));
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
