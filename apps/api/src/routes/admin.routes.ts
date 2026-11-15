import { clearAbuseFlag, listAbuse, listAbuseServers, listDiscordWaiting, previewAbuse, sendAbuseMail, sendAdminMessage, sendDiscordReminders } from '../services/admin-mail.service';
import { syncStatusFeedSoon } from '../discord/status-feed';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { emailSchema, serverNameSchema } from '@chfree/shared';
import { env } from '../env';
import { Errors, L } from '../lib/errors';
import { allJobs } from '../jobs/registry';
import { runJobOnce } from '../jobs/scheduler';
import { currentUser, requireAdmin } from '../plugins/auth';
import {
  createIncident,
  deleteIncident,
  getOverview,
  listAudit,
  listIncidents,
  listMailProblems,
  listServersAdmin,
  bulkServerAction,
  getPanelInfo,
  deleteMatchingUsers,
  deleteUsersAdmin,
  listUsersAdmin,
  listExternalBlocks,
  listWaitlistPage,
  resolveIncident,
  sendTestMail,
  serverAction,
  updateIncident,
  userAction,
  applyPlanSlots,
} from '../services/admin.service';
import { audit } from '../services/audit.service';
import { deleteLogo, saveLogo } from '../services/logo.service';
import { adjustExternalSpots, getSettings, invalidatePublicSite, saveSettings } from '../services/settings.service';
import { addWaitlistEntries, nextWaitlistIds, releaseWaitlist, removeWaitlistEntry } from '../services/waitlist.service';
import { explainSmtpError } from '../services/mail/mailer';

const idParams = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  q: z.string().max(100).optional(),
  status: z.string().max(32).optional(),
  kind: z.string().max(16).optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).optional(),
});

