/**
 * Admin-Bereich: Übersicht, Listen und Eingriffe (Sperren, Verlängern, Pause aufheben …).
 * Jede Aktion wird im Audit-Log mit actor = admin protokolliert.
 */
import { resetSecondFactor } from './two-factor.service';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lte, ne, notInArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import {
  ADMIN_PAGE_SIZE,
  allPlans,
  findPlan,
  normalizeLimitOverrides,
  type UserLimitOverrides,
  type SiteSettings,
  cycleEndFor,
  productHasCycle,
  freeHostingConfig,
  productKinds,
  type AdminPanelDTO,
  type BulkServerInput,
  type BulkServerResult,
  type AdminAuditDTO,
  type AdminJobDTO,
  type AdminMailDTO,
  type AdminOverviewDTO,
  type AdminServerDTO,
  type PendingReason,
  type AdminUserDTO,
  type AdminWaitlistDTO,
  type AdminWaitlistBlockDTO,
  type AdminIncidentInput,
  type StatusIncidentDTO,
  tierForPosition,
  websiteEpycSlots,
  type PageInfo,
} from '@chfree/shared';
import { adminEmails, env, mailFrom, panelPublicUrl, smtpSecure } from '../env';
import { affectedRows, db } from '../db/client';
import { auditLogs, jobRuns, notifications, servers, statusIncidents, users, type Server, type User } from '../db/schema';
import { decryptField, uuid } from '../lib/crypto';
import { getSettings, waitlistRank } from './settings.service';
import { addonCounts } from './addons.service';
import { toIncidentDTO } from './status.service';
import { ApiError, Errors, L } from '../lib/errors';
import { isAdmin } from '../plugins/auth';
import { deleteAccount } from './account.service';
import { allJobs } from '../jobs/registry';
import { pterodactyl } from '../pterodactyl';
import { installMethodOf, pterodactylConfig, suggestEggs } from '../config/pterodactyl.config';
import { abuseReasonLabel } from './abuse-reasons';
import { mapLimit } from '../jobs/types';
import { audit } from './audit.service';
import { cycleEndForServer } from './runtime';
import { sendMail } from './mail/mailer';
import { notificationMail } from './mail/templates';
import { trySyncPanelDescription } from './panel';
import { provisionServer, startupFor } from './provisioning.service';
import { activatePendingServers, hardDeleteServer, pendingReasonFor } from './server.service';
import { destroyAllSessions } from './session.service';
import { liftBan } from './warnings.service';
import { installerReady, installerStartup, installsViaDirectory, requestSiteSoftware, resolveSoftware } from './partner-software.service';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const panelServerAdminUrl = (id: number | null) => (id ? `${panelPublicUrl}/admin/servers/view/${id}` : null);
const panelUserAdminUrl = (id: number | null) => (id ? `${panelPublicUrl}/admin/users/view/${id}` : null);
const escapeLike = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
/** LIKE mit „\\“ als Escape-Zeichen (SQLite kennt – anders als MySQL – kein Standard-Escape-Zeichen) */
const like = (column: SQLWrapper, pattern: string): SQL => sql`${column} like ${pattern} escape '\\'`;

/* ------------------------------------------------------------------ Übersicht */

async function jobStatus(now: Date): Promise<AdminJobDTO[]> {
  return Promise.all(
    allJobs.map(async (job) => {
      const [last] = await db.select().from(jobRuns).where(eq(jobRuns.job, job.name)).orderBy(desc(jobRuns.startedAt)).limit(1);
      const [lastFailed] =
        last?.status === 'failed' ? [last] : await db.select().from(jobRuns).where(and(eq(jobRuns.job, job.name), eq(jobRuns.status, 'failed'))).orderBy(desc(jobRuns.startedAt)).limit(1);
      return {
        name: job.name,
        intervalSeconds: Math.round(job.intervalMs / 1000),
        lastStatus: last?.status ?? null,
        lastStartedAt: iso(last?.startedAt),
        lastFinishedAt: iso(last?.finishedAt),
        lastError: last?.status === 'failed' ? (last.error ?? null) : lastFailed && last && lastFailed.startedAt > new Date(now.getTime() - 3600_000) ? lastFailed.error : null,
        stale: !last || now.getTime() - last.startedAt.getTime() > job.intervalMs * 3 + 60_000,
      };
    }),
  );
}

export async function getOverview(): Promise<AdminOverviewDTO> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400_000);
  const [u] = await db
    .select({
      total: count(),
      verified: sql<number>`sum(${users.emailVerifiedAt} is not null)`,
      locked: sql<number>`sum(${users.status} = 'locked')`,
      admins: sql<number>`sum(${users.role} = 'admin')`,
      newLast7Days: sql<number>`sum(${users.createdAt} >= ${weekAgo.getTime()})`,
    })
    .from(users);
  const statusRows = await db.select({ status: servers.status, n: count() }).from(servers).groupBy(servers.status);
  const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, Number(r.n)]));
  const [live] = await db
    .select({
      online: sql<number>`sum(${servers.powerState} in ('running','starting') and ${servers.status} = 'active')`,
      paused: sql<number>`sum(${servers.pausedUntil} > ${now.getTime()} and ${servers.status} = 'active')`,
    })
    .from(servers);
  const planRows = await db
    .select({ kind: servers.kind, planId: servers.planId, n: count() })
    .from(servers)
    .where(inArray(servers.status, ['provisioning', 'provisioning_failed', 'active', 'expiring', 'suspended']))
    .groupBy(servers.kind, servers.planId);
  const [mailPending] = await db.select({ n: count() }).from(notifications).where(eq(notifications.emailStatus, 'pending'));
  const [mailFailed] = await db.select({ n: count() }).from(notifications).where(eq(notifications.emailStatus, 'failed'));
  const [lastMailError] = await db
    .select({ e: notifications.emailLastError })
    .from(notifications)
    .where(isNotNull(notifications.emailLastError))
    .orderBy(desc(notifications.createdAt))
    .limit(1);

  const settings = await getSettings();
  const [wlc] = await db.select({ n: count() }).from(servers).where(and(eq(servers.status, 'waitlist'), isNotNull(servers.waitlistPosition)));
  const [wlu] = await db.select({ n: count() }).from(servers).where(and(eq(servers.status, 'waitlist'), sql`${servers.waitlistPosition} is null`));
  return {
    site: {
      maintenance: settings.maintenance.enabled,
      registrationMode: settings.registration.mode,
      limits: settings.registration.limits,
      waitlistConfirmed: Number(wlc?.n ?? 0),
      waitlistUnconfirmed: Number(wlu?.n ?? 0),
    },
    users: {
      total: Number(u?.total ?? 0),
      verified: Number(u?.verified ?? 0),
      locked: Number(u?.locked ?? 0),
      admins: Number(u?.admins ?? 0),
      newLast7Days: Number(u?.newLast7Days ?? 0),
    },
    servers: {
      byStatus,
      online: Number(live?.online ?? 0),
      paused: Number(live?.paused ?? 0),
      total: Object.entries(byStatus).reduce((a, [k, v]) => (k === 'deleted' ? a : a + v), 0),
    },
    products: productKinds.map((kind) => ({
      kind,
      enabled: settings.products[kind].enabled,
      count: planRows.filter((r) => r.kind === kind).reduce((sum, r) => sum + Number(r.n), 0),
      reserved: settings.products[kind].reserved,
      capacity: settings.products[kind].capacity,
    })),
    plans: allPlans(settings).map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      count: Number(planRows.find((r) => r.planId === p.id)?.n ?? 0),
      reserved: p.reserved,
      capacity: p.capacity,
    })),
    mails: { pending: Number(mailPending?.n ?? 0), failed: Number(mailFailed?.n ?? 0), lastError: lastMailError?.e ?? null },
    addons: { enabled: settings.addons.enabled, ...(await addonCounts()) },
    jobs: await jobStatus(now),
    system: {
      pterodactylMode: pterodactyl().mode,
      panelUrl: panelPublicUrl,
      smtpConfigured: !!env.SMTP_HOST,
      smtpTarget: env.SMTP_HOST ? `${env.SMTP_HOST}:${env.SMTP_PORT} (${smtpSecure ? 'SSL' : 'STARTTLS'}) · ${env.SMTP_USER ?? '–'}` : null,
      mailFrom,
      adminEmailsConfigured: adminEmails.size,
    },
  };
}

