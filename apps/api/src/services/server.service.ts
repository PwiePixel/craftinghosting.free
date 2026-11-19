import { identityConfirmed, identityConfirmedSql } from './identity';
import { and, count, desc, eq, inArray, isNull, ne, isNotNull } from 'drizzle-orm';
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
  describeServerLimits,
  serverLimitBlock,
  type OwnedServerRef,
  type PendingReason,
  type ServerLimitBlock,
  type ServerLimits,
} from '@chfree/shared';
import { affectedRows, db, writeTx } from '../db/client';
import { servers, users, type Server, type User } from '../db/schema';
import { hadBoostRewards } from '../discord/boost-rewards';
import { abuseReasonTitle } from './abuse-reasons';
import { bonusSlotsFor } from '../discord/rewards';
import { discordConfig, discordGate, syncCustomerRoleSoon } from '../discord/service';
import { uuid } from '../lib/crypto';
import { ApiError, Errors, L } from '../lib/errors';
import { pterodactylConfig } from '../config/pterodactyl.config';
import { offeredVersions } from './software-directory';
import { softwareGaveUp } from './partner-software.service';
import { assertNoTimeout, inTimeout } from './sanction-gate';
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
    pendingDeadlineAt: server.status === 'pending' && server.pendingDeadlineAt ? server.pendingDeadlineAt.toISOString() : null,
    abuse: server.abuseAt ? { at: server.abuseAt.toISOString(), reason: abuseReasonTitle(server.abuseReason), source: server.abuseSource ?? 'system' } : null,
    // Löschen gesperrt, solange ein Abuse-Fall offen ist
    deleteLocked: !!server.abuseAt || (server.status === 'suspended' && (server.suspensionReason === 'abuse' || server.suspensionReason === 'warning' || server.suspensionReason === 'ban')),
    suspensionReason: server.suspensionReason,
    // Solange die gewählte Software eingerichtet wird, gilt der Server als „wird installiert“
    powerState: server.softwareJob && !server.softwareJob.error ? 'installing' : server.powerState,
    softwareFailed: !!server.softwareJob?.error,
    softwareGaveUp: softwareGaveUp(server.softwareJob),
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
    upgrade: server.upgradedAt ? { at: server.upgradedAt.toISOString(), note: server.upgradeNote } : null,
    moving: server.transferNodeId !== null,
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
  if (type.kind === 'minecraft' && !(await offeredVersions(settings, type.id)).includes(input.version)) {
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
 * Wandelt offene Anfragen in echte Server um – sobald der Account bestätigt ist (Discord verknüpft oder E-Mail
 * bestätigt) und das Panel-Konto verknüpft ist. Das Server-Limit wird in einer Schreib-Transaktion geprüft (Schreiber sind serialisiert).
 */
export async function activatePendingServers(user: User, ip?: string): Promise<string[]> {
  if (!identityConfirmed(user) || !user.pteroUserId) return [];
  // Verwarnungs-System: Während einer Auszeit (und bei gesperrtem Konto) werden keine offenen Anfragen eingerichtet
  if (inTimeout(user) || user.status !== 'active') return [];
  // Discord-Pflicht: Die Anfrage bleibt offen, bis das Konto verknüpft und der Nutzer Mitglied des Discord-Servers ist
  if (!(await discordGate(user)).ok) return [];
  const activated: string[] = [];
  const limits = (await getSettings()).registration.limits;
  // Zusätzliche Slots aus Belohnungen (Einladungen, Server-Boosts)
  const bonus = await bonusSlotsFor(user);
  await writeTx(async (tx) => {
    const pending = await tx
      .select()
      .from(servers)
      .where(and(eq(servers.userId, user.id), eq(servers.status, 'pending')))
      .orderBy(desc(servers.createdAt));
    // Grenzen je Angebot, zusammen und je Paket – z. B. ein Minecraft-Server UND zwei Discord-Bots
    const owned: OwnedServerRef[] = await tx
      .select({ kind: servers.kind, planId: servers.planId })
      .from(servers)
      .where(and(eq(servers.userId, user.id), inArray(servers.status, [...OWNED_STATUSES])));
    const now = new Date();
    for (const p of pending) {
      if (serverLimitBlock(limits, owned, p.kind, p.planId, bonus) === null) {
        await tx
          .update(servers)
          .set({ status: 'provisioning', cycleStartedAt: now, cycleEndsAt: cycleEndFor(p.kind, now, cycleRules) })
          .where(and(eq(servers.id, p.id), eq(servers.status, 'pending')));
        activated.push(p.id);
        owned.push({ kind: p.kind, planId: p.planId });
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
  // Mit dem ersten Server gibt es auf Discord die Customer-Rolle
  if (activated.length > 0) syncCustomerRoleSoon(user.id);
  return activated;
}

/**
 * Worauf wartet eine offene Anfrage dieses Accounts? `stuck` = alle Voraussetzungen sind erfüllt, der Server
 * wurde aber (noch) nicht erstellt – z. B. weil die Erstellung beim letzten Versuch abgebrochen ist.
 */
export async function pendingReasonFor(user: Pick<User, 'emailVerifiedAt' | 'pteroUserId' | 'discordId'>, opts: { cached?: boolean } = {}): Promise<PendingReason> {
  // Weder Discord verknüpft noch E-Mail bestätigt: Der nächste Schritt ist die Discord-Verbindung
  // (ohne eingerichtete Discord-Anbindung die Bestätigung der E-Mail-Adresse)
  if (!identityConfirmed(user)) return (await discordConfig()).linkReady ? 'discord_not_linked' : 'email';
  if (!user.pteroUserId) return 'panel';
  const gate = await discordGate(user, opts);
  if (!gate.ok) return gate.reason === 'not_linked' ? 'discord_not_linked' : gate.reason === 'not_member' ? 'discord_not_member' : 'discord_unavailable';
  return 'stuck';
}

/**
 * Offene Anfragen von Accounts nachholen, die E-Mail und Panel-Konto längst haben: etwa wenn jemand dem
 * Discord-Server erst später beigetreten ist, Discord bei der Prüfung nicht erreichbar war oder die Erstellung
 * abgebrochen ist. Je Account höchstens alle 10 Minuten (schont das Anfrage-Kontingent bei Discord).
 */
const pendingTried = new Map<string, number>();
export async function retryPendingServers(now = new Date()): Promise<{ accounts: number; created: number }> {
  const rows = await db
    .selectDistinct({ userId: servers.userId })
    .from(servers)
    .innerJoin(users, eq(users.id, servers.userId))
    .where(and(eq(servers.status, 'pending'), identityConfirmedSql(), isNotNull(users.pteroUserId), eq(users.status, 'active')))
    .limit(200);
  if (pendingTried.size > 5000) pendingTried.clear();
  const due = rows.filter((r) => now.getTime() - (pendingTried.get(r.userId) ?? 0) >= 10 * 60_000).slice(0, 20);
  let created = 0;
  for (const { userId } of due) {
    pendingTried.set(userId, now.getTime());
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) continue;
    created += (await activatePendingServers(user).catch(() => [])).length;
  }
  return { accounts: due.length, created };
}

/** Server (ohne offene Anfragen und Wartelisten-Plätze), die auf die Grenzen angerechnet werden */
export async function ownedServerRefs(userId: string): Promise<OwnedServerRef[]> {
  return db
    .select({ kind: servers.kind, planId: servers.planId })
    .from(servers)
    .where(and(eq(servers.userId, userId), inArray(servers.status, [...OWNED_STATUSES])));
}

/** Meldung, warum kein weiterer Server möglich ist – passend zur Grenze, die greift */
export const serverLimitReached = (block: ServerLimitBlock, limits: ServerLimits, kind: ProductKind) => {
  const all = L(describeServerLimits(limits, 'de'), describeServerLimits(limits, 'en'));
  const message =
    block === 'plan'
      ? L(`Dieses Paket hast du bereits – jedes Paket ist pro Account nur einmal möglich. Wähle ein anderes Paket. ${all.de}`, `You already have this plan – each plan can only be used once per account. Please choose another plan. ${all.en}`)
      : block === 'total'
        ? L(`Du hast bereits die maximale Anzahl kostenloser Server (${limits.total}). ${all.de}`, `You already have the maximum number of free servers (${limits.total}). ${all.en}`)
        : kind === 'discord'
          ? L(`Du hast bereits die maximale Anzahl an Discord-Bots. ${all.de}`, `You already have the maximum number of Discord bots. ${all.en}`)
          : L(`Du hast bereits die maximale Anzahl an Minecraft-Servern. ${all.de}`, `You already have the maximum number of Minecraft servers. ${all.en}`);
  return Errors.conflict('server_limit_reached', message);
};

export const registrationClosed = () =>
  Errors.conflict(
    'registration_closed',
    L('Neue Server können gerade nicht angefordert werden. Schau bald wieder vorbei.', 'New servers cannot be requested right now. Please check back soon.'),
  );

export const alreadyOnWaitlist = () =>
  Errors.conflict('already_on_waitlist', L('Du stehst bereits auf der Warteliste.', 'You are already on the waitlist.'));

/** Weiterer Server für angemeldete Nutzer (z. B. nach dem Löschen des alten). */
export async function createServerForUser(user: User, input: ServerConfigInput, ip?: string): Promise<ServerDTO> {
  // Verwarnungs-System: während einer Auszeit keine neuen Server
  assertNoTimeout(user);
  // Konten ohne verknüpftes Discord-Konto (und ohne bestätigte E-Mail-Adresse) können einen Server anfragen – erstellt
  // wird er erst nach dem Verbinden. Bis dahin ist eine offene Anfrage möglich.
  if (!identityConfirmed(user)) {
    const [open] = await db.select({ id: servers.id }).from(servers).where(and(eq(servers.userId, user.id), inArray(servers.status, ['pending', 'waitlist']))).limit(1);
    if (open) {
      throw Errors.conflict(
        'request_open',
        L('Du hast schon eine offene Anfrage. Verbinde zuerst dein Discord-Konto – dann wird dein Server erstellt und du kannst weitere anfragen.', 'You already have an open request. Connect your Discord account first – then your server is created and you can request more.'),
      );
    }
  }
  await assertConfigAvailable(input);
  const settings = await getSettings();
  if (settings.registration.mode === 'closed') throw registrationClosed();
  const limits = settings.registration.limits;
  const kind = findPlan(settings, input.planId)?.kind ?? 'minecraft';
  const block = serverLimitBlock(limits, await ownedServerRefs(user.id), kind, input.planId, await bonusSlotsFor(user));
  if (block) throw serverLimitReached(block, limits, kind);
  if (settings.registration.mode === 'preregistration') {
    // Early Access: angemeldete Nutzer kommen direkt (bestätigt) auf die Warteliste – ein Platz pro Person
    if (await hasWaitlistEntry(user.id)) throw alreadyOnWaitlist();
    if ((await countOwnedServers(user.id)) > 0) throw Errors.conflict('server_limit_reached', L('In der Early-Access-Phase ist ein Platz pro Person möglich – du hast bereits einen Server.', 'During early access one slot per person is possible – you already have a server.'));
    const id = await savePendingServer(user.id, input, 'waitlist');
    await confirmWaitlist(user.id);
    const [entry] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
    return toServerDTO(entry!, user);
  }
  const id = await savePendingServer(user.id, input);
  await audit({ userId: user.id, serverId: id, actor: 'user', action: 'server.requested', message: `Server „${input.name}“ angefragt`, ip });
  if (user.pteroUserId) await activatePendingServers(user, ip);
  const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
  if (!server) throw Errors.conflict('server_limit_reached', L('Du hast bereits einen kostenlosen Server.', 'You already have a free server.'));
  return toServerDTO(server, user);
}

/* ------------------------------------------------------------ Reaktivierung */

export async function reactivateServer(user: User, id: string, ip?: string): Promise<ServerDTO> {
  const server = await getOwnedServer(user, id);
  const now = new Date();
  assertNoTimeout(user, now);
  const gate = await discordGate(user);
  if (!gate.ok) {
    throw Errors.conflict(
      'discord_required',
      gate.reason === 'unavailable'
        ? L('Die Discord-Mitgliedschaft lässt sich gerade nicht prüfen. Bitte versuche es gleich noch einmal.', 'Your Discord membership cannot be checked right now. Please try again shortly.')
        : L('Zum Reaktivieren musst du dein Discord-Konto verknüpfen und Mitglied auf unserem Discord-Server sein.', 'To reactivate, you need to link your Discord account and be a member of our Discord server.'),
    );
  }
  // Server aus einer Boost-Belohnung lassen sich nur verlängern, solange sie in die geltenden Grenzen passen
  // (also solange der Boost läuft). Accounts ohne Boost-Belohnungen sind davon nicht betroffen.
  // Vom Team aufgewertete Server sind ausgenommen – das Upgrade soll nicht an einer Boost-Grenze scheitern.
  if (!server.upgradedAt && (await hadBoostRewards(user.discordId))) {
    const others = (await db.select({ kind: servers.kind, planId: servers.planId }).from(servers).where(and(eq(servers.userId, user.id), ne(servers.id, server.id), inArray(servers.status, [...OWNED_STATUSES])))) as OwnedServerRef[];
    if (serverLimitBlock((await getSettings()).registration.limits, others, server.kind, server.planId, await bonusSlotsFor(user)) !== null) {
      throw Errors.conflict(
        'boost_reward_ended',
        L(
          'Dieser Server gehörte zu einer Boost-Belohnung, die nicht mehr aktiv ist. Verlängern kannst du ihn, sobald du unseren Discord-Server wieder boostest.',
          'This server was part of a boost reward that is no longer active. You can renew it as soon as you boost our Discord server again.',
        ),
      );
    }
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
  assertDeletable(server);
  await hardDeleteServer(server);
  await audit({ userId: user.id, serverId: server.id, actor: 'user', action: 'server.deleted', message: `Server „${server.name}“ gelöscht`, ip });
}

/**
 * Ein Server mit Abuse-Markierung lässt sich vom Nutzer nicht löschen: Der Vorfall soll erst geklärt werden
 * (das Team hebt die Markierung danach im Admin-Bereich auf). Dasselbe gilt für Server, die wegen einer Verwarnung
 * oder eines Bans gesperrt sind.
 */
export function assertDeletable(server: Pick<Server, 'abuseAt' | 'status' | 'suspensionReason'>): void {
  if (server.abuseAt || (server.status === 'suspended' && (server.suspensionReason === 'abuse' || server.suspensionReason === 'warning' || server.suspensionReason === 'ban'))) {
    throw Errors.conflict(
      'abuse_locked',
      L(
        'Zu diesem Server liegt eine Abuse-Meldung vor. Er lässt sich erst löschen, wenn das geklärt ist – öffne dazu bitte ein Ticket auf unserem Discord-Server.',
        'There is an abuse report for this server. It can only be deleted once this has been resolved – please open a ticket on our Discord server.',
      ),
    );
  }
}

export async function hardDeleteServer(server: Server): Promise<void> {
  let pteroServerId = server.pteroServerId;
  if (!pteroServerId && (server.status === 'provisioning' || server.status === 'provisioning_failed')) {
    // Noch keine Panel-ID bei uns eingetragen, obwohl die Einrichtung lief oder fehlgeschlagen ist: im Panel nachsehen,
    // damit dort kein Server ohne Eintrag bei uns zurückbleibt. Lässt sich das gerade nicht klären, wird NICHT gelöscht.
    try {
      pteroServerId = (await pterodactyl().findServerByExternalId(`${pterodactylConfig.externalIdPrefix.server}${server.id}`))?.id ?? null;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(503, 'panel_unavailable', L('Der Server konnte im Panel nicht gelöscht werden. Bitte versuche es später erneut.', 'The server could not be deleted in the panel. Please try again later.'));
    }
  }
  if (pteroServerId) {
    try {
      await pterodactyl().deleteServer(pteroServerId);
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
  // War es der letzte Server, entfällt die Customer-Rolle
  syncCustomerRoleSoon(server.userId);
}
