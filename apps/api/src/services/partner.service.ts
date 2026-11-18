/**
 * Partner-API: Ein Partner (z. B. ein Minecraft-Launcher) erstellt und steuert über einen API-Key Server für seine
 * Nutzer. Alle Server laufen unter dem Konto des Partners; jeder Nutzer des Partners bekommt eine kurze Spieler-ID,
 * die im Servernamen steht.
 *
 * Laufzeit-Regeln (je Partner einstellbar):
 *  – Ein Server läuft nur, solange der Launcher des Hosts sich meldet (Lebenszeichen). Bleibt es aus oder meldet der
 *    Launcher „Stopp“, fährt der Server herunter – die Daten bleiben erhalten.
 *  – Nach `sessionMaxHours` Laufzeit ist eine Pause von `cooldownHours` fällig; danach muss der Server über die API
 *    neu gestartet werden. Unterbrechungen, die kürzer als die Pause sind, setzen die Laufzeit nicht zurück.
 *  – Partner-Server sind vom 30-Tage-Zyklus und vom Fair-Use-System der Website ausgenommen.
 *  – Lange nicht gestartete Server werden nach `deleteAfterIdleDays` Tagen gelöscht.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { and, count, desc, eq, inArray, isNotNull, lt, ne, or, sql } from 'drizzle-orm';
import { NO_CYCLE_END, findPlan, freeHostingConfig, getServerType, versionsFor, type AdminPartnerDTO, type AdminPartnerInput } from '@chfree/shared';
import { db, isUniqueViolation } from '../db/client';
import { partnerPlayers, partnerServers, partners, servers, users, type Partner, type PartnerPlayer, type PartnerServer, type Server } from '../db/schema';
import { env } from '../env';
import { pterodactylConfig } from '../config/pterodactyl.config';
import { sha256, uuid } from '../lib/crypto';
import { ApiError, Errors, L } from '../lib/errors';
import { pterodactyl } from '../pterodactyl';
import { PterodactylError } from '../pterodactyl/types';
import { audit } from './audit.service';
import { provisionServer } from './provisioning.service';
import { hardDeleteServer } from './server.service';
import { getSettings, serverTypeAvailable } from './settings.service';

const LIVE = ['provisioning', 'provisioning_failed', 'active', 'expiring', 'suspended'] as const;
const NAME_MAX = freeHostingConfig.limits.serverNameMaxLength - 10; // Platz für „ #<Spieler-ID>“
const EULA_URL = 'https://www.minecraft.net/eula';

/* ------------------------------------------------------------ Schlüssel und IDs */

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const random = (alphabet: string, length: number) => Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
/** API-Key – im Klartext nur beim Anlegen sichtbar */
const newApiKey = () => `chp_${random(KEY_ALPHABET, 40)}`;
const newPlayerId = () => `P${random(ID_ALPHABET, 7)}`;
const slugOf = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'partner';

/* ------------------------------------------------------------ Verwaltung (Admin-Bereich) */

function assertPlan(planId: string, settings: Awaited<ReturnType<typeof getSettings>>) {
  const plan = findPlan(settings, planId);
  if (!plan || plan.kind !== 'minecraft') {
    const msg = L('Bitte ein Minecraft-Paket wählen.', 'Please choose a Minecraft plan.');
    throw Errors.badRequest('plan_unknown', msg, { planId: msg });
  }
  return plan;
}

export async function listPartners(): Promise<AdminPartnerDTO[]> {
  const rows = await db.select({ p: partners, email: users.email, panel: users.pteroUsername }).from(partners).innerJoin(users, eq(users.id, partners.userId)).orderBy(desc(partners.createdAt));
  const settings = await getSettings();
  const out: AdminPartnerDTO[] = [];
  for (const { p, email, panel } of rows) {
    const [players] = await db.select({ n: count() }).from(partnerPlayers).where(eq(partnerPlayers.partnerId, p.id));
    const [total] = await db.select({ n: count() }).from(servers).where(and(eq(servers.partnerId, p.id), inArray(servers.status, [...LIVE])));
    const [running] = await db.select({ n: count() }).from(partnerServers).where(and(eq(partnerServers.partnerId, p.id), eq(partnerServers.hostActive, true)));
    out.push({
      id: p.id,
      name: p.name,
      accountEmail: email,
      panelUsername: panel,
      keyPrefix: p.keyPrefix,
      enabled: p.enabled,
      planId: p.planId,
      planName: findPlan(settings, p.planId)?.name ?? p.planId,
      maxServers: p.maxServers,
      maxServersPerPlayer: p.maxServersPerPlayer,
      sessionMaxHours: p.sessionMaxHours,
      cooldownHours: p.cooldownHours,
      heartbeatTimeoutSeconds: p.heartbeatTimeoutSeconds,
      deleteAfterIdleDays: p.deleteAfterIdleDays,
      nodeIds: p.nodeIds,
      players: Number(players?.n ?? 0),
      servers: Number(total?.n ?? 0),
      running: Number(running?.n ?? 0),
      lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    });
  }
  return out;
}