/* --------------------------------------------------------------------- Listen */

/** Seite → Offset (50 pro Seite) und Seiteninfos */
function paging(page: number | undefined, total: number): PageInfo & { offset: number } {
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const p = Math.min(Math.max(1, Math.floor(page ?? 1)), pages);
  return { page: p, pageSize: ADMIN_PAGE_SIZE, total, pages, offset: (p - 1) * ADMIN_PAGE_SIZE };
}

export async function listServersAdmin(
  filter: { q?: string; status?: string; kind?: string; page?: number },
): Promise<{ servers: AdminServerDTO[] } & PageInfo> {
  const conds: SQL[] = [];
  if (filter.kind === 'minecraft' || filter.kind === 'discord') conds.push(eq(servers.kind, filter.kind));
  if (filter.status && filter.status !== 'all') conds.push(eq(servers.status, filter.status as Server['status']));
  else conds.push(ne(servers.status, 'deleted'));
  if (filter.q?.trim()) {
    const q = escapeLike(filter.q.trim());
    conds.push(or(like(servers.name, q), like(users.email, q), like(servers.id, q), like(servers.address, q))!);
  }
  const [totalRow] = await db
    .select({ n: count() })
    .from(servers)
    .innerJoin(users, eq(users.id, servers.userId))
    .where(and(...conds));
  const { offset, ...info } = paging(filter.page, Number(totalRow?.n ?? 0));
  const rows = await db
    .select({ s: servers, email: users.email, locale: users.locale, emailVerifiedAt: users.emailVerifiedAt, pteroUserId: users.pteroUserId, discordId: users.discordId })
    .from(servers)
    .innerJoin(users, eq(users.id, servers.userId))
    .where(and(...conds))
    .orderBy(desc(servers.createdAt), desc(servers.id))
    .limit(ADMIN_PAGE_SIZE)
    .offset(offset);
  // Offene Anfragen: worauf sie warten (für Discord genügt ein bis zu 60 Sekunden alter Stand)
  const reasons = new Map<string, PendingReason>();
  await mapLimit(
    rows.filter((r) => r.s.status === 'pending'),
    5,
    async (r) => void reasons.set(r.s.id, await pendingReasonFor(r, { cached: true })),
  );
  const list = rows.map(({ s, email, locale }) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    ownerId: s.userId,
    ownerEmail: email,
    ownerLocale: locale,
    planId: s.planId,
    serverType: s.serverType,
    version: s.version,
    status: s.status,
    suspensionReason: s.suspensionReason,
    powerState: s.powerState,
    address: s.address,
    cycleNumber: s.cycleNumber,
    cycleEndsAt: s.cycleEndsAt.toISOString(),
    reactivationCount: s.reactivationCount,
    suspendedAt: iso(s.suspendedAt),
    pausedUntil: iso(s.pausedUntil),
    pauseReason: s.pauseReason,
    pendingReason: s.status === 'pending' ? (reasons.get(s.id) ?? 'stuck') : null,
    abuse: s.abuseAt ? { at: s.abuseAt.toISOString(), reason: abuseReasonLabel(s.abuseReason) } : null,
    // Einrichtung der Server-Software (Typen ohne eigenes Egg): läuft noch bzw. ist fehlgeschlagen
    software: s.softwareJob ? { status: s.softwareJob.error ? ('failed' as const) : ('installing' as const), error: s.softwareJob.error, retries: s.softwareJob.retries ?? 0 } : null,
    provisioningAttempts: s.provisioningAttempts,
    provisioningError: s.provisioningError,
    panelDescription: s.panelDescription,
    pteroServerId: s.pteroServerId,
    panelAdminUrl: panelServerAdminUrl(s.pteroServerId),
    nodeId: s.nodeId,
    upgradedAt: iso(s.upgradedAt),
    transfer: s.transferNodeId !== null ? { nodeId: s.transferNodeId, mode: s.transferMode ?? ('manual' as const), startedAt: (s.transferStartedAt ?? s.updatedAt).toISOString() } : null,
    createdAt: s.createdAt.toISOString(),
  }));
  return { servers: list, ...info };
}

/** Filter der Nutzerliste (schnelles Aufräumen, z. B. nie bestätigte Konten) */
export const USER_FILTERS = {
  unverified: 'E-Mail unbestätigt',
  'no-servers': 'ohne Server',
  waitlist: 'auf der Warteliste',
  locked: 'gesperrt',
  admins: 'Admins',
  beta: 'Beta-Zugang',
} as const;

/**
 * Server je Nutzer als Unterabfrage. Bewusst mit festen Tabellen-Aliasen: Drizzle lässt bei Abfragen auf nur
 * eine Tabelle den Tabellennamen weg – aus `servers.user_id = users.id` würde sonst `user_id = id` (falsch).
 */
const userServerCount = sql<number>`(select count(*) from "servers" s_cnt where s_cnt."user_id" = "users"."id" and s_cnt."status" <> 'deleted')`;

