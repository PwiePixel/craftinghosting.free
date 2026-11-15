import { and, count, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import {
  cycleEndFrom,
  deleteAt as deleteAtFor,
  formatDateTime,
  tierForPosition,
  websiteEpycSlots,
  type WaitlistInfo,
  freeHostingConfig,
  getPlan,
  getServerType,
  reactivationBlockMessages,
  type Locale,
  type ServerDTO,
} from '@chfree/shared';
import { getEggMapping } from '../config/pterodactyl.config';
import { affectedRows, db } from '../db/client';
import { servers, users, type Server, type User } from '../db/schema';
import { uuid } from '../lib/crypto';
import { ApiError, Errors, L } from '../lib/errors';
import { pterodactyl } from '../pterodactyl';
import { audit } from './audit.service';
import { notify } from './notification.service';
import { panelServerUrl, trySyncPanelDescription } from './panel';
import { closeOpenSession } from './power-state';
import { provisionServer } from './provisioning.service';
import { computeRuntimeState, loadWeekSessions } from './runtime';
import { getSettings, planAvailability, waitlistRank } from './settings.service';
import { confirmWaitlist, hasWaitlistEntry } from './waitlist.service';

const { cycle: cycleRules } = freeHostingConfig;
/** Zählen gegen das Server-Limit (pending zählt nicht – das ist nur eine Anfrage). */
const OWNED_STATUSES = ['provisioning', 'provisioning_failed', 'active', 'expiring', 'suspended'] as const;
const VISIBLE_STATUSES = ['waitlist', 'pending', ...OWNED_STATUSES] as const;

export interface ServerConfigInput {
  planId: string;
  serverType: string;
  version: string;
  name: string;
}

export async function toServerDTO(server: Server, user: User, now = new Date()): Promise<ServerDTO> {
  const sessions = await loadWeekSessions(server.id, now);
  const state = computeRuntimeState(server, user, sessions, now);
  const plan = getPlan(server.planId);
  const type = getServerType(server.serverType);
  return {
    id: server.id,
    name: server.name,
    planId: server.planId,
    planName: plan?.name ?? server.planId,
    serverType: server.serverType,
    serverTypeName: type?.name ?? server.serverType,
    version: server.version,
    status: server.status,
    suspensionReason: server.suspensionReason,
    powerState: server.powerState,
    address: server.address,
    limits: { memoryMb: server.memoryMb, cpuPercent: server.cpuPercent, diskMb: server.diskMb },
    cycle: state.cycle,
    fairUse: state.fairUse,
    startGate: state.startGate,
    reactivation: state.reactivation,
    reactivationCount: server.reactivationCount,
    provisioningError: server.status === 'provisioning_failed' ? 'Die Einrichtung ist fehlgeschlagen und wird automatisch erneut versucht.' : null,
    panelUrl: panelServerUrl(server),
    waitlist: await waitlistInfo(server),
    deleteAt:
      server.status === 'suspended' && server.suspensionReason === 'cycle_expired' && server.suspendedAt
        ? (deleteAtFor(server.suspendedAt, cycleRules.reactivationCooldownMinutes, cycleRules.deleteAfterRestHours)?.toISOString() ?? null)
        : null,
    createdAt: server.createdAt.toISOString(),
  };
}

/** Platz und Hardware-Stufe eines bestätigten Wartelisten-Eintrags */
export async function waitlistInfo(server: Pick<Server, 'status' | 'waitlistPosition'>): Promise<WaitlistInfo | null> {
  if (server.status !== 'waitlist' || server.waitlistPosition == null) return null;
  const [rank, settings] = await Promise.all([waitlistRank(server.waitlistPosition), getSettings()]);
  return { position: rank, tier: tierForPosition(rank, websiteEpycSlots(settings.waitlist)) };
}

export async function listServers(user: User): Promise<ServerDTO[]> {
  const rows = await db
    .select()
    .from(servers)
    .where(and(eq(servers.userId, user.id), inArray(servers.status, [...VISIBLE_STATUSES])))
    .orderBy(desc(servers.createdAt));
  const now = new Date();
  return Promise.all(rows.map((s) => toServerDTO(s, user, now)));
}

export async function getOwnedServer(user: User, id: string): Promise<Server> {
  const [server] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, id), eq(servers.userId, user.id), ne(servers.status, 'deleted')))
    .limit(1);
  if (!server) throw Errors.notFound(L('Server nicht gefunden.', 'Server not found.'));
  return server;
}