/** Admin-Bereich – nur für Admins (role = admin oder ADMIN_EMAILS), alle anderen bekommen 404. */
export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/overview', async () => ({ overview: await getOverview() }));
  // Listen seitenweise (50 pro Seite): ?page=2
  app.get('/admin/servers', async (request) => listServersAdmin(listQuery.parse(request.query)));
  app.get('/admin/users', async (request) => listUsersAdmin(listQuery.parse(request.query)));
  app.get('/admin/audit', async (request) => listAudit(listQuery.parse(request.query)));
  app.get('/admin/mails', async () => ({ mails: await listMailProblems() }));

  /** Accounts, deren Server noch auf die Discord-Verbindung wartet */
  app.get('/admin/mails/discord-waiting', async () => listDiscordWaiting());
  /** Erinnerung an alle Wartenden – setzt die Frist, nach der die Anfrage gelöscht wird */
  app.post('/admin/mails/discord-reminder', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request) => {
    const { days } = z.object({ days: z.number().int().min(1).max(30).default(7) }).parse(request.body ?? {});
    return { ...(await sendDiscordReminders(currentUser(request), days, request.ip)), waiting: await listDiscordWaiting() };
  });
  /** Nachricht an ausgewählte Nutzer */
  const localizedMail = (max: number) => z.object({ de: z.string().max(max).default(''), en: z.string().max(max).default('') });
  app.post('/admin/mails/send', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request) => {
    const body = z.object({ emails: z.array(z.string().trim().max(254)).min(1).max(500), subject: localizedMail(150), body: localizedMail(5000) }).parse(request.body);
    return sendAdminMessage(currentUser(request), body, request.ip);
  });

  /* -------------------------------------------------------------- Abuse */
  app.get('/admin/abuse', async () => ({ abuse: await listAbuse() }));
  const abuseSchema = z.object({
    email: emailSchema,
    reason: z.string().max(40),
    note: localizedMail(3000).default({ de: '', en: '' }),
    suspend: z.boolean().default(false),
    serverId: z.string().uuid().nullable().optional(),
  });
  app.post('/admin/abuse', { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } }, async (request) => {
    return { ...(await sendAbuseMail(currentUser(request), abuseSchema.parse(request.body), request.ip)), abuse: await listAbuse() };
  });
  /** Vorschau: Betreff und Text der Mail in beiden Sprachen */
  app.post('/admin/abuse/preview', { config: { rateLimit: { max: 600, timeWindow: '10 minutes' } } }, async (request) => ({ preview: await previewAbuse(abuseSchema.parse(request.body)) }));
  /** Server eines Nutzers zur Auswahl */
  app.get('/admin/abuse/servers', async (request) => {
    const { email } = z.object({ email: emailSchema }).parse(request.query);
    return { servers: await listAbuseServers(email) };
  });
  /** Abuse-Markierung eines Servers aufheben */
  app.post('/admin/abuse/:id/clear', async (request) => {
    const { id } = idParams.parse(request.params);
    await clearAbuseFlag(currentUser(request), id, request.ip);
    return { abuse: await listAbuse() };
  });

  /**
   * Alle Server auf einmal sperren, entsperren oder löschen – Admin-Konten und die angegebenen Konten sind ausgenommen.
   * Läuft in Runden; die Antwort enthält „remaining“.
   */
  app.post('/admin/servers/bulk', { config: { rateLimit: { max: 600, timeWindow: '10 minutes' } } }, async (request) => {
    const body = z
      .object({
        action: z.enum(['suspend', 'unsuspend', 'delete']),
        kind: z.enum(['all', 'minecraft', 'discord']).default('all'),
        exemptEmails: z.array(z.string().trim().max(254)).max(1000).default([]),
        dryRun: z.boolean().default(false),
        limit: z.number().int().min(1).max(50).default(20),
        skip: z.number().int().min(0).max(1_000_000).default(0),
      })
      .parse(request.body);
    const result = await bulkServerAction(currentUser(request), body, request.ip);
    if (!body.dryRun) invalidatePublicSite();
    return result;
  });

  /** Pterodactyl: Verbindung, Nodes und Eggs (automatisch erkannt) */
  app.get('/admin/panel', async () => ({ panel: await getPanelInfo() }));

  app.post('/admin/servers/:id/:action', async (request) => {
    const { id } = idParams.parse({ id: (request.params as { id: string }).id });
    const action = z.enum(['suspend', 'unsuspend', 'extend', 'clear-pause', 'retry', 'delete']).parse((request.params as { action: string }).action);
    await serverAction(currentUser(request), id, action, request.ip);
    return { ok: true };
  });

  /** Konten löschen – ausgewählte (ids) oder per E-Mail-Liste (emails), je Aufruf max. 500 */
  app.post('/admin/users/delete', { config: { rateLimit: { max: 120, timeWindow: '10 minutes' } } }, async (request) => {
    const body = z
      .object({ ids: z.array(z.string().uuid()).max(500).optional(), emails: z.array(z.string().trim().max(254)).max(500).optional() })
      .refine((b) => (b.ids?.length ?? 0) + (b.emails?.length ?? 0) > 0, 'Keine Konten angegeben.')
      .parse(request.body);
    return deleteUsersAdmin(currentUser(request), body, request.ip);
  });
  /** Alle Treffer von Suche/Filter löschen – in Runden von max. 200 Konten (Antwort enthält „remaining“) */
  app.post('/admin/users/delete-matching', { config: { rateLimit: { max: 600, timeWindow: '10 minutes' } } }, async (request) => {
    const body = z
      .object({ q: z.string().max(100).optional(), status: z.string().max(32).optional(), limit: z.number().int().min(1).max(200).default(100) })
      .parse(request.body);
    return deleteMatchingUsers(currentUser(request), { q: body.q, status: body.status }, body.limit, request.ip);
  });
  app.post('/admin/users/:id/:action', async (request) => {
    const { id } = idParams.parse({ id: (request.params as { id: string }).id });
    const action = z.enum(['lock', 'unlock', 'make-admin', 'remove-admin', 'grant-beta', 'revoke-beta', 'reset-two-factor']).parse((request.params as { action: string }).action);
    await userAction(currentUser(request), id, action, request.ip);
    return { ok: true };
  });

  app.post('/admin/jobs/:name/run', async (request) => {
    const job = allJobs.find((j) => j.name === (request.params as { name: string }).name);
    if (!job) throw Errors.notFound(L('Job nicht gefunden.', 'Job not found.'));
    const result = await runJobOnce(job, request.log);
    return { result };
  });

  /* ------------------------------------------------------------------- Logo */
  /** Logo hochladen (PNG, JPG, WebP, SVG – höchstens 512 KB). Body: { data: "<Base64 oder data:-URL>" } */
  app.post('/admin/logo', { bodyLimit: 1024 * 1024 }, async (request) => {
    const { data } = z.object({ data: z.string().min(10).max(1_000_000) }).parse(request.body);
    await saveLogo(currentUser(request), data, request.ip);
    return { ok: true };
  });
  app.post('/admin/logo/delete', async (request) => {
    await deleteLogo(currentUser(request), request.ip);
    return { ok: true };
  });

  /* ---------------------------------------------------------- Einstellungen */
  app.get('/admin/settings', async () => ({ settings: await getSettings() }));
  app.post('/admin/settings', async (request) => {
    const admin = currentUser(request);
    const before = await getSettings();
    const settings = await saveSettings(request.body);
    invalidatePublicSite();
    // Wartungsmodus oder manueller Status geändert → gleich im Discord melden
    syncStatusFeedSoon();
    const changes: string[] = [];
    if (before.maintenance.enabled !== settings.maintenance.enabled) changes.push(`Wartungsmodus ${settings.maintenance.enabled ? 'an' : 'aus'}`);
    if (before.registration.mode !== settings.registration.mode) changes.push(`Registrierung: ${settings.registration.mode}`);
    if (JSON.stringify(before.registration.limits) !== JSON.stringify(settings.registration.limits)) {
      const l = settings.registration.limits;
      changes.push(`Server pro Nutzer: ${l.minecraft} Minecraft, ${l.discord} Discord-Bots${l.total ? `, zusammen ${l.total}` : ''}`);
    }
    await audit({
      actor: 'admin',
      action: 'admin.settings_changed',
      message: `Einstellungen gespeichert${changes.length ? ` (${changes.join(', ')})` : ''} (durch ${admin.email})`,
      ip: request.ip,
    });
    return { settings };
  });

  /* ------------------------------------------------------------- Warteliste */
  app.get('/admin/waitlist', async (request) => listWaitlistPage(listQuery.parse(request.query).page));
  app.post('/admin/waitlist/release', async (request) => {
    const body = z.object({ ids: z.array(z.string().uuid()).max(500).optional(), count: z.number().int().min(1).max(500).optional() }).parse(request.body);
    const ids = body.ids?.length ? body.ids : await nextWaitlistIds(body.count ?? 0);
    return releaseWaitlist(ids, currentUser(request), request.ip);
  });
  app.post('/admin/waitlist/add', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request) => {
    const body = z
      .object({
        entries: z
          .array(z.object({ email: emailSchema, name: serverNameSchema.optional() }))
          .min(1)
          .max(500),
        planId: z.string().min(1),
        serverType: z.string().min(1),
        version: z.string().min(1).max(32),
        locale: z.enum(['de', 'en']).default('de'),
        priority: z.boolean().default(false),
        notify: z.boolean().default(true),
      })
      .parse(request.body);
    return addWaitlistEntries(body, currentUser(request), request.ip);
  });
  /** Vormerkungen außerhalb der Website: + N hängt einen Block hinten an, − N nimmt zuletzt hinzugefügte Plätze zurück */
  app.post('/admin/waitlist/external', async (request) => {
    const { delta } = z
      .object({ delta: z.number().int().min(-10_000_000).max(10_000_000).refine((v) => v !== 0, 'Bitte eine Anzahl ungleich 0 angeben.') })
      .parse(request.body);
    const before = await getSettings();
    const settings = await adjustExternalSpots(delta);
    await audit({
      actor: 'admin',
      action: 'waitlist.external_changed',
      message: `Vormerkungen außerhalb der Website ${delta > 0 ? `+${delta}` : delta}: ${before.waitlist.externalCount} → ${settings.waitlist.externalCount} (durch ${currentUser(request).email})`,
      ip: request.ip,
    });
    return { settings };
  });
  app.post('/admin/waitlist/:id/remove', async (request) => {
    const { id } = idParams.parse(request.params);
    await removeWaitlistEntry(id, currentUser(request), request.ip);
    return { ok: true };
  });

  /** Slots eines Pakets (Backups, Datenbanken, Ports) auf bestehende Server übertragen */
  app.post('/admin/plans/:planId/apply-slots', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request) => {
    const { planId } = z.object({ planId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/) }).parse(request.params);
    return { result: await applyPlanSlots(currentUser(request), planId, request.ip) };
  });

  /* -------------------------------------------------------------- Statusseite */
  const localizedText = (max: number) => z.object({ en: z.string().trim().max(max).default(''), de: z.string().trim().max(max).default('') });
  const incidentSchema = z.object({
    kind: z.enum(['incident', 'maintenance', 'notice']),
    impact: z.enum(['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance']),
    components: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/)).max(40),
    title: localizedText(160).refine((t) => !!(t.en || t.de), { message: 'Bitte einen Titel angeben (Englisch oder Deutsch).' }),
    message: z.object({ en: z.string().trim().max(5000).default(''), de: z.string().trim().max(5000).default('') }),
    startsAt: z.string().datetime({ offset: true }).nullable().optional().transform((v) => v ?? null),
    endsAt: z.string().datetime({ offset: true }).nullable().optional().transform((v) => v ?? null),
  });
  app.get('/admin/incidents', async () => ({ incidents: await listIncidents() }));
  app.post('/admin/incidents', async (request) => {
    await createIncident(currentUser(request), incidentSchema.parse(request.body), request.ip);
    syncStatusFeedSoon();
    return { ok: true };
  });
  app.post('/admin/incidents/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    await updateIncident(currentUser(request), id, incidentSchema.parse(request.body), request.ip);
    syncStatusFeedSoon();
    return { ok: true };
  });
  app.post('/admin/incidents/:id/resolve', async (request) => {
    const { id } = idParams.parse(request.params);
    await resolveIncident(currentUser(request), id, request.ip);
    syncStatusFeedSoon();
    return { ok: true };
  });
  app.post('/admin/incidents/:id/delete', async (request) => {
    const { id } = idParams.parse(request.params);
    await deleteIncident(currentUser(request), id, request.ip);
    syncStatusFeedSoon();
    return { ok: true };
  });

  app.post('/admin/mail-test', { config: { rateLimit: { max: 5, timeWindow: '5 minutes' } } }, async (request) => {
    const { to } = z.object({ to: emailSchema }).parse(request.body);
    if (!env.SMTP_HOST) return { ok: false, error: 'Kein Mailserver eingestellt (SMTP_HOST ist leer) – die Mail steht nur im Log der API.' };
    try {
      await sendTestMail(to);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: explainSmtpError(err) };
    }
  });
}
