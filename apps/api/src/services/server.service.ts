import { and, count, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import {
  cycleEndFor,
  deleteAt as deleteAtFor,
  formatDateTime,
  tierForPosition,
  websiteEpycSlots,
  type WaitlistInfo,
  findPlan,
  freeHostingConfig,
  versionsFor,
  getServerType,
  type ProductKind,
  reactivationBlockMessages,
  type Locale,
  type ServerDTO,
} from '@chfree/shared';
import { affectedRows, db, writeTx } from '../db/client';
import { servers, users, type Server, type User } from '../db/schema';
import { discordGate } from '../discord/service';
import { uuid } from '../lib/crypto';
import { ApiError, Errors, L } from '../lib/errors';
import { pterodactyl } from '../pterodactyl';
import { audit } from './audit.service';
import { notify } from './notification.service';
import { panelServerUrl, trySyncPanelDescription } from './panel';
import { closeOpenSession } from './power-state';
import { provisionServer } from './provisioning.service';
import { computeRuntimeState, loadWeekSessions } from './runtime';
import { capacityState, getSettings, serverTypeAvailable, waitlistRank } from './settings.service';
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
  const settings = await getSettings();
  const fairUseEnabled = settings.products[server.kind].fairUse;
  const sessions = await loadWeekSessions(server.id, now);
  const state = computeRuntimeState(server, user, sessions, now, fairUseEnabled);
  const plan = findPlan(settings, server.planId);
  const type = getServerType(server.serverType);
  return {
    id: server.id,
    name: server.name,
    kind: server.kind,
    fairUseEnabled,
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

/** Server eines Nutzers, die gegen das Limit zählen – das Limit gilt je Produkt (Minecraft / Discord-Bot) */
export async function countOwnedServers(userId: string, kind?: ProductKind): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(servers)
    .where(and(eq(servers.userId, userId), inArray(servers.status, [...OWNED_STATUSES]), kind ? eq(servers.kind, kind) : undefined));
  return row?.n ?? 0;
}

/* ------------------------------------------------------------ Verfügbarkeit */

export async function getAvailability() {
  const settings = await getSettings();
  return {
    // Pakete, Kapazität und außerhalb belegte Plätze kommen aus dem Admin-Bereich
    plans: (await capacityState(settings)).plans,
    serverTypes: freeHostingConfig.serverTypes.map((t) => ({ id: t.id, available: serverTypeAvailable(t.id, settings) })),
  };
}

/** Prüft Paket (existiert, aktiv, passt zum Servertyp), Egg und – außer bei `ignoreCapacity` – freie Plätze. */
export async function assertConfigAvailable(input: ServerConfigInput, opts: { ignoreCapacity?: boolean } = {}) {
  const settings = await getSettings();
  const plan = findPlan(settings, input.planId);
  const type = getServerType(input.serverType);
  if (!plan || !plan.enabled) {
    throw Errors.badRequest('plan_unknown', L('Dieses Paket gibt es nicht (mehr). Bitte wähle ein anderes.', 'This plan does not exist (any more). Please choose another one.'), {
      planId: L('Dieses Paket gibt es nicht (mehr).', 'This plan does not exist (any more).'),
    });
  }
  if (!type || type.kind !== plan.kind) {
    throw Errors.badRequest('plan_type_mismatch', L('Dieses Paket passt nicht zum gewählten Servertyp.', 'This plan does not match the selected server type.'), {
      serverType: L('Dieses Paket passt nicht zum gewählten Servertyp.', 'This plan does not match the selected server type.'),
    });
  }
  if (!settings.products[plan.kind].enabled) {
    throw Errors.conflict('product_disabled', L('Dieses Angebot ist aktuell nicht verfügbar.', 'This offer is currently not available.'));
  }
  if (!serverTypeAvailable(input.serverType, settings)) {
    throw Errors.badRequest('server_type_unavailable', L('Dieser Servertyp ist aktuell nicht verfügbar.', 'This server type is currently not available.'), {
      serverType: L('Dieser Servertyp ist aktuell nicht verfügbar.', 'This server type is currently not available.'),
    });
  }
  // Versionslisten sind im Admin-Bereich pflegbar
  if (type.kind === 'minecraft' && !versionsFor(settings, type.id).includes(input.version)) {
    const msg = L('Diese Version ist für den Servertyp nicht verfügbar.', 'This version is not available for the selected server type.');
    throw Errors.badRequest('version_unavailable', msg, { version: msg });
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
  const plan = findPlan(await getSettings(), input.planId);
  if (!plan) throw Errors.badRequest('plan_unknown', L('Dieses Paket gibt es nicht (mehr).', 'This plan does not exist (any more).'));
  const now = new Date();
  const id = uuid();
  await writeTx(async (tx) => {
    await tx.delete(servers).where(and(eq(servers.userId, userId), eq(servers.status, 'pending')));
    // Unbestätigte Wartelisten-Anfragen (noch ohne Platz) werden ebenfalls ersetzt
    await tx.delete(servers).where(and(eq(servers.userId, userId), eq(servers.status, 'waitlist'), isNull(servers.waitlistPosition)));
    await tx.insert(servers).values({
      id,
      userId,
      name: input.name,
      kind: plan.kind,
      planId: plan.id,
      serverType: input.serverType,
      version: input.version,
      status,
      memoryMb: plan.memoryMb,
      cpuPercent: plan.cpuPercent,
      diskMb: plan.diskMb,
      cycleNumber: 1,
      cycleStartedAt: now,
      cycleEndsAt: cycleEndFor(plan.kind, now, cycleRules),
    });
  });
  return id;
}

/**
 * Wandelt offene Anfragen in echte Server um – sobald E-Mail bestätigt und
 * Panel-Konto verknüpft ist. Das Server-Limit wird in einer Schreib-Transaktion geprüft (Schreiber sind serialisiert).
 */
export async function activatePendingServers(user: User, ip?: string): Promise<string[]> {
  if (!user.emailVerifiedAt || !user.pteroUserId) return [];
  // Discord-Pflicht: Die Anfrage bleibt offen, bis das Konto verknüpft und der Nutzer Mitglied des Discord-Servers ist
  if (!(await discordGate(user)).ok) return [];
  const activated: string[] = [];
  const max = await maxServersPerUser();
  await writeTx(async (tx) => {
    const pending = await tx
      .select()
      .from(servers)
      .where(and(eq(servers.userId, user.id), eq(servers.status, 'pending')))
      .orderBy(desc(servers.createdAt));
    const ownedRows = await tx
      .select({ kind: servers.kind, n: count() })
      .from(servers)
      .where(and(eq(servers.userId, user.id), inArray(servers.status, [...OWNED_STATUSES])))
      .groupBy(servers.kind);
    // Das Limit gilt je Produkt: z. B. ein Minecraft-Server UND ein Discord-Bot
    const slotsLeft: Record<string, number> = {};
    for (const kind of ['minecraft', 'discord'] as const) slotsLeft[kind] = Math.max(0, max - Number(ownedRows.find((r) => r.kind === kind)?.n ?? 0));
    const now = new Date();
    for (const p of pending) {
      if ((slotsLeft[p.kind] ?? 0) > 0) {
        await tx
          .update(servers)
          .set({ status: 'provisioning', cycleStartedAt: now, cycleEndsAt: cycleEndFor(p.kind, now, cycleRules) })
          .where(and(eq(servers.id, p.id), eq(servers.status, 'pending')));
        activated.push(p.id);
        slotsLeft[p.kind]!--;
      } else {
        await tx.delete(servers).where(and(eq(servers.id, p.id), eq(servers.status, 'pending')));
      }
    }
  });
  const settings = await getSettings();
  for (const id of activated) {
    const [s] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    await audit({
      userId: user.id,
      serverId: id,
      actor: 'user',
      action: 'server.create',
      message: `Server „${s?.name}“ wird erstellt (${findPlan(settings, s?.planId ?? '')?.name ?? s?.planId}, ${s?.serverType} ${s?.version})`,
      ip,
    });
    // Direkt anlegen – schlägt das fehl, übernimmt der Worker die Wiederholung.
    await provisionServer(id, 'user', ip);
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
      ? L(
          'Du hast davon bereits einen kostenlosen Server. Pro Account ist aktuell ein Minecraft-Server und ein Discord-Bot möglich.',
          'You already have a free server of this kind. One Minecraft server and one Discord bot per account are currently possible.',
        )
      : L(
          `Du hast davon bereits ${max} kostenlose Server – mehr sind pro Account und Produkt aktuell nicht möglich.`,
          `You already have ${max} free servers of this kind – that is the current maximum per account and product.`,
        ),
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
  const kind = findPlan(settings, input.planId)?.kind ?? 'minecraft';
  if ((await countOwnedServers(user.id, kind)) >= max) throw serverLimitReached(max);
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
  const gate = await discordGate(user);
  if (!gate.ok) {
    throw Errors.conflict(
      'discord_required',
      gate.reason === 'unavailable'
        ? L('Die Discord-Mitgliedschaft lässt sich gerade nicht prüfen. Bitte versuche es gleich noch einmal.', 'Your Discord membership cannot be checked right now. Please try again shortly.')
        : L('Zum Reaktivieren musst du dein Discord-Konto verknüpfen und Mitglied auf unserem Discord-Server sein.', 'To reactivate, you need to link your Discord account and be a member of our Discord server.'),
    );
  }
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
      cycleEndsAt: cycleEndFor(server.kind, now, cycleRules),
      reactivationCount: server.reactivationCount + 1,
      lastReactivatedAt: now,
      // Die Offline-Zeit zählt ab jetzt neu – sonst würde ein inaktiver Bot sofort wieder freigegeben
      powerStateAt: now,
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