export async function countOwnedServers(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(servers)
    .where(and(eq(servers.userId, userId), inArray(servers.status, [...OWNED_STATUSES])));
  return row?.n ?? 0;
}

/* ------------------------------------------------------------ Verfügbarkeit */

export async function getAvailability() {
  return {
    // Kapazität und außerhalb belegte Plätze kommen aus dem Admin-Bereich
    plans: await planAvailability(),
    serverTypes: freeHostingConfig.serverTypes.map((t) => ({ id: t.id, available: getEggMapping(t.id) !== null })),
  };
}

export async function assertConfigAvailable(input: ServerConfigInput, opts: { ignoreCapacity?: boolean } = {}) {
  if (!getEggMapping(input.serverType)) {
    throw Errors.badRequest('server_type_unavailable', L('Dieser Servertyp ist aktuell nicht verfügbar.', 'This server type is currently not available.'), {
      serverType: L('Dieser Servertyp ist aktuell nicht verfügbar.', 'This server type is currently not available.'),
    });
  }
  if (opts.ignoreCapacity) return;
  const availability = await getAvailability();
  if (!availability.plans.find((p) => p.id === input.planId)?.available) {
    throw Errors.conflict(
      'plan_capacity_reached',
      L('Für dieses Paket sind aktuell keine freien Plätze verfügbar. Bitte versuche es später erneut.', 'There are currently no free slots for this plan. Please try again later.'),
    );
  }
}

/* ------------------------------------------------------------ Anfrage & Erstellung */

/**
 * Speichert eine Server-Anfrage (Status "pending"). Frühere offene Anfragen
 * desselben Nutzers werden ersetzt – es zählt immer die letzte.
 */
export async function savePendingServer(userId: string, input: ServerConfigInput, status: 'pending' | 'waitlist' = 'pending'): Promise<string> {
  const plan = getPlan(input.planId)!;
  const now = new Date();
  const id = uuid();
  await db.transaction(async (tx) => {
    await tx.delete(servers).where(and(eq(servers.userId, userId), eq(servers.status, 'pending')));
    // Unbestätigte Wartelisten-Anfragen (noch ohne Platz) werden ebenfalls ersetzt
    await tx.delete(servers).where(and(eq(servers.userId, userId), eq(servers.status, 'waitlist'), isNull(servers.waitlistPosition)));
    await tx.insert(servers).values({
      id,
      userId,
      name: input.name,
      planId: plan.id,
      serverType: input.serverType,
      version: input.version,
      status,
      memoryMb: plan.memoryMb,
      cpuPercent: plan.cpuPercent,
      diskMb: plan.diskMb,
      cycleNumber: 1,
      cycleStartedAt: now,
      cycleEndsAt: cycleEndFrom(now, cycleRules),
    });
  });
  return id;
}

/**
 * Wandelt offene Anfragen in echte Server um – sobald E-Mail bestätigt und
 * Panel-Konto verknüpft ist. Das Server-Limit wird per Zeilensperre geprüft.
 */