/** Admin = Rolle in der Datenbank oder Adresse in ADMIN_EMAILS */
function adminCond(): SQL {
  const emails = [...adminEmails];
  return emails.length ? or(eq(users.role, 'admin'), inArray(users.email, emails))! : eq(users.role, 'admin');
}

/** Suche + Filter der Nutzerliste (auch für „Alle Treffer löschen“) */
function userConds(filter: { q?: string; status?: string }): SQL[] {
  const conds: SQL[] = [];
  if (filter.q?.trim()) conds.push(or(like(users.email, escapeLike(filter.q.trim())), like(users.pteroUsername, escapeLike(filter.q.trim())))!);
  if (filter.status === 'unverified') conds.push(isNull(users.emailVerifiedAt));
  if (filter.status === 'locked') conds.push(eq(users.status, 'locked'));
  if (filter.status === 'admins') conds.push(adminCond());
  if (filter.status === 'beta') conds.push(eq(users.beta, true));
  if (filter.status === 'no-servers') conds.push(sql`${userServerCount} = 0`);
  if (filter.status === 'waitlist') conds.push(sql`exists (select 1 from "servers" s_wl where s_wl."user_id" = "users"."id" and s_wl."status" = 'waitlist')`);
  return conds;
}

export async function listUsersAdmin(
  filter: { q?: string; status?: string; page?: number },
): Promise<{ users: AdminUserDTO[]; deletable: number } & PageInfo> {
  const serverCount = userServerCount;
  const conds = userConds(filter);
  const where = conds.length ? and(...conds) : undefined;
  const [totalRow] = await db.select({ n: count() }).from(users).where(where);
  // Treffer ohne Admins – so viele Konten würde „Alle Treffer löschen“ entfernen
  const [deletableRow] = await db
    .select({ n: count() })
    .from(users)
    .where(and(...conds, sql`not (${adminCond()})`));
  const { offset, ...info } = paging(filter.page, Number(totalRow?.n ?? 0));
  const rows = await db
    .select({ u: users, servers: serverCount })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(ADMIN_PAGE_SIZE)
    .offset(offset);
  const list = rows.map(({ u, servers: n }): AdminUserDTO => ({
    id: u.id,
    email: u.email,
    role: u.role === 'admin' || adminEmails.has(u.email.toLowerCase()) ? 'admin' : 'user',
    status: u.status,
    locale: u.locale,
    emailVerified: !!u.emailVerifiedAt,
    emailUndeliverable: !!u.emailUndeliverableAt,
    panelUsername: u.pteroUsername,
    pteroUserId: u.pteroUserId,
    panelAdminUrl: panelUserAdminUrl(u.pteroUserId),
    servers: Number(n),
    lastLoginAt: iso(u.lastLoginAt),
    beta: u.beta,
    partner: u.partner,
    twoFactor: u.twoFactorMethod ?? null,
    registrationIp: decryptField(u.registrationIp),
    lastLoginIp: decryptField(u.lastLoginIp),
    createdAt: u.createdAt.toISOString(),
    limitOverrides: u.limitOverrides ? normalizeLimitOverrides(u.limitOverrides) : null,
  }));
  return { users: list, deletable: Number(deletableRow?.n ?? 0), ...info };
}

/**
 * Gelöschte Pakete aus allen Freischaltungen entfernen – sonst bekäme ein später gleich benanntes neues Paket (gleiche
 * ID) die alte Freischaltung. Läuft nach jedem Speichern der Einstellungen.
 */
export async function pruneLimitOverrides(settings: SiteSettings): Promise<number> {
  const known = new Set(productKinds.flatMap((k) => settings.products[k].plans.map((p) => p.id)));
  const rows = await db.select({ id: users.id, overrides: users.limitOverrides }).from(users).where(isNotNull(users.limitOverrides));
  let changed = 0;
  for (const row of rows) {
    const o = normalizeLimitOverrides(row.overrides);
    const plans = Object.fromEntries(Object.entries(o.plans).filter(([id]) => known.has(id)));
    if (Object.keys(plans).length === Object.keys(o.plans).length) continue;
    const next = { ...o, plans };
    const empty = next.minecraft === null && next.discord === null && next.total === null && Object.keys(plans).length === 0;
    await db.update(users).set({ limitOverrides: empty ? null : next }).where(eq(users.id, row.id));
    changed++;
  }
  return changed;
}

/**
 * Abweichende Grenzen eines Nutzers setzen (Admin → Nutzer → Grenzen): Anzahl Minecraft-Server, Discord-Bots, gesamt und
 * je Zusatzpaket bzw. freigeschaltetem Paket. Bestehende Server bleiben unberührt; die Grenzen gelten für neue Server.
 */
export async function setUserLimits(admin: User, userId: string, input: unknown, ip?: string): Promise<UserLimitOverrides | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw Errors.notFound(L('Nutzer nicht gefunden.', 'User not found.'));
  const settings = await getSettings();
  const known = new Set(productKinds.flatMap((k) => settings.products[k].plans.map((p) => p.id)));
  const next = normalizeLimitOverrides(input);
  // Nur Pakete, die es gibt
  next.plans = Object.fromEntries(Object.entries(next.plans).filter(([id]) => known.has(id)));
  const empty = next.minecraft === null && next.discord === null && next.total === null && Object.keys(next.plans).length === 0;
  await db.update(users).set({ limitOverrides: empty ? null : next }).where(eq(users.id, userId));
  const plan = (id: string) => findPlan(settings, id)?.name ?? id;
  const text = empty
    ? 'Standard-Grenzen'
    : [
        next.minecraft !== null ? `Minecraft ${next.minecraft}` : null,
        next.discord !== null ? `Discord-Bots ${next.discord}` : null,
        next.total !== null ? `gesamt ${next.total}` : null,
        ...Object.entries(next.plans).map(([id, n]) => `${plan(id)} ×${n}`),
      ]
        .filter(Boolean)
        .join(', ');
  await audit({ userId, actor: 'admin', action: 'admin.user_limits', message: `Grenzen für ${user.email}: ${text} (durch ${admin.email})`, ip });
  return empty ? null : next;
}

export async function listAudit(filter: { q?: string; page?: number }): Promise<{ entries: AdminAuditDTO[] } & PageInfo> {
  const q = filter.q?.trim() ? escapeLike(filter.q.trim()) : null;
  const where = q ? or(like(auditLogs.message, q), like(auditLogs.action, q), like(users.email, q), like(auditLogs.serverId, q)) : undefined;
  const [totalRow] = await db.select({ n: count() }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.userId)).where(where);
  const { offset, ...info } = paging(filter.page, Number(totalRow?.n ?? 0));
  const rows = await db
    .select({ a: auditLogs, email: users.email })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(where)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(ADMIN_PAGE_SIZE)
    .offset(offset);
  const list = rows.map(({ a, email }) => ({
    id: a.id,
    createdAt: a.createdAt.toISOString(),
    actor: a.actor,
    action: a.action,
    message: a.message,
    userEmail: email ?? null,
    serverId: a.serverId,
    ip: decryptField(a.ip),
  }));
  return { entries: list, ...info };
}