/**
 * Partner anlegen: eigenes Konto mit dem Namen des Partners, Panel-Konto dazu und ein API-Key.
 * Der Key steht nur in dieser Antwort im Klartext.
 */
export async function createPartner(admin: { email: string }, input: AdminPartnerInput, ip?: string): Promise<{ id: string; apiKey: string }> {
  const settings = await getSettings();
  assertPlan(input.planId, settings);
  const name = input.name.trim();
  const slug = slugOf(name);
  const suffix = random(ID_ALPHABET, 4).toLowerCase();
  const email = `partner-${slug}-${suffix}@${new URL(env.APP_URL).hostname.replace(/^localhost$/, 'partner.localhost')}`;
  const userId = uuid();
  // Das Konto bekommt nie E-Mails (Adresse ist nur ein Platzhalter) und hat kein Passwort – es dient nur als Besitzer der Server
  await db.insert(users).values({ id: userId, email, acceptedTermsAt: new Date(), locale: 'de', emailUndeliverableAt: new Date() });
  let apiKey: string;
  try {
    const username = `partner-${slug}-${suffix}`.slice(0, 40);
    const panelUser = await pterodactyl().createUser({ externalId: `${pterodactylConfig.externalIdPrefix.user}${userId}`, email, username, firstName: name.slice(0, 60), lastName: 'Partner', password: `${random(KEY_ALPHABET, 28)}!9a` });
    await db.update(users).set({ pteroUserId: panelUser.id, pteroUsername: panelUser.username }).where(eq(users.id, userId));
    apiKey = newApiKey();
    await db.insert(partners).values({ id: uuid(), name, userId, keyHash: sha256(apiKey), keyPrefix: apiKey.slice(0, 10), planId: input.planId, ...limitsOf(input) });
  } catch (err) {
    await db.delete(users).where(eq(users.id, userId));
    if (err instanceof PterodactylError) throw new ApiError(502, 'panel_error', L(`Das Panel-Konto für den Partner konnte nicht angelegt werden: ${err.message}`.slice(0, 300), `The panel account could not be created: ${err.message}`.slice(0, 300)));
    throw err;
  }
  const [row] = await db.select({ id: partners.id }).from(partners).where(eq(partners.userId, userId)).limit(1);
  await audit({ userId, actor: 'admin', action: 'admin.partner_created', message: `Partner „${name}“ mit API-Key angelegt (durch ${admin.email})`, ip });
  return { id: row!.id, apiKey };
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));
function limitsOf(input: AdminPartnerInput) {
  return {
    maxServers: clamp(input.maxServers, 0, 100_000),
    maxServersPerPlayer: clamp(input.maxServersPerPlayer, 1, 20),
    sessionMaxHours: clamp(input.sessionMaxHours, 1, 720),
    cooldownHours: clamp(input.cooldownHours, 0, 168),
    heartbeatTimeoutSeconds: clamp(input.heartbeatTimeoutSeconds, 60, 3600),
    deleteAfterIdleDays: clamp(input.deleteAfterIdleDays, 0, 3650),
    nodeIds: [...new Set(input.nodeIds.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 50),
  };
}

async function partnerById(id: string): Promise<Partner> {
  const [p] = await db.select().from(partners).where(eq(partners.id, id)).limit(1);
  if (!p) throw Errors.notFound(L('Partner nicht gefunden.', 'Partner not found.'));
  return p;
}

export async function updatePartner(admin: { email: string }, id: string, input: AdminPartnerInput & { enabled: boolean }, ip?: string): Promise<void> {
  const p = await partnerById(id);
  assertPlan(input.planId, await getSettings());
  await db.update(partners).set({ name: input.name.trim(), enabled: input.enabled, planId: input.planId, ...limitsOf(input) }).where(eq(partners.id, id));
  await audit({ userId: p.userId, actor: 'admin', action: 'admin.partner_updated', message: `Partner „${p.name}“ geändert${input.enabled !== p.enabled ? (input.enabled ? ' – aktiviert' : ' – deaktiviert') : ''} (durch ${admin.email})`, ip });
}

/** Neuen API-Key ausstellen – der alte gilt sofort nicht mehr */
export async function rotatePartnerKey(admin: { email: string }, id: string, ip?: string): Promise<{ apiKey: string }> {
  const p = await partnerById(id);
  const apiKey = newApiKey();
  await db.update(partners).set({ keyHash: sha256(apiKey), keyPrefix: apiKey.slice(0, 10) }).where(eq(partners.id, id));
  await audit({ userId: p.userId, actor: 'admin', action: 'admin.partner_key_rotated', message: `Neuer API-Key für Partner „${p.name}“ (durch ${admin.email})`, ip });
  return { apiKey };
}

/**
 * Partner löschen – samt aller Server (im Panel und bei uns). Arbeitet in Runden: Solange `remaining` größer
 * als 0 ist, noch einmal aufrufen.
 */
export async function deletePartner(admin: { email: string }, id: string, ip?: string): Promise<{ deleted: boolean; remaining: number }> {
  const p = await partnerById(id);
  await db.update(partners).set({ enabled: false }).where(eq(partners.id, id));
  const batch = await db.select().from(servers).where(and(eq(servers.partnerId, id), ne(servers.status, 'deleted'))).limit(25);
  for (const server of batch) await hardDeleteServer(server);
  const [left] = await db.select({ n: count() }).from(servers).where(and(eq(servers.partnerId, id), ne(servers.status, 'deleted')));
  const remaining = Number(left?.n ?? 0);
  if (remaining > 0) return { deleted: false, remaining };
  // Das Konto des Partners nimmt Partner, Spieler und Sitzungsdaten mit (das Panel-Konto bleibt im Panel bestehen)
  await db.delete(users).where(eq(users.id, p.userId));
  await audit({ actor: 'admin', action: 'admin.partner_deleted', message: `Partner „${p.name}“ samt Servern gelöscht (durch ${admin.email})`, ip });
  return { deleted: true, remaining: 0 };
}

/* ------------------------------------------------------------ Zugang (API-Key) */

const lastUsedNoted = new Map<string, number>();

/** Prüft den API-Key. null = unbekannt oder Partner deaktiviert */
export async function partnerByKey(key: string | undefined): Promise<Partner | null> {
  if (!key || !key.startsWith('chp_') || key.length > 80) return null;
  const [p] = await db.select().from(partners).where(eq(partners.keyHash, sha256(key))).limit(1);
  if (!p || !p.enabled) return null;
  // Letzte Nutzung höchstens einmal pro Minute speichern
  if (Date.now() - (lastUsedNoted.get(p.id) ?? 0) > 60_000) {
    lastUsedNoted.set(p.id, Date.now());
    await db.update(partners).set({ lastUsedAt: new Date() }).where(eq(partners.id, p.id));
  }
  return p;
}

/* ------------------------------------------------------------ Antworten der API */

type LiveState = 'installing' | 'offline' | 'starting' | 'running' | 'stopping' | 'failed' | 'suspended';

export interface PartnerServerDTO {
  id: string;
  name: string;
  player: { id: string; externalId: string; name: string | null };
  /** installing · offline · starting · running · stopping · failed · suspended */
  state: LiveState;
  /** Adresse zum Verbinden (Host:Port) – null, solange der Server noch eingerichtet wird */
  address: string | null;
  serverType: string;
  version: string;
  resources: { memoryMb: number; cpuPercent: number; diskMb: number };
  eulaAccepted: boolean;
  session: {
    /** Der Host hat gestartet und meldet sich */
    active: boolean;
    startedAt: string | null;
    lastHeartbeatAt: string | null;
    /** Ohne Lebenszeichen wird nach so vielen Sekunden gestoppt */
    heartbeatTimeoutSeconds: number;
    /** Angerechnete Laufzeit und Grenze in Sekunden */
    runSeconds: number;
    maxRunSeconds: number;
    remainingSeconds: number;
    /** Pflichtpause bis … (null = keine) */
    cooldownUntil: string | null;
    /** Warum der Server zuletzt gestoppt wurde: host_stopped · host_timeout · session_limit · admin */
    lastStopReason: string | null;
  };
  createdAt: string;
  lastStartAt: string | null;
}

const liveCache = new Map<string, { at: number; state: LiveState }>();

async function liveState(server: Server): Promise<LiveState> {
  if (server.status === 'provisioning') return 'installing';
  if (server.status === 'provisioning_failed') return 'failed';
  if (server.status === 'suspended') return 'suspended';
  if (!server.pteroIdentifier) return 'installing';
  const cached = liveCache.get(server.id);
  if (cached && Date.now() - cached.at < 3_000) return cached.state;
  let state: LiveState;
  try {
    const p = await pterodactyl().getServer(server.pteroServerId!);
    if (p?.status === 'installing') state = 'installing';
    else if (p?.status === 'install_failed') state = 'failed';
    else {
      const r = await pterodactyl().getResources(server.pteroIdentifier);
      state = r.state === 'running' || r.state === 'starting' || r.state === 'stopping' ? r.state : 'offline';
    }
  } catch {
    // Panel gerade nicht erreichbar: der zuletzt bekannte Stand
    const s = server.powerState;
    state = s === 'installing' ? 'installing' : s === 'running' || s === 'starting' || s === 'stopping' ? s : 'offline';
  }
  if (liveCache.size > 5000) liveCache.clear();
  liveCache.set(server.id, { at: Date.now(), state });
  return state;
}

/** Laufzeit einschließlich der noch nicht verbuchten Sekunden */
function runSecondsNow(ps: PartnerServer, now: Date): number {
  return ps.runSeconds + (ps.hostActive && ps.countedAt ? Math.max(0, Math.floor((now.getTime() - ps.countedAt.getTime()) / 1000)) : 0);
}

async function toDTO(partner: Partner, server: Server, ps: PartnerServer, player: PartnerPlayer, now = new Date()): Promise<PartnerServerDTO> {
  const max = partner.sessionMaxHours * 3600;
  const run = Math.min(max, runSecondsNow(ps, now));
  const cooling = ps.cooldownUntil && ps.cooldownUntil > now ? ps.cooldownUntil : null;
  return {
    id: server.id,
    name: server.name,
    player: { id: player.id, externalId: player.externalId, name: player.name },
    state: await liveState(server),
    address: server.address,
    serverType: server.serverType,
    version: server.version,
    resources: { memoryMb: server.memoryMb, cpuPercent: server.cpuPercent, diskMb: server.diskMb },
    eulaAccepted: !!ps.eulaAcceptedAt,
    session: {
      active: ps.hostActive,
      startedAt: ps.hostActive ? (ps.sessionStartedAt?.toISOString() ?? null) : null,
      lastHeartbeatAt: ps.heartbeatAt?.toISOString() ?? null,
      heartbeatTimeoutSeconds: partner.heartbeatTimeoutSeconds,
      runSeconds: run,
      maxRunSeconds: max,
      remainingSeconds: Math.max(0, max - run),
      cooldownUntil: cooling?.toISOString() ?? null,
      lastStopReason: ps.hostActive ? null : ps.stopReason,
    },
    createdAt: server.createdAt.toISOString(),
    lastStartAt: ps.lastStartAt?.toISOString() ?? null,
  };
}

/* ------------------------------------------------------------ Spieler */

const externalIdOk = (v: string) => /^[\w.:@-]{1,80}$/.test(v);

/** Spieler zur Kennung des Partners finden oder anlegen – die Spieler-ID entsteht automatisch */
export async function upsertPlayer(partner: Partner, externalId: string, name?: string | null): Promise<PartnerPlayer> {
  if (!externalIdOk(externalId)) {
    const msg = L('Die Nutzerkennung darf 1–80 Zeichen lang sein (Buchstaben, Ziffern, . _ : @ -).', 'The user id must be 1–80 characters (letters, digits, . _ : @ -).');
    throw Errors.badRequest('invalid_player', msg, { 'player.externalId': msg });
  }
  const clean = name?.replace(/\s+/g, ' ').trim().slice(0, 40) || null;
  const find = async () => (await db.select().from(partnerPlayers).where(and(eq(partnerPlayers.partnerId, partner.id), eq(partnerPlayers.externalId, externalId))).limit(1))[0];
  let player = await find();
  if (!player) {
    for (let attempt = 0; attempt < 5 && !player; attempt++) {
      try {
        await db.insert(partnerPlayers).values({ id: newPlayerId(), partnerId: partner.id, externalId, name: clean, lastSeenAt: new Date() });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
      player = await find();
    }
    if (!player) throw new Error('Spieler konnte nicht angelegt werden');
  } else if (clean && clean !== player.name) {
    await db.update(partnerPlayers).set({ name: clean, lastSeenAt: new Date() }).where(eq(partnerPlayers.id, player.id));
    player = { ...player, name: clean };
  }
  if (player.blocked) throw Errors.forbidden(L('Dieser Spieler ist gesperrt.', 'This player is blocked.'));
  return player;
}

/* ------------------------------------------------------------ Server */

async function load(partner: Partner, serverId: string): Promise<{ server: Server; ps: PartnerServer; player: PartnerPlayer }> {
  const [row] = await db
    .select({ server: servers, ps: partnerServers, player: partnerPlayers })
    .from(partnerServers)
    .innerJoin(servers, eq(servers.id, partnerServers.serverId))
    .innerJoin(partnerPlayers, eq(partnerPlayers.id, partnerServers.playerId))
    .where(and(eq(partnerServers.serverId, serverId), eq(partnerServers.partnerId, partner.id), ne(servers.status, 'deleted')))
    .limit(1);
  if (!row) throw Errors.notFound(L('Server nicht gefunden.', 'Server not found.'));
  return row;
}

/** Angebot des Partners: Paket, Servertypen mit Versionen, Grenzen und aktuelle Auslastung */
export async function partnerInfo(partner: Partner) {
  const settings = await getSettings();
  const plan = findPlan(settings, partner.planId);
  const [used] = await db.select({ n: count() }).from(servers).where(and(eq(servers.partnerId, partner.id), inArray(servers.status, [...LIVE])));
  return {
    partner: { id: partner.id, name: partner.name },
    plan: plan ? { id: plan.id, name: plan.name, memoryMb: plan.memoryMb, cpuPercent: plan.cpuPercent, diskMb: plan.diskMb } : null,
    serverTypes: freeHostingConfig.serverTypes
      .filter((t) => t.kind === 'minecraft' && serverTypeAvailable(t.id, settings))
      .map((t) => ({ id: t.id, name: t.name, versions: versionsFor(settings, t.id) })),
    limits: {
      maxServers: partner.maxServers,
      usedServers: Number(used?.n ?? 0),
      maxServersPerPlayer: partner.maxServersPerPlayer,
      sessionMaxHours: partner.sessionMaxHours,
      cooldownHours: partner.cooldownHours,
      heartbeatTimeoutSeconds: partner.heartbeatTimeoutSeconds,
      deleteAfterIdleDays: partner.deleteAfterIdleDays,
      serverNameMaxLength: NAME_MAX,
    },
    eulaUrl: EULA_URL,
  };
}

export async function listPartnerServers(partner: Partner, opts: { playerExternalId?: string; playerId?: string; limit?: number; offset?: number } = {}) {
  const conds = [eq(partnerServers.partnerId, partner.id), ne(servers.status, 'deleted')];
  if (opts.playerExternalId) conds.push(eq(partnerPlayers.externalId, opts.playerExternalId));
  if (opts.playerId) conds.push(eq(partnerPlayers.id, opts.playerId));
  const rows = await db
    .select({ server: servers, ps: partnerServers, player: partnerPlayers })
    .from(partnerServers)
    .innerJoin(servers, eq(servers.id, partnerServers.serverId))
    .innerJoin(partnerPlayers, eq(partnerPlayers.id, partnerServers.playerId))
    .where(and(...conds))
    .orderBy(desc(servers.createdAt))
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 100))
    .offset(Math.max(opts.offset ?? 0, 0));
  const now = new Date();
  return Promise.all(rows.map((r) => toDTO(partner, r.server, r.ps, r.player, now)));
}