export async function activatePendingServers(user: User, ip?: string): Promise<string[]> {
  if (!user.emailVerifiedAt || !user.pteroUserId) return [];
  const activated: string[] = [];
  await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for('update');
    const pending = await tx
      .select()
      .from(servers)
      .where(and(eq(servers.userId, user.id), eq(servers.status, 'pending')))
      .orderBy(desc(servers.createdAt));
    const [{ n: owned } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(servers)
      .where(and(eq(servers.userId, user.id), inArray(servers.status, [...OWNED_STATUSES])));
    let slots = Math.max(0, (await maxServersPerUser()) - owned);
    const now = new Date();
    for (const p of pending) {
      if (slots > 0) {
        await tx
          .update(servers)
          .set({ status: 'provisioning', cycleStartedAt: now, cycleEndsAt: cycleEndFrom(now, cycleRules) })
          .where(and(eq(servers.id, p.id), eq(servers.status, 'pending')));
        activated.push(p.id);
        slots--;
      } else {
        await tx.delete(servers).where(and(eq(servers.id, p.id), eq(servers.status, 'pending')));
      }
    }
  });
  for (const id of activated) {
    const [s] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    await audit({
      userId: user.id,
      serverId: id,
      actor: 'user',
      action: 'server.create',
      message: `Server „${s?.name}“ wird erstellt (${getPlan(s?.planId ?? '')?.name ?? s?.planId}, ${s?.serverType} ${s?.version})`,
      ip,
    });
    // Direkt anlegen – schlägt das fehl, übernimmt der Worker die Wiederholung.
    await provisionServer(id, 'user');
  }
  return activated;
}

async function maxServersPerUser(): Promise<number> {
  return (await getSettings()).registration.maxServersPerUser;
}

export const serverLimitReached = (max: number) =>
  Errors.conflict(
    'server_limit_reached',
    max === 1
      ? L('Du hast bereits einen kostenlosen Server. Pro Account ist aktuell ein Free-Server möglich.', 'You already have a free server. One free server per account is currently possible.')
      : L(`Du hast bereits ${max} kostenlose Server – mehr sind pro Account aktuell nicht möglich.`, `You already have ${max} free servers – that is the current maximum per account.`),
  );

export const registrationClosed = () =>
  Errors.conflict(
    'registration_closed',
    L('Neue Server können gerade nicht angefordert werden. Schau bald wieder vorbei.', 'New servers cannot be requested right now. Please check back soon.'),
  );

export const alreadyOnWaitlist = () =>
  Errors.conflict('already_on_waitlist', L('Du stehst bereits auf der Warteliste.', 'You are already on the waitlist.'));

/** Weiterer Server für angemeldete Nutzer (z. B. nach dem Löschen des alten). */
export async function createServerForUser(user: User, input: ServerConfigInput, ip?: string): Promise<ServerDTO> {
  if (!user.emailVerifiedAt) throw Errors.forbidden(L('Bitte bestätige zuerst deine E-Mail-Adresse.', 'Please confirm your email address first.'));
  await assertConfigAvailable(input);
  const settings = await getSettings();
  if (settings.registration.mode === 'closed') throw registrationClosed();
  const max = settings.registration.maxServersPerUser;
  if ((await countOwnedServers(user.id)) >= max) throw serverLimitReached(max);
  if (settings.registration.mode === 'preregistration') {
    // Early Access: angemeldete Nutzer kommen direkt (bestätigt) auf die Warteliste – ein Platz pro Person
    if (await hasWaitlistEntry(user.id)) throw alreadyOnWaitlist();
    if ((await countOwnedServers(user.id)) > 0) throw serverLimitReached(1);
    const id = await savePendingServer(user.id, input, 'waitlist');
    await confirmWaitlist(user.id);
    const [entry] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    return toServerDTO(entry!, user);
  }
  const id = await savePendingServer(user.id, input);
  if (user.pteroUserId) await activatePendingServers(user, ip);
  const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
  if (!server) throw Errors.conflict('server_limit_reached', L('Du hast bereits einen kostenlosen Server.', 'You already have a free server.'));
  return toServerDTO(server, user);
}

/* ------------------------------------------------------------ Reaktivierung */