export async function listMailProblems(): Promise<AdminMailDTO[]> {
  const rows = await db
    .select({ n: notifications, email: users.email })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(inArray(notifications.emailStatus, ['pending', 'failed']))
    .orderBy(desc(notifications.createdAt))
    .limit(100);
  return rows.map(({ n, email }) => ({
    id: n.id,
    createdAt: n.createdAt.toISOString(),
    type: n.type,
    title: n.title,
    userEmail: email,
    emailStatus: n.emailStatus,
    emailAttempts: n.emailAttempts,
    emailLastError: n.emailLastError,
  }));
}

/* -------------------------------------------------------------------- Aktionen */

async function getServer(id: string): Promise<Server> {
  const [server] = await db.select().from(servers).where(and(eq(servers.id, id), ne(servers.status, 'deleted'))).limit(1);
  if (!server) throw Errors.notFound(L('Server nicht gefunden.', 'Server not found.'));
  return server;
}

async function getUserById(id: string): Promise<User> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw Errors.notFound(L('Nutzer nicht gefunden.', 'User not found.'));
  return user;
}

const stateChanged = () =>
  Errors.conflict('state_changed', L('Der Status hat sich inzwischen geändert – bitte neu laden.', 'The status has changed in the meantime – please reload.'));

const retryFailed = (error: string | null | undefined) => {
  const text = (error ?? 'unbekannter Fehler').slice(0, 400);
  return new ApiError(502, 'retry_failed', L(`Erneut versucht – wieder fehlgeschlagen: ${text}`, `Tried again – failed again: ${text}`));
};

export type ServerAction = 'suspend' | 'unsuspend' | 'extend' | 'clear-pause' | 'retry' | 'delete' | 'reinstall-software';