export async function getPartnerServer(partner: Partner, id: string): Promise<PartnerServerDTO> {
  const { server, ps, player } = await load(partner, id);
  return toDTO(partner, server, ps, player);
}

export interface PartnerCreateInput {
  player: { externalId: string; name?: string | null };
  name: string;
  serverType: string;
  version: string;
}

/** Server für einen Spieler erstellen – die Spieler-ID entsteht dabei automatisch und steht im Servernamen */
export async function createPartnerServer(partner: Partner, input: PartnerCreateInput, ip?: string): Promise<PartnerServerDTO> {
  const settings = await getSettings();
  const plan = findPlan(settings, partner.planId);
  const type = getServerType(input.serverType);
  if (!plan || plan.kind !== 'minecraft') throw Errors.conflict('plan_unavailable', L('Für diesen Partner ist kein gültiges Paket eingestellt.', 'No valid plan is configured for this partner.'));
  if (!type || type.kind !== 'minecraft' || !serverTypeAvailable(input.serverType, settings)) {
    const msg = L('Dieser Servertyp ist nicht verfügbar.', 'This server type is not available.');
    throw Errors.badRequest('server_type_unavailable', msg, { serverType: msg });
  }
  if (!versionsFor(settings, type.id).includes(input.version)) {
    const msg = L('Diese Version ist für den Servertyp nicht verfügbar.', 'This version is not available for the selected server type.');
    throw Errors.badRequest('version_unavailable', msg, { version: msg });
  }
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (name.length < 3 || name.length > NAME_MAX || !/^[\p{L}\p{N} _.'-]+$/u.test(name)) {
    const msg = L(`Der Servername muss 3–${NAME_MAX} Zeichen lang sein (Buchstaben, Ziffern, Leerzeichen, . _ ' -).`, `The server name must be 3–${NAME_MAX} characters (letters, digits, spaces, . _ ' -).`);
    throw Errors.badRequest('invalid_name', msg, { name: msg });
  }
  const player = await upsertPlayer(partner, input.player.externalId, input.player.name);

  // Grenzen: insgesamt und je Spieler
  const [total] = await db.select({ n: count() }).from(servers).where(and(eq(servers.partnerId, partner.id), inArray(servers.status, [...LIVE])));
  if (Number(total?.n ?? 0) >= partner.maxServers) {
    throw new ApiError(409, 'partner_limit_reached', L('Die Höchstzahl an Servern für diesen Partner ist erreicht.', 'The maximum number of servers for this partner has been reached.'));
  }
  const [mine] = await db
    .select({ n: count() })
    .from(partnerServers)
    .innerJoin(servers, eq(servers.id, partnerServers.serverId))
    .where(and(eq(partnerServers.playerId, player.id), inArray(servers.status, [...LIVE])));
  if (Number(mine?.n ?? 0) >= partner.maxServersPerPlayer) {
    throw new ApiError(409, 'player_limit_reached', L(`Dieser Spieler hat bereits die Höchstzahl an Servern (${partner.maxServersPerPlayer}).`, `This player already has the maximum number of servers (${partner.maxServersPerPlayer}).`));
  }

  const id = uuid();
  const now = new Date();
  await db.insert(servers).values({
    id,
    userId: partner.userId,
    partnerId: partner.id,
    // Die Spieler-ID im Namen ordnet den Server im Panel und in der Verwaltung immer einem Spieler zu
    name: `${name} #${player.id}`,
    kind: 'minecraft',
    planId: plan.id,
    serverType: input.serverType,
    version: input.version,
    status: 'provisioning',
    memoryMb: plan.memoryMb,
    cpuPercent: plan.cpuPercent,
    diskMb: plan.diskMb,
    cycleNumber: 1,
    cycleStartedAt: now,
    // Kein 30-Tage-Zyklus: Für Partner-Server gilt nur die Laufzeit-Regel der Partner-API
    cycleEndsAt: NO_CYCLE_END,
  });
  await db.insert(partnerServers).values({ serverId: id, partnerId: partner.id, playerId: player.id });
  await db.update(partnerPlayers).set({ lastSeenAt: now }).where(eq(partnerPlayers.id, player.id));
  await audit({ userId: partner.userId, serverId: id, actor: 'system', action: 'partner.server_created', message: `Partner „${partner.name}“: Server „${name}“ für Spieler ${player.id} (${player.externalId}) angelegt`, ip });
  // Direkt im Panel anlegen – schlägt das fehl, versucht es der Hintergrund-Job erneut
  await provisionServer(id, 'system', ip);
  return getPartnerServer(partner, id);
}

/** Server stoppen und die Laufzeit verbuchen. `cooldown` = Pflichtpause beginnt (Laufzeit-Grenze erreicht) */
async function endSession(partner: Partner, server: Server, ps: PartnerServer, reason: 'host_stopped' | 'host_timeout' | 'session_limit' | 'admin', now: Date): Promise<void> {
  const limit = reason === 'session_limit';
  await db
    .update(partnerServers)
    .set({
      hostActive: false,
      runSeconds: limit ? 0 : Math.min(partner.sessionMaxHours * 3600, runSecondsNow(ps, now)),
      countedAt: null,
      lastStopAt: now,
      stopReason: reason,
      warnedMinutes: null,
      ...(limit ? { cooldownUntil: new Date(now.getTime() + partner.cooldownHours * 3_600_000) } : {}),
    })
    .where(eq(partnerServers.serverId, server.id));
  liveCache.delete(server.id);
  if (server.pteroIdentifier) await pterodactyl().sendPowerSignal(server.pteroIdentifier, 'stop').catch(() => {});
}

/**
 * Server starten (bzw. nach der Pflichtpause reaktivieren). Ab jetzt muss der Launcher regelmäßig ein Lebenszeichen
 * schicken. Beim ersten Start muss der Spieler die Minecraft-EULA akzeptiert haben (`acceptEula: true`).
 */
export async function startPartnerServer(partner: Partner, id: string, opts: { acceptEula?: boolean }, ip?: string): Promise<PartnerServerDTO> {
  const { server, ps, player } = await load(partner, id);
  const now = new Date();
  if (player.blocked) throw Errors.forbidden(L('Dieser Spieler ist gesperrt.', 'This player is blocked.'));
  if (server.status !== 'active' || !server.pteroIdentifier) {
    const failed = server.status === 'provisioning_failed';
    throw new ApiError(409, failed ? 'server_failed' : server.status === 'suspended' ? 'server_suspended' : 'server_installing', failed ? L('Die Einrichtung des Servers ist fehlgeschlagen und wird erneut versucht.', 'Setting up the server failed and is being retried.') : server.status === 'suspended' ? L('Dieser Server ist gesperrt.', 'This server is suspended.') : L('Der Server wird noch eingerichtet. Bitte gleich noch einmal versuchen.', 'The server is still being set up. Please try again shortly.'));
  }
  if ((await liveState(server)) === 'installing') throw new ApiError(409, 'server_installing', L('Der Server wird noch installiert. Bitte gleich noch einmal versuchen.', 'The server is still being installed. Please try again shortly.'));
  if (ps.cooldownUntil && ps.cooldownUntil > now) {
    throw new ApiError(409, 'cooldown', L(`Die Laufzeit-Grenze ist erreicht. Der Server kann ab ${ps.cooldownUntil.toISOString()} wieder gestartet werden.`, `The runtime limit has been reached. The server can be started again from ${ps.cooldownUntil.toISOString()}.`), { cooldownUntil: ps.cooldownUntil.toISOString() });
  }
  // Minecraft-EULA: Zustimmung des Spielers einmalig eintragen
  if (!ps.eulaAcceptedAt) {
    if (!opts.acceptEula) {
      throw new ApiError(409, 'eula_required', L(`Vor dem ersten Start muss der Spieler die Minecraft-EULA akzeptieren (${EULA_URL}). Sende dann "acceptEula": true.`, `Before the first start the player must accept the Minecraft EULA (${EULA_URL}). Then send "acceptEula": true.`));
    }
    try {
      await pterodactyl().writeFile(server.pteroIdentifier, '/eula.txt', `#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\n#Accepted by player ${player.id} via ${partner.name} on ${now.toISOString()}\neula=true\n`);
    } catch {
      throw Errors.unavailable(L('Der Server ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.', 'The server cannot be reached right now. Please try again shortly.'));
    }
    await audit({ userId: partner.userId, serverId: id, actor: 'system', action: 'partner.eula_accepted', message: `Minecraft-EULA für „${server.name}“ akzeptiert (Spieler ${player.id}, Partner „${partner.name}“)`, ip });
  }
  // War der Server lange genug aus (mindestens die Pausenlänge), beginnt die Laufzeit wieder bei null
  const rested = !ps.hostActive && (!ps.lastStopAt || now.getTime() - ps.lastStopAt.getTime() >= partner.cooldownHours * 3_600_000);
  await db
    .update(partnerServers)
    .set({
      hostActive: true,
      heartbeatAt: now,
      sessionStartedAt: ps.hostActive ? (ps.sessionStartedAt ?? now) : now,
      runSeconds: rested ? 0 : runSecondsNow(ps, now),
      countedAt: now,
      lastStartAt: now,
      stopReason: null,
      cooldownUntil: null,
      eulaAcceptedAt: ps.eulaAcceptedAt ?? now,
    })
    .where(eq(partnerServers.serverId, id));
  await db.update(partnerPlayers).set({ lastSeenAt: now }).where(eq(partnerPlayers.id, player.id));
  try {
    await pterodactyl().sendPowerSignal(server.pteroIdentifier, 'start');
  } catch {
    await db.update(partnerServers).set({ hostActive: false, countedAt: null, lastStopAt: ps.lastStopAt, stopReason: ps.stopReason }).where(eq(partnerServers.serverId, id));
    throw Errors.unavailable(L('Der Server konnte gerade nicht gestartet werden. Bitte gleich noch einmal versuchen.', 'The server could not be started right now. Please try again shortly.'));
  }
  liveCache.delete(id);
  return getPartnerServer(partner, id);
}

/** Lebenszeichen des Launchers: Der Host ist noch da. Antwort enthält die verbleibende Laufzeit. */
export async function heartbeatPartnerServer(partner: Partner, id: string): Promise<PartnerServerDTO> {
  const { server, ps, player } = await load(partner, id);
  if (!ps.hostActive) {
    throw new ApiError(409, 'not_running', L('Für diesen Server läuft keine Sitzung (mehr). Bitte neu starten.', 'No session is running for this server (any more). Please start it again.'), { reason: ps.stopReason ?? 'not_started' });
  }
  const now = new Date();
  await db.update(partnerServers).set({ heartbeatAt: now }).where(and(eq(partnerServers.serverId, id), eq(partnerServers.hostActive, true)));
  return toDTO(partner, server, { ...ps, heartbeatAt: now }, player, now);
}

/** Lebenszeichen für mehrere Server auf einmal (für Partner, die die Meldungen ihrer Nutzer bündeln) */
export async function heartbeatMany(partner: Partner, ids: string[]): Promise<{ ok: string[]; notRunning: string[] }> {
  const wanted = [...new Set(ids)].slice(0, 500);
  if (wanted.length === 0) return { ok: [], notRunning: [] };
  const rows = await db.select({ id: partnerServers.serverId }).from(partnerServers).where(and(eq(partnerServers.partnerId, partner.id), eq(partnerServers.hostActive, true), inArray(partnerServers.serverId, wanted)));
  const ok = rows.map((r) => r.id);
  if (ok.length) await db.update(partnerServers).set({ heartbeatAt: new Date() }).where(and(eq(partnerServers.partnerId, partner.id), eq(partnerServers.hostActive, true), inArray(partnerServers.serverId, ok)));
  return { ok, notRunning: wanted.filter((id) => !ok.includes(id)) };
}

/** Der Host hat den Launcher geschlossen: Server herunterfahren – die Daten bleiben erhalten */
export async function stopPartnerServer(partner: Partner, id: string): Promise<PartnerServerDTO> {
  const { server, ps } = await load(partner, id);
  await endSession(partner, server, ps, 'host_stopped', new Date());
  return getPartnerServer(partner, id);
}

/** Konsolenbefehl an den laufenden Server (z. B. `op <Name>` für den Host) */
export async function commandPartnerServer(partner: Partner, id: string, command: string): Promise<void> {
  const { server, ps } = await load(partner, id);
  if (!ps.hostActive || !server.pteroIdentifier) throw new ApiError(409, 'not_running', L('Der Server läuft nicht.', 'The server is not running.'));
  try {
    await pterodactyl().sendCommand(server.pteroIdentifier, command.replace(/^\//, '').replace(/[\r\n]+/g, ' ').slice(0, 200));
  } catch {
    throw new ApiError(409, 'not_running', L('Der Server nimmt gerade keine Befehle an (noch nicht hochgefahren?).', 'The server does not accept commands right now (not started yet?).'));
  }
}

/** Server samt Daten löschen */
export async function deletePartnerServer(partner: Partner, id: string, ip?: string): Promise<void> {
  const { server } = await load(partner, id);
  await hardDeleteServer(server);
  await audit({ userId: partner.userId, serverId: id, actor: 'system', action: 'partner.server_deleted', message: `Partner „${partner.name}“: Server „${server.name}“ gelöscht`, ip });
}

/* ------------------------------------------------------------ Hintergrund-Job */

/**
 * Läuft alle 30 Sekunden:
 *  – verbucht die Laufzeit laufender Sitzungen und stoppt bei ausbleibendem Lebenszeichen oder erreichter Grenze
 *  – stoppt Partner-Server, die ohne aktive Sitzung laufen (z. B. weil ein Stopp-Befehl das Panel nicht erreicht hat)
 *  – löscht lange nicht gestartete Server
 */
export async function runPartnerSessions(now = new Date()) {
  const stats = { active: 0, timeouts: 0, limits: 0, warned: 0, strays: 0, idleDeleted: 0 };
  const all = await db.select().from(partners);
  const byId = new Map(all.map((p) => [p.id, p]));

  const active = await db.select({ ps: partnerServers, server: servers }).from(partnerServers).innerJoin(servers, eq(servers.id, partnerServers.serverId)).where(eq(partnerServers.hostActive, true));
  stats.active = active.length;
  for (const { ps, server } of active) {
    const partner = byId.get(ps.partnerId);
    if (!partner) continue;
    const max = partner.sessionMaxHours * 3600;
    const run = runSecondsNow(ps, now);
    const silent = ps.heartbeatAt ? (now.getTime() - ps.heartbeatAt.getTime()) / 1000 : Infinity;
    if (!partner.enabled || server.status !== 'active') {
      await endSession(partner, server, ps, 'admin', now);
    } else if (silent > partner.heartbeatTimeoutSeconds) {
      // Der Launcher des Hosts meldet sich nicht mehr (geschlossen, abgestürzt, offline)
      await endSession(partner, server, ps, 'host_timeout', now);
      stats.timeouts++;
    } else if (run >= max) {
      if (server.pteroIdentifier) await pterodactyl().sendCommand(server.pteroIdentifier, `say Laufzeit-Grenze erreicht – der Server pausiert jetzt ${partner.cooldownHours} Stunden. / Runtime limit reached – the server now pauses for ${partner.cooldownHours} hours.`).catch(() => {});
      await endSession(partner, server, ps, 'session_limit', now);
      stats.limits++;
    } else {
      // Laufzeit verbuchen und kurz vor der Grenze im Spiel Bescheid sagen (10 und 1 Minute)
      const leftMinutes = (max - run) / 60;
      const step = leftMinutes <= 1 ? 1 : leftMinutes <= 10 ? 10 : null;
      const warn = step !== null && (ps.warnedMinutes === null || ps.warnedMinutes > step);
      await db.update(partnerServers).set({ runSeconds: run, countedAt: now, ...(warn ? { warnedMinutes: step } : {}) }).where(and(eq(partnerServers.serverId, ps.serverId), eq(partnerServers.hostActive, true)));
      if (warn && server.pteroIdentifier) {
        await pterodactyl().sendCommand(server.pteroIdentifier, `say Noch ${step} Minute${step === 1 ? '' : 'n'} bis zur Pause (${partner.cooldownHours} h). / ${step} minute${step === 1 ? '' : 's'} left until the break (${partner.cooldownHours} h).`).catch(() => {});
        stats.warned++;
      }
    }
  }

  // Läuft ohne aktive Sitzung: stoppen (der Stand kommt aus dem Power-Abgleich, der jede Minute läuft)
  const strays = await db
    .select({ server: servers })
    .from(partnerServers)
    .innerJoin(servers, eq(servers.id, partnerServers.serverId))
    .where(and(eq(partnerServers.hostActive, false), inArray(servers.powerState, ['running', 'starting']), isNotNull(servers.pteroIdentifier), or(sql`${partnerServers.lastStartAt} is null`, lt(partnerServers.lastStartAt, new Date(now.getTime() - 90_000)))))
    .limit(50);
  for (const { server } of strays) {
    await pterodactyl().sendPowerSignal(server.pteroIdentifier!, 'stop').catch(() => {});
    stats.strays++;
  }

  // Lange nicht gestartete Server löschen (je Lauf höchstens ein paar, damit das Panel nicht überlastet wird)
  for (const partner of all) {
    if (partner.deleteAfterIdleDays <= 0) continue;
    const before = new Date(now.getTime() - partner.deleteAfterIdleDays * 86_400_000);
    const idle = await db
      .select({ server: servers })
      .from(partnerServers)
      .innerJoin(servers, eq(servers.id, partnerServers.serverId))
      .where(and(eq(partnerServers.partnerId, partner.id), eq(partnerServers.hostActive, false), inArray(servers.status, ['active', 'provisioning_failed']), lt(servers.createdAt, before), or(sql`${partnerServers.lastStartAt} is null`, lt(partnerServers.lastStartAt, before))))
      .limit(3);
    for (const { server } of idle) {
      try {
        await hardDeleteServer(server);
        await audit({ userId: partner.userId, serverId: server.id, actor: 'system', action: 'partner.server_idle_deleted', message: `Partner „${partner.name}“: Server „${server.name}“ nach ${partner.deleteAfterIdleDays} Tagen ohne Start gelöscht` });
        stats.idleDeleted++;
      } catch {
        /* Panel nicht erreichbar – beim nächsten Lauf */
      }
    }
  }
  return stats;
}