export async function reactivateServer(user: User, id: string, ip?: string): Promise<ServerDTO> {
  const server = await getOwnedServer(user, id);
  const now = new Date();
  const state = computeRuntimeState(server, user, [], now);
  if (!state.reactivation.allowed) {
    const reason = state.reactivation.reason ?? 'not_suspended';
    const until = state.reactivation.until;
    const message =
      reason === 'cooldown' && until
        ? (l: Locale) =>
            l === 'en'
              ? `A rest period applies after the ${freeHostingConfig.cycle.days} days. You can reactivate from ${formatDateTime(until, freeHostingConfig.fairUse.timezone, l)}.`
              : `Nach Ablauf der ${freeHostingConfig.cycle.days} Tage gilt eine Ruhezeit. Reaktivieren kannst du ab ${formatDateTime(until, freeHostingConfig.fairUse.timezone, l)}.`
        : reactivationBlockMessages[reason];
    throw Errors.conflict(reason, message);
  }

  // Datenbank ist die Quelle der Wahrheit – erst Status umstellen (atomar),
  // dann in Pterodactyl entsperren. Schlägt das fehl, gleicht der Worker ab.
  const res = await db
    .update(servers)
    .set({
      status: 'active',
      suspensionReason: null,
      suspendedAt: null,
      expiringSince: null,
      pausedUntil: null,
      pauseReason: null,
      pausedAt: null,
      cycleNumber: server.cycleNumber + 1,
      cycleStartedAt: now,
      cycleEndsAt: cycleEndFrom(now, cycleRules),
      reactivationCount: server.reactivationCount + 1,
      lastReactivatedAt: now,
    })
    .where(and(eq(servers.id, server.id), eq(servers.status, 'suspended'), eq(servers.suspensionReason, 'cycle_expired')));
  if (affectedRows(res) !== 1) throw Errors.conflict('state_changed', L('Der Serverstatus hat sich geändert. Bitte lade die Seite neu.', 'The server status has changed. Please reload the page.'));

  if (server.pteroServerId) {
    try {
      await pterodactyl().unsuspendServer(server.pteroServerId);
    } catch (err) {
      console.error('[reactivate] Entsperren in Pterodactyl fehlgeschlagen – Worker gleicht ab', err);
    }
  }
  await trySyncPanelDescription(server.id);
  await audit({
    userId: user.id,
    serverId: server.id,
    actor: 'user',
    action: 'server.reactivated',
    message: `Server reaktiviert – Zyklus ${server.cycleNumber + 1} gestartet`,
    ip,
  });
  await notify({
    userId: user.id,
    serverId: server.id,
    type: 'server.reactivated',
    title: L('Server reaktiviert', 'Server reactivated'),
    body: L(
      `„${server.name}“ ist wieder aktiv. Ein neuer ${cycleRules.days}-Tage-Zyklus hat begonnen – starte den Server im Panel.`,
      `“${server.name}” is active again. A new ${cycleRules.days}-day cycle has started – start the server in the panel.`,
    ),
    dedupeKey: `server-reactivated:${server.id}:${server.cycleNumber + 1}`,
  });
  const [updated] = await db.select().from(servers).where(eq(servers.id, server.id)).limit(1);
  return toServerDTO(updated!, user);
}

/* ------------------------------------------------------------ Löschen */

export async function deleteServer(user: User, id: string, confirmName: string, ip?: string): Promise<void> {
  const server = await getOwnedServer(user, id);
  if (confirmName.trim() !== server.name) {
    throw Errors.badRequest('confirm_mismatch', L('Der eingegebene Name stimmt nicht überein.', 'The name you entered does not match.'), {
      confirmName: L('Bitte gib den Servernamen exakt ein.', 'Please enter the server name exactly.'),
    });
  }
  if (server.status === 'provisioning') throw Errors.conflict('not_ready', L('Der Server wird gerade eingerichtet. Bitte warte einen Moment.', 'The server is being set up. Please wait a moment.'));
  await hardDeleteServer(server);
  await audit({ userId: user.id, serverId: server.id, actor: 'user', action: 'server.deleted', message: `Server „${server.name}“ gelöscht`, ip });
}

export async function hardDeleteServer(server: Server): Promise<void> {
  if (server.pteroServerId) {
    try {
      await pterodactyl().deleteServer(server.pteroServerId);
    } catch {
      throw new ApiError(
        503,
        'panel_unavailable',
        L('Der Server konnte im Panel nicht gelöscht werden. Bitte versuche es später erneut.', 'The server could not be deleted in the panel. Please try again later.'),
      );
    }
  }
  const now = new Date();
  await closeOpenSession(server.id, now, 'deleted');
  await db.update(servers).set({ status: 'deleted', deletedAt: now, pteroServerId: null }).where(eq(servers.id, server.id));
}