export async function serverAction(admin: User, id: string, action: ServerAction, ip?: string): Promise<void> {
  const server = await getServer(id);
  const now = new Date();
  const ptero = pterodactyl();
  const log = (act: string, message: string) => audit({ userId: server.userId, serverId: server.id, actor: 'admin', action: act, message: `${message} (durch ${admin.email})`, ip });

  switch (action) {
    case 'suspend': {
      const res = await db
        .update(servers)
        .set({ status: 'suspended', suspensionReason: 'admin', suspendedAt: now, expiringSince: null })
        .where(and(eq(servers.id, id), inArray(servers.status, ['active', 'expiring'])));
      if (affectedRows(res) !== 1) throw stateChanged();
      // Pterodactyl stoppt den Server beim Sperren; die Laufzeit-Session schließt der Power-Sync
      if (server.pteroServerId) await ptero.suspendServer(server.pteroServerId).catch(() => {});
      await trySyncPanelDescription(server.id);
      await log('admin.server_suspended', `Server „${server.name}“ vom Team gesperrt`);
      return;
    }
    case 'unsuspend': {
      const newCycle = server.cycleEndsAt <= now;
      const res = await db
        .update(servers)
        .set({
          status: 'active',
          suspensionReason: null,
          suspendedAt: null,
          expiringSince: null,
          ...(newCycle ? { cycleNumber: server.cycleNumber + 1, cycleStartedAt: now, cycleEndsAt: cycleEndForServer(server, now, freeHostingConfig.cycle) } : {}),
        })
        .where(and(eq(servers.id, id), eq(servers.status, 'suspended')));
      if (affectedRows(res) !== 1) throw stateChanged();
      if (server.pteroServerId) await ptero.unsuspendServer(server.pteroServerId).catch(() => {});
      await trySyncPanelDescription(server.id);
      await log('admin.server_unsuspended', `Server „${server.name}“ entsperrt${newCycle ? ' – neuer Zyklus gestartet' : ''}`);
      return;
    }
    case 'reinstall-software': {
      // Die gewählte Server-Software (ohne eigenes Egg) noch einmal einrichten – z. B. nach einem Fehlschlag
      if (!['active', 'expiring'].includes(server.status)) throw stateChanged();
      const settings = await getSettings();
      if (!server.partnerId && server.pteroServerId && installsViaDirectory(server.serverType, settings) && (await installerReady(settings))) {
        // Mitgeliefertes Egg: Software in die Variablen und im Panel neu installieren (Welt und übrige Dateien bleiben)
        const software = await resolveSoftware(server.serverType, server.version);
        await ptero.updateServerStartup(server.pteroServerId, await installerStartup(software, settings, { eula: !!server.eulaAcceptedAt }));
        await ptero.reinstallServer(server.pteroServerId);
        await db.update(servers).set({ softwareJob: null, version: software.resolvedVersion, powerState: 'installing', powerStateAt: new Date() }).where(eq(servers.id, id));
        await log('admin.server_software', `Server-Software von „${server.name}“ wird im Panel neu installiert (${server.serverType} ${software.resolvedVersion})`);
        return;
      }
      if (!(await requestSiteSoftware(server))) {
        // Inzwischen über ein eigenes Egg: im Panel auf dieses Egg umstellen und neu installieren (sonst bliebe der
        // Hinweis-Startbefehl bzw. die Grundlage stehen) und den alten Auftrag entfernen
        if (server.softwareJob && server.pteroServerId && installMethodOf(server.serverType, settings) === 'egg') {
          await ptero.updateServerStartup(server.pteroServerId, await startupFor(server.serverType, server.version, settings));
          await ptero.reinstallServer(server.pteroServerId);
          await db.update(servers).set({ softwareJob: null, powerState: 'installing', powerStateAt: new Date() }).where(eq(servers.id, id));
          await log('admin.server_software', `„${server.name}“ wird über das eigene Egg von ${server.serverType} neu installiert (alter Einrichtungs-Auftrag entfernt)`);
          return;
        }
        if (installMethodOf(server.serverType, settings) === null) {
          throw Errors.conflict('not_available', L('Für diese Server-Software ist gerade weder ein Egg noch eine Grundlage eingerichtet.', 'Neither an egg nor a base is set up for this server software right now.'));
        }
        throw Errors.conflict('not_applicable', L('Dieser Servertyp wird über ein eigenes Egg installiert – hier gibt es nichts neu einzurichten.', 'This server type is installed through its own egg – there is nothing to set up again here.'));
      }
      await log('admin.server_software', `Server-Software von „${server.name}“ wird neu eingerichtet (${server.serverType} ${server.version})`);
      return;
    }
    case 'extend': {
      if (!['active', 'expiring', 'suspended'].includes(server.status) || (server.status === 'suspended' && server.suspensionReason !== 'cycle_expired')) {
        throw Errors.conflict('not_extendable', L('Dieser Server kann nicht verlängert werden (gesperrt oder noch nicht eingerichtet).', 'This server cannot be extended.'));
      }
      const wasSuspended = server.status !== 'active';
      const res = await db
        .update(servers)
        .set({
          status: 'active',
          suspensionReason: null,
          suspendedAt: null,
          expiringSince: null,
          cycleNumber: server.cycleNumber + 1,
          cycleStartedAt: now,
          cycleEndsAt: cycleEndForServer(server, now, freeHostingConfig.cycle),
          ...(wasSuspended ? { reactivationCount: server.reactivationCount + 1, lastReactivatedAt: now } : {}),
        })
        .where(and(eq(servers.id, id), eq(servers.status, server.status)));
      if (affectedRows(res) !== 1) throw stateChanged();
      if (wasSuspended && server.pteroServerId) await ptero.unsuspendServer(server.pteroServerId).catch(() => {});
      await trySyncPanelDescription(server.id);
      await log(
        'admin.server_extended',
        productHasCycle(server.kind)
          ? `Server „${server.name}“ um ${freeHostingConfig.cycle.days} Tage verlängert (Zyklus ${server.cycleNumber + 1})`
          : `Discord-Bot „${server.name}“ reaktiviert bzw. Laufzeit erneuert (läuft ohne Enddatum)`,
      );
      return;
    }
    case 'clear-pause': {
      await db.update(servers).set({ pausedUntil: null, pauseReason: null, pausedAt: null }).where(eq(servers.id, id));
      await trySyncPanelDescription(server.id);
      await log('admin.pause_cleared', `Fair-Use-Pause von „${server.name}“ aufgehoben`);
      return;
    }
    case 'retry': {
      // Offene Anfrage: Voraussetzungen jetzt prüfen und den Server erstellen
      if (server.status === 'pending') {
        const owner = await getUserById(server.userId);
        let activated: string[];
        try {
          activated = await activatePendingServers(owner, ip);
        } catch (err) {
          throw new ApiError(502, 'retry_failed', L(`Die Erstellung ist fehlgeschlagen: ${(err as Error).message}`.slice(0, 300), `Creation failed: ${(err as Error).message}`.slice(0, 300)));
        }
        if (activated.includes(id)) {
          // Die Erstellung lief gerade – ist sie gescheitert, bekommt das Team den neuen Fehler sofort zu sehen
          const [now2] = await db.select({ status: servers.status, error: servers.provisioningError }).from(servers).where(eq(servers.id, id)).limit(1);
          if (now2?.status === 'provisioning_failed') {
            await log('admin.pending_retry', `Offene Anfrage „${server.name}“ erneut versucht – Erstellung fehlgeschlagen: ${now2.error ?? 'unbekannter Fehler'}`);
            throw retryFailed(now2.error);
          }
          await log('admin.pending_retry', `Offene Anfrage „${server.name}“ erneut versucht – der Server wird erstellt`);
          return;
        }
        const [still] = await db.select({ id: servers.id }).from(servers).where(and(eq(servers.id, id), eq(servers.status, 'pending'))).limit(1);
        if (!still) {
          await log('admin.pending_retry', `Offene Anfrage „${server.name}“ erneut versucht – verworfen, weil die Server-Grenze des Nutzers erreicht ist`);
          throw new ApiError(409, 'limit_reached', L('Die Anfrage wurde verworfen: Der Nutzer hat die maximale Anzahl an Servern bereits erreicht.', 'The request was discarded: the user has already reached the maximum number of servers.'));
        }
        const why: Record<PendingReason, string> = {
          email: 'Der Nutzer hat seine E-Mail-Adresse noch nicht bestätigt.',
          panel: 'Der Nutzer hat noch kein Panel-Konto angelegt.',
          discord_not_linked: 'Der Nutzer hat sein Discord-Konto noch nicht verbunden.',
          discord_not_member: 'Das Discord-Konto ist verknüpft, aber kein Mitglied eures Discord-Servers.',
          discord_unavailable: 'Discord ist gerade nicht erreichbar – die Mitgliedschaft lässt sich nicht prüfen. Bitte gleich noch einmal versuchen.',
          stuck: 'Der Server konnte nicht erstellt werden. Bitte gleich noch einmal versuchen.',
        };
        const message = why[await pendingReasonFor(owner)];
        throw new ApiError(409, 'not_ready', L(message, message));
      }
      const res = await db
        .update(servers)
        .set({ provisioningAttempts: 0, lastProvisionAttemptAt: null, provisioningError: null })
        .where(and(eq(servers.id, id), eq(servers.status, 'provisioning_failed')));
      if (affectedRows(res) !== 1) throw stateChanged();
      // Sofort ausführen (nicht auf den nächsten Lauf des Jobs warten) und das Ergebnis melden
      await provisionServer(id, 'system', ip);
      const [after] = await db.select({ status: servers.status, error: servers.provisioningError }).from(servers).where(eq(servers.id, id)).limit(1);
      if (after?.status === 'provisioning_failed') {
        await log('admin.provisioning_retry', `Einrichtung von „${server.name}“ erneut versucht – wieder fehlgeschlagen: ${after.error ?? 'unbekannter Fehler'}`);
        throw retryFailed(after.error);
      }
      await log('admin.provisioning_retry', `Einrichtung von „${server.name}“ erneut versucht – der Server wird erstellt`);
      return;
    }
    case 'delete': {
      await hardDeleteServer(server);
      await log('admin.server_deleted', `Server „${server.name}“ gelöscht`);
      return;
    }
  }
}

/* ------------------------------------------------------- Alle Server auf einmal */

/**
 * Sperrt, entsperrt oder löscht ALLE Server – außer denen von Admin-Konten und ausgewählten Konten.
 *  – suspend:   alle aktiven Server werden vom Team gesperrt (im Panel suspendiert, Daten bleiben erhalten)
 *  – unsuspend: hebt genau diese Team-Sperren wieder auf (abgelaufene Server bleiben abgelaufen)
 *  – delete:    löscht die Server samt Daten im Panel – auch Anfragen und Wartelisten-Plätze
 * Arbeitet in Runden (`limit` Server pro Aufruf); die Website ruft so lange auf, bis `remaining` 0 ist.
 */
export async function bulkServerAction(admin: User, input: BulkServerInput, ip?: string): Promise<BulkServerResult> {
  // Ausgenommene Konten: alle Admins (Rolle oder ADMIN_EMAILS) + die angegebenen Adressen
  const wanted = [...new Set(input.exemptEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const exemptRows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(or(adminCond(), wanted.length ? inArray(users.email, wanted) : undefined));
  const exemptIds = exemptRows.map((r) => r.id);
  const known = new Set(exemptRows.map((r) => r.email.toLowerCase()));
  const unknownEmails = wanted.filter((e) => !known.has(e));

  const base: SQL[] = [];
  if (input.kind !== 'all') base.push(eq(servers.kind, input.kind));
  if (input.action === 'suspend') base.push(inArray(servers.status, ['active', 'expiring']));
  else if (input.action === 'unsuspend') base.push(eq(servers.status, 'suspended'), eq(servers.suspensionReason, 'admin'));
  else base.push(ne(servers.status, 'deleted'));
  const notExempt = exemptIds.length ? notInArray(servers.userId, exemptIds) : undefined;
  const target = and(...base, notExempt);
  const countTargets = async () => Number((await db.select({ n: count() }).from(servers).where(target))[0]?.n ?? 0);
  const [exemptRow] = exemptIds.length
    ? await db
        .select({ n: count() })
        .from(servers)
        .where(and(...base, inArray(servers.userId, exemptIds)))
    : [{ n: 0 }];
  const exempt = Number(exemptRow?.n ?? 0);

  if (input.dryRun) return { processed: 0, failed: 0, remaining: await countTargets(), exempt, unknownEmails, errors: [] };

  const rows = await db
    .select({ id: servers.id, name: servers.name })
    .from(servers)
    .where(target)
    .orderBy(asc(servers.createdAt), asc(servers.id))
    .limit(Math.min(Math.max(input.limit ?? 20, 1), 50))
    .offset(Math.max(0, input.skip ?? 0));
  if (rows.length > 0 && !input.skip) {
    await audit({
      actor: 'admin',
      action: `admin.bulk_${input.action}`,
      message: `Massenaktion „${input.action}“ für ${input.kind === 'all' ? 'alle Server' : input.kind} gestartet – ${exempt} Server ausgenommen (durch ${admin.email})`,
      ip,
    });
  }
  let processed = 0;
  const errors: string[] = [];
  await mapLimit(rows, 4, async (row) => {
    try {
      await serverAction(admin, row.id, input.action, ip);
      processed++;
    } catch (err) {
      errors.push(`${row.name}: ${(err as Error).message}`.slice(0, 200));
    }
  });
  return { processed, failed: errors.length, remaining: await countTargets(), exempt, unknownEmails, errors: errors.slice(0, 10) };
}

/* ------------------------------------------------------------- Pterodactyl */

/**
 * Verbindung zum Panel prüfen und alles einlesen, was dort eingerichtet ist: Nodes (mit freien Ports) und alle Eggs.
 * Im Admin-Bereich werden daraus die Nodes für Minecraft bzw. Discord-Bots und die Eggs je Servertyp ausgewählt.
 */
export async function getPanelInfo(): Promise<AdminPanelDTO> {
  const ptero = pterodactyl();
  const result: AdminPanelDTO = { mode: ptero.mode, url: panelPublicUrl, connected: false, error: null, nodes: [], eggs: [], suggestedEggs: {} };
  try {
    const [nodes, locations, eggs] = await Promise.all([ptero.listNodes(), ptero.listLocations().catch(() => []), ptero.listEggs()]);
    const free = await Promise.all(nodes.map((n) => ptero.freeAllocations(n.id).then((f) => f.count, () => null)));
    result.nodes = nodes.map((n, i) => {
      const loc = locations.find((l) => l.id === n.locationId);
      return {
        id: n.id,
        name: n.name,
        fqdn: n.fqdn,
        locationId: n.locationId,
        locationName: loc ? loc.long || loc.short : null,
        memoryMb: n.memoryMb,
        diskMb: n.diskMb,
        maintenance: n.maintenanceMode,
        freeAllocations: free[i] ?? null,
      };
    });
    result.eggs = eggs.map((e) => ({ ...e, description: e.description.slice(0, 200) }));
    result.suggestedEggs = suggestEggs(eggs);
    result.connected = true;
    // Der Client-Key wird für Stopps, Ressourcen und Hinweise gebraucht
    await ptero.pingClient().catch((err) => {
      result.error = `Application-API-Key funktioniert, der Client-API-Key (PTERODACTYL_CLIENT_KEY) aber nicht: ${(err as Error).message}`;
    });
  } catch (err) {
    result.error = (err as Error).message;
  }
  return result;
}

export type UserAction = 'lock' | 'unlock' | 'make-admin' | 'remove-admin' | 'grant-beta' | 'revoke-beta' | 'grant-partner' | 'revoke-partner' | 'reset-two-factor';

/**
 * Konten löschen (einzeln oder mehrere). Übersprungen werden das eigene Konto und Admins
 * (erst die Admin-Rechte entfernen) sowie Konten, deren Server im Panel gerade nicht gelöscht werden können.
 */
export async function deleteUsersAdmin(
  admin: User,
  target: { ids?: string[]; emails?: string[] },
  ip?: string,
): Promise<{ deleted: number; servers: number; skipped: { email: string; reason: string }[] }> {
  const result = { deleted: 0, servers: 0, skipped: [] as { email: string; reason: string }[] };
  const ids = [...new Set(target.ids ?? [])];
  const emails = [...new Set((target.emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const rows = [
    ...(ids.length ? await db.select().from(users).where(inArray(users.id, ids)) : []),
    ...(emails.length ? await db.select().from(users).where(inArray(users.email, emails)) : []),
  ].filter((u, i, all) => all.findIndex((x) => x.id === u.id) === i);
  // Adressen aus der Liste, zu denen es kein Konto gibt
  for (const e of emails) if (!rows.some((u) => u.email === e)) result.skipped.push({ email: e, reason: 'kein Konto gefunden' });
  for (const user of rows) {
    if (user.id === admin.id) {
      result.skipped.push({ email: user.email, reason: 'dein eigenes Konto' });
      continue;
    }
    if (isAdmin(user)) {
      result.skipped.push({ email: user.email, reason: adminEmails.has(user.email.toLowerCase()) ? 'Admin über ADMIN_EMAILS' : 'Admin – erst Admin-Rechte entfernen' });
      continue;
    }
    try {
      const r = await deleteAccount(user, { admin }, ip);
      result.deleted++;
      result.servers += r.servers;
    } catch (err) {
      result.skipped.push({ email: user.email, reason: err instanceof ApiError ? err.message : 'Fehler beim Löschen' });
    }
  }
  return result;
}

/**
 * „Alle Treffer löschen“: löscht bis zu `limit` Konten, die zu Suche/Filter passen (ohne Admins und dich selbst).
 * Die Website ruft das in Runden auf, bis nichts mehr übrig ist – so gibt es eine Fortschrittsanzeige und keine Zeitüberschreitung.
 */
export async function deleteMatchingUsers(
  admin: User,
  filter: { q?: string; status?: string },
  limit: number,
  ip?: string,
): Promise<{ deleted: number; servers: number; skipped: { email: string; reason: string }[]; remaining: number }> {
  const conds = [...userConds(filter), sql`not (${adminCond()})`, ne(users.id, admin.id)];
  const batch = await db
    .select({ id: users.id })
    .from(users)
    .where(and(...conds))
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(Math.max(1, Math.min(200, limit)));
  const res = await deleteUsersAdmin(admin, { ids: batch.map((b) => b.id) }, ip);
  const [left] = await db.select({ n: count() }).from(users).where(and(...conds));
  return { ...res, remaining: Number(left?.n ?? 0) };
}

export async function userAction(admin: User, id: string, action: UserAction, ip?: string): Promise<void> {
  const user = await getUserById(id);
  if (user.id === admin.id && (action === 'lock' || action === 'remove-admin')) {
    throw Errors.badRequest('self', L('Das geht nicht mit deinem eigenen Konto.', 'You cannot do this with your own account.'));
  }
  const log = (act: string, message: string) => audit({ userId: user.id, actor: 'admin', action: act, message: `${message} (durch ${admin.email})`, ip });
  switch (action) {
    case 'lock':
      await db.update(users).set({ status: 'locked', panelDeadlineAt: null }).where(eq(users.id, id));
      await destroyAllSessions(id);
      await log('admin.user_locked', `Konto ${user.email} gesperrt`);
      return;
    case 'unlock':
      // Ein Ban (Verwarnungs-System) wird vollständig aufgehoben: Sperrliste, Server, Löschfrist
      if (user.bannedAt) return liftBan(admin, id, ip);
      await db.update(users).set({ status: 'active', panelDeadlineAt: null }).where(eq(users.id, id));
      await log('admin.user_unlocked', `Konto ${user.email} entsperrt`);
      return;
    case 'make-admin':
      await db.update(users).set({ role: 'admin' }).where(eq(users.id, id));
      await log('admin.role_changed', `${user.email} ist jetzt Admin`);
      return;
    case 'remove-admin':
      await db.update(users).set({ role: 'user' }).where(eq(users.id, id));
      await log('admin.role_changed', `${user.email} ist kein Admin mehr`);
      return;
    case 'reset-two-factor':
      // z. B. Handy verloren oder Passwort vergessen – danach genügt wieder der Code aus der E-Mail
      await resetSecondFactor(user.id, admin, ip);
      return;
    case 'grant-partner':
      // Partner kann nur werden, wer seine E-Mail-Adresse bestätigt hat
      if (!user.emailVerifiedAt) {
        throw Errors.conflict('email_not_verified', L('Partner kann nur ein Konto mit bestätigter E-Mail-Adresse werden. Der Nutzer bestätigt sie unter „Meine Server“.', 'Only an account with a confirmed email address can become a partner.'));
      }
      await db.update(users).set({ partner: true }).where(eq(users.id, id));
      await log('admin.partner_granted', `${user.email} ist jetzt Partner (sieht die Partner-Dokumentation)`);
      return;
    case 'revoke-partner':
      await db.update(users).set({ partner: false }).where(eq(users.id, id));
      await log('admin.partner_revoked', `Partner-Status von ${user.email} entzogen`);
      return;
    case 'grant-beta':
      await db.update(users).set({ beta: true }).where(eq(users.id, id));
      await log('admin.beta_granted', `${user.email} hat jetzt Beta-Zugang`);
      return;
    case 'revoke-beta':
      // Wirkt sofort: Die Beta-Instanz prüft die Freigabe bei jeder Anfrage
      await db.update(users).set({ beta: false }).where(eq(users.id, id));
      await log('admin.beta_revoked', `Beta-Zugang von ${user.email} entzogen`);
      return;
  }
}

/** Testmail aus dem Admin-Bereich */
export async function sendTestMail(to: string): Promise<void> {
  const mail = notificationMail(
    'Testmail von CraftingHosting.free',
    'Wenn du diese E-Mail liest, funktioniert der Versand.',
    { label: 'craftinghosting.free', url: env.APP_URL },
    'de',
  );
  await sendMail(to, mail);
}

/* ------------------------------------------------------------------ Warteliste */

/** Vormerkungs-Blöcke außerhalb der Website mit den Plätzen (von–bis), die sie gerade belegen */
export async function listExternalBlocks(): Promise<AdminWaitlistBlockDTO[]> {
  const s = await getSettings();
  const blocks = s.waitlist.blocks;
  return Promise.all(
    blocks.map(async (b, i) => {
      const after = b.after ?? 0;
      const [row] = await db
        .select({ n: count() })
        .from(servers)
        .where(and(isNotNull(servers.waitlistPosition), ne(servers.status, 'deleted'), lte(servers.waitlistPosition, after)));
      const earlier = blocks.reduce((sum, o, j) => (o.after !== null && (o.after < after || (o.after === after && j < i)) ? sum + o.count : sum), 0);
      const fromRank = Number(row?.n ?? 0) + earlier + 1;
      return { after, count: b.count, at: b.at, fromRank, toRank: fromRank + b.count - 1 };
    }),
  );
}

/**
 * Warteliste seitenweise (50 pro Seite) – mit den Vormerkungs-Blöcken, die auf diese Seite fallen:
 * Ein Block steht vor dem ersten Eintrag, dessen Position hinter dem Block liegt.
 */
export async function listWaitlistPage(page = 1): Promise<{ entries: AdminWaitlistDTO[]; blocks: AdminWaitlistBlockDTO[] } & PageInfo> {
  const [totalRow] = await db.select({ n: count() }).from(servers).where(eq(servers.status, 'waitlist'));
  const { offset, ...info } = paging(page, Number(totalRow?.n ?? 0));
  const order = [sql`${servers.waitlistPosition} is null`, asc(servers.waitlistPosition), asc(servers.createdAt), asc(servers.id)];
  const [entries, prev, allBlocks] = await Promise.all([
    listWaitlist({ offset, limit: ADMIN_PAGE_SIZE }),
    offset > 0
      ? db.select({ p: servers.waitlistPosition }).from(servers).where(eq(servers.status, 'waitlist')).orderBy(...order).limit(1).offset(offset - 1)
      : Promise.resolve([] as { p: number | null }[]),
    listExternalBlocks(),
  ]);
  const INF = Number.POSITIVE_INFINITY;
  const low = offset > 0 ? (prev[0]?.p ?? INF) : -INF;
  const last = entries.at(-1);
  const high = last ? (last.position ?? INF) : INF;
  const isLast = info.page === info.pages;
  const blocks = allBlocks.filter((b) => b.after >= low && (b.after < high || isLast));
  return { entries, blocks, ...info };
}

export async function listWaitlist(opts: { offset?: number; limit?: number } = {}): Promise<AdminWaitlistDTO[]> {
  const settings = await getSettings();
  const rows = await db
    .select({ s: servers, email: users.email, locale: users.locale, ptero: users.pteroUserId })
    .from(servers)
    .innerJoin(users, eq(users.id, servers.userId))
    .where(eq(servers.status, 'waitlist'))
    .orderBy(sql`${servers.waitlistPosition} is null`, asc(servers.waitlistPosition), asc(servers.createdAt), asc(servers.id))
    .limit(opts.limit ?? ADMIN_PAGE_SIZE)
    .offset(opts.offset ?? 0);
  return Promise.all(
    rows.map(async ({ s, email, locale, ptero }) => {
      const rank = s.waitlistPosition != null ? await waitlistRank(s.waitlistPosition) : null;
      return {
        id: s.id,
        name: s.name,
        email,
        locale,
        kind: s.kind,
        planId: s.planId,
        serverType: s.serverType,
        version: s.version,
        position: s.waitlistPosition,
        rank,
        tier: rank ? tierForPosition(rank, websiteEpycSlots(settings.waitlist)) : null,
        panelLinked: !!ptero,
        joinedAt: iso(s.waitlistJoinedAt),
        createdAt: s.createdAt.toISOString(),
      };
    }),
  );
}

/* ------------------------------------------------------------------ Statusseite */

export async function listIncidents(): Promise<StatusIncidentDTO[]> {
  const rows = await db.select().from(statusIncidents).orderBy(desc(statusIncidents.startsAt)).limit(100);
  const now = new Date();
  return rows.map((r) => toIncidentDTO(r, now));
}

function incidentValues(input: AdminIncidentInput) {
  return {
    kind: input.kind,
    impact: input.impact,
    components: input.components,
    titleEn: (input.title.en || input.title.de).trim(),
    titleDe: (input.title.de || input.title.en).trim(),
    messageEn: (input.message.en || input.message.de).trim(),
    messageDe: (input.message.de || input.message.en).trim(),
    startsAt: input.startsAt ? new Date(input.startsAt) : new Date(),
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
  };
}

export async function createIncident(admin: User, input: AdminIncidentInput, ip?: string): Promise<void> {
  const id = uuid();
  await db.insert(statusIncidents).values({ id, ...incidentValues(input) });
  await audit({ actor: 'admin', action: 'status.incident_created', message: `Statusmeldung „${input.title.de || input.title.en}“ angelegt (durch ${admin.email})`, ip });
}

export async function updateIncident(admin: User, id: string, input: AdminIncidentInput, ip?: string): Promise<void> {
  const res = await db.update(statusIncidents).set(incidentValues(input)).where(eq(statusIncidents.id, id));
  if (affectedRows(res) !== 1) throw Errors.notFound();
  await audit({ actor: 'admin', action: 'status.incident_updated', message: `Statusmeldung „${input.title.de || input.title.en}“ geändert (durch ${admin.email})`, ip });
}

export async function resolveIncident(admin: User, id: string, ip?: string): Promise<void> {
  await db.update(statusIncidents).set({ resolvedAt: new Date() }).where(eq(statusIncidents.id, id));
  await audit({ actor: 'admin', action: 'status.incident_resolved', message: `Statusmeldung als erledigt markiert (durch ${admin.email})`, ip });
}

export async function deleteIncident(admin: User, id: string, ip?: string): Promise<void> {
  await db.delete(statusIncidents).where(eq(statusIncidents.id, id));
  await audit({ actor: 'admin', action: 'status.incident_deleted', message: `Statusmeldung gelöscht (durch ${admin.email})`, ip });
}

/* ------------------------------------------------------------ Slots eines Pakets auf bestehende Server übertragen */

export interface ApplySlotsResult {
  /** Server mit diesem Paket, die es im Panel gibt */
  total: number;
  updated: number;
  failed: number;
  /** Erster Fehler (falls etwas fehlschlug) */
  error: string | null;
}

/**
 * Überträgt die gespeicherten Slots eines Pakets (Backups, Datenbanken, Ports) auf alle bestehenden Server mit
 * diesem Paket. Arbeitsspeicher, CPU und Speicherplatz bleiben unverändert – geändert werden nur die Slots.
 * Bekommt ein Server dadurch erstmals Backup-Slots, wird auch der automatische Backup-Zeitplan angelegt.
 */
export async function applyPlanSlots(admin: User, planId: string, ip?: string): Promise<ApplySlotsResult> {
  const plan = findPlan(await getSettings(), planId);
  if (!plan) throw Errors.notFound();
  const limits = { databases: plan.databases, allocations: plan.allocations, backups: plan.backups };
  const rows = await db
    .select()
    .from(servers)
    .where(and(eq(servers.planId, planId), isNotNull(servers.pteroServerId), inArray(servers.status, ['active', 'expiring', 'suspended'])));
  const ptero = pterodactyl();
  const result: ApplySlotsResult = { total: rows.length, updated: 0, failed: 0, error: null };
  await mapLimit(rows, 4, async (server) => {
    try {
      await ptero.updateServerFeatureLimits(server.pteroServerId!, limits);
      result.updated++;
      // Erstmals Backup-Slots: Zeitplan nachholen (wie bei einem neuen Server)
      if (pterodactylConfig.backupSchedule.enabled && plan.backups > 0 && !server.backupScheduleId && server.postProvisionDone && server.pteroIdentifier && server.status !== 'suspended') {
        const scheduleId = await ptero.createBackupSchedule(server.pteroIdentifier, pterodactylConfig.backupSchedule).catch(() => null);
        if (scheduleId) await db.update(servers).set({ backupScheduleId: scheduleId }).where(eq(servers.id, server.id));
      }
    } catch (err) {
      result.failed++;
      result.error ??= `${server.name}: ${(err as Error).message}`.slice(0, 300);
    }
  });
  await audit({
    actor: 'admin',
    action: 'admin.plan_slots_applied',
    message: `Slots des Pakets „${plan.name}“ auf bestehende Server übertragen (${limits.backups} Backups, ${limits.databases} Datenbanken, ${limits.allocations} Ports): ${result.updated} geändert, ${result.failed} fehlgeschlagen (durch ${admin.email})`,
    ip,
  });
  return result;
}
