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
import { and, count, desc, eq, gt, inArray, isNotNull, lt, ne, or, sql } from 'drizzle-orm';
import { NO_CYCLE_END, serverTypesOf, findPlan, freeHostingConfig, getServerType, versionsFor, type AdminPartnerDTO, type AdminPartnerInput } from '@chfree/shared';
import { affectedRows, db, isUniqueViolation, writeTx } from '../db/client';
import { partnerPlayers, partnerServers, partners, servers, users, type Partner, type PartnerPlayer, type PartnerServer, type Server } from '../db/schema';
import { env } from '../env';
import { pterodactylConfig } from '../config/pterodactyl.config';
import { mapLimit } from '../jobs/types';
import { sha256, uuid } from '../lib/crypto';
import { minecraftStatus } from '../lib/minecraft-ping';
import { ApiError, Errors, L } from '../lib/errors';
import { pterodactyl } from '../pterodactyl';
import { unbudgeted } from '../pterodactyl/budget';
import { PterodactylError } from '../pterodactyl/types';
import { audit } from './audit.service';
import { assertInstallSlot, installsViaDirectory, newSoftwareJob, partnerTypeAvailable, resolveSoftware, softwareProgress } from './partner-software.service';
import { provisionServer } from './provisioning.service';
import { checkSettingsCaps, enforceSettingsCaps, purgePartnerBackups } from './partner-extras.service';
import { emitPartnerEvent } from './partner-webhooks.service';
import { hardDeleteServer } from './server.service';
import { deletionsAllowed, getSettings } from './settings.service';
import { offeredVersions } from './software-directory';

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
      keepAliveWhilePlayers: p.keepAliveWhilePlayers,
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
    keepAliveWhilePlayers: !!input.keepAliveWhilePlayers,
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
  const batch = await db.select().from(servers).where(and(eq(servers.partnerId, id), ne(servers.status, 'deleted'))).orderBy(sql`random()`).limit(25);
  for (const server of batch) {
    try {
      // Beim Löschen durch uns: gesperrte/nicht bereite Server nicht an den Backups scheitern lassen
      if (server.pteroIdentifier) await purgePartnerBackups(server.pteroIdentifier, true);
      await hardDeleteServer(server);
    } catch {
      /* Panel gerade nicht erreichbar – der Server bleibt und zählt unten als „übrig“; einfach erneut ausführen */
    }
  }
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
  /** Adresse zum Verbinden (Host:Port) – null, solange der Server noch eingerichtet wird. Der Port bleibt gleich, solange es den Server gibt. */
  address: string | null;
  host: string | null;
  port: number | null;
  serverType: string;
  version: string;
  /** Läuft gerade die Einrichtung der Server-Software (oder ist sie fehlgeschlagen)? Sonst null. */
  install: ReturnType<typeof softwareProgress>;
  resources: { memoryMb: number; cpuPercent: number; diskMb: number };
  eulaAccepted: boolean;
  session: {
    /** Die Sitzung läuft (der Server darf laufen) */
    active: boolean;
    /** Der Launcher des Hosts meldet sich gerade (false = Server läuft nur noch, weil Spieler darauf sind) */
    hostPresent: boolean;
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
  /** Wird der Server nicht mehr gestartet, wird er zu diesem Zeitpunkt samt Daten gelöscht (null = nie) */
  deleteAt: string | null;
}

const liveCache = new Map<string, { at: number; state: LiveState }>();

/** Zuletzt bekannter Stand aus unserer Datenbank (der Power-Abgleich läuft jede Minute) – ohne Panel-Aufruf */
function knownState(server: Server): LiveState {
  if (server.status === 'provisioning') return 'installing';
  if (server.status === 'provisioning_failed') return 'failed';
  if (server.status === 'suspended') return 'suspended';
  if (!server.pteroIdentifier) return 'installing';
  const s = server.powerState;
  return s === 'installing' ? 'installing' : s === 'running' || s === 'starting' || s === 'stopping' ? s : 'offline';
}

/**
 * Aktueller Stand laut Panel. `strict`: für Entscheidungen, die davon abhängen, dass der Server wirklich aus ist –
 * dann wird immer frisch nachgefragt, und statt auf den zuletzt bekannten Stand auszuweichen, schlägt der Aufruf fehl.
 */
async function liveState(server: Server, strict = false): Promise<LiveState> {
  if (server.status !== 'active' && server.status !== 'expiring') return knownState(server);
  if (!server.pteroIdentifier) return 'installing';
  const cached = liveCache.get(server.id);
  if (!strict && cached && Date.now() - cached.at < 5_000) return cached.state;
  let state: LiveState;
  try {
    const r = await pterodactyl().getResources(server.pteroIdentifier);
    if (r.state === 'installing') {
      // Installiert noch – oder die Installation ist fehlgeschlagen (das weiß nur die Verwaltungs-Schnittstelle)
      // Maßgeblich ist die Verwaltungs-Schnittstelle: Nur wenn sie „installing“ meldet, wird wirklich noch installiert.
      // (Der Client-Zugang antwortet auch aus anderen Gründen mit „nicht bereit“, z. B. kurz nach der Installation.)
      const p = await pterodactyl().getServer(server.pteroServerId!);
      state = p?.status === 'install_failed' ? 'failed' : p?.status === 'installing' || p?.status === 'restoring_backup' ? 'installing' : 'offline';
    } else state = r.state === 'running' || r.state === 'starting' || r.state === 'stopping' ? r.state : 'offline';
  } catch (err) {
    if (strict) {
      if (err instanceof ApiError) throw err; // z. B. Kontingent aufgebraucht (429)
      throw Errors.unavailable(L('Der Server ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.', 'The server cannot be reached right now. Please try again shortly.'));
    }
    // Panel gerade nicht erreichbar oder das Kontingent ist aufgebraucht: der zuletzt bekannte Stand
    return knownState(server);
  }
  if (liveCache.size > 5000) liveCache.clear();
  liveCache.set(server.id, { at: Date.now(), state });
  return state;
}

/** Wird der Server gerade (neu) installiert? Unser gemerkter Stand kann bis zu einer Minute alt sein – dann im Panel nachsehen. */
export const stillInstalling = async (server: Server): Promise<boolean> => server.powerState === 'installing' && (await liveState(server)) === 'installing';

/** Für andere Dienste: frisch im Panel nachsehen (schlägt fehl, statt zu raten) */
export const confirmedState = (server: Server) => liveState(server, true);

/** Nach einer Änderung (Neuinstallation, Backup einspielen) den gemerkten Stand verwerfen */
export const forgetLiveState = (serverId: string) => void liveCache.delete(serverId);

/** Letzte Nutzung eines Servers: Erstellung, letzter Start oder letztes Ende einer Sitzung (für die Löschung ungenutzter Server) */
const lastUseOf = (server: Pick<Server, 'createdAt'>, ps: Pick<PartnerServer, 'lastStartAt' | 'lastStopAt'>) => Math.max(server.createdAt.getTime(), ps.lastStartAt?.getTime() ?? 0, ps.lastStopAt?.getTime() ?? 0);

/** Laufzeit einschließlich der noch nicht verbuchten Sekunden */
function runSecondsNow(ps: PartnerServer, now: Date, round: 'floor' | 'ceil' = 'floor'): number {
  return ps.runSeconds + (ps.hostActive && ps.countedAt ? Math.max(0, Math[round]((now.getTime() - ps.countedAt.getTime()) / 1000)) : 0);
}

async function toDTO(partner: Partner, server: Server, ps: PartnerServer, player: PartnerPlayer, now = new Date(), live = true): Promise<PartnerServerDTO> {
  const max = partner.sessionMaxHours * 3600;
  const run = Math.min(max, runSecondsNow(ps, now));
  const cooling = ps.cooldownUntil && ps.cooldownUntil > now ? ps.cooldownUntil : null;
  const [host, port] = server.address ? [server.address.slice(0, server.address.lastIndexOf(':')), Number(server.address.slice(server.address.lastIndexOf(':') + 1))] : [null, null];
  const lastUse = lastUseOf(server, ps);
  return {
    id: server.id,
    name: server.name,
    player: { id: player.id, externalId: player.externalId, name: player.name },
    // In Listen der zuletzt bekannte Stand (höchstens eine Minute alt) – sonst kostete eine Liste hunderte Panel-Aufrufe
    state: server.status !== 'active' ? knownState(server) : ps.softwareJob ? (ps.softwareJob.error ? 'failed' : 'installing') : live ? await liveState(server) : knownState(server),
    address: server.address,
    host,
    port: port !== null && Number.isFinite(port) ? port : null,
    serverType: server.serverType,
    version: server.version,
    install: softwareProgress(ps),
    resources: { memoryMb: server.memoryMb, cpuPercent: server.cpuPercent, diskMb: server.diskMb },
    eulaAccepted: !!ps.eulaAcceptedAt,
    session: {
      active: ps.hostActive,
      hostPresent: ps.hostActive && !!ps.heartbeatAt && now.getTime() - ps.heartbeatAt.getTime() <= partner.heartbeatTimeoutSeconds * 1000,
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
    deleteAt: partner.deleteAfterIdleDays > 0 ? new Date(lastUse + partner.deleteAfterIdleDays * 86_400_000).toISOString() : null,
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

export async function loadPartnerServer(partner: Partner, serverId: string): Promise<{ server: Server; ps: PartnerServer; player: PartnerPlayer }> {
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
    serverTypes: await Promise.all(
      serverTypesOf('minecraft')
        .filter((t) => partnerTypeAvailable(t.id, settings))
        .map(async (t) => ({ id: t.id, name: t.name, versions: await offeredVersions(settings, t.id) })),
    ),
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
  return Promise.all(rows.map((r) => toDTO(partner, r.server, r.ps, r.player, now, false)));
}

export async function getPartnerServer(partner: Partner, id: string): Promise<PartnerServerDTO> {
  const { server, ps, player } = await loadPartnerServer(partner, id);
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
  if (!type || type.kind !== 'minecraft' || !partnerTypeAvailable(input.serverType, settings)) {
    const msg = L('Dieser Servertyp ist nicht verfügbar.', 'This server type is not available.');
    throw Errors.badRequest('server_type_unavailable', msg, { serverType: msg });
  }
  if (!(await offeredVersions(settings, type.id)).includes(input.version)) {
    const msg = L('Diese Version ist für den Servertyp nicht verfügbar.', 'This version is not available for the selected server type.');
    throw Errors.badRequest('version_unavailable', msg, { version: msg });
  }
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (name.length < 3 || name.length > NAME_MAX || !/^[\p{L}\p{N} _.'-]+$/u.test(name)) {
    const msg = L(`Der Servername muss 3–${NAME_MAX} Zeichen lang sein (Buchstaben, Ziffern, Leerzeichen, . _ ' -).`, `The server name must be 3–${NAME_MAX} characters (letters, digits, spaces, . _ ' -).`);
    throw Errors.badRequest('invalid_name', msg, { name: msg });
  }
  // Typen ohne eigenes Egg (Fabric, Forge, NeoForge, Quilt …): die Software vorab im Verzeichnis nachschlagen –
  // gibt es sie dort nicht, wird gar nicht erst ein Server angelegt
  const software = installsViaDirectory(input.serverType, settings) ? await resolveSoftware(input.serverType, input.version) : null;
  if (software) await assertInstallSlot(partner.id);
  const player = await upsertPlayer(partner, input.player.externalId, input.player.name);

  const id = uuid();
  const now = new Date();
  // Grenzen prüfen und den Server anlegen in EINER Schreib-Transaktion (Schreiber laufen nacheinander) – so können
  // gleichzeitige Anfragen die Grenzen nicht überschreiten. Maßgeblich sind die aktuellen Werte des Partners.
  await writeTx(async (tx) => {
    const [fresh] = await tx.select().from(partners).where(eq(partners.id, partner.id)).limit(1);
    if (!fresh || !fresh.enabled) throw new ApiError(401, 'invalid_api_key', L('Der Zugang ist deaktiviert.', 'Access is disabled.'));
    const [total] = await tx.select({ n: count() }).from(servers).where(and(eq(servers.partnerId, partner.id), inArray(servers.status, [...LIVE])));
    // Gelöschte Server ANDERER Spieler, deren Pflichtpause noch läuft oder deren Laufzeit noch nicht „ausgeruht“ ist,
    // belegen ihren Platz weiter. Sonst ließe sich die Laufzeit-Regel umgehen, indem man den Server löscht und unter
    // einer neuen Spieler-Kennung neu erstellt. (Für denselben Spieler gilt stattdessen der Übertrag weiter unten.)
    const restedSince = new Date(now.getTime() - fresh.cooldownHours * 3_600_000);
    const [resting] = await tx
      .select({ n: count() })
      .from(partnerServers)
      .innerJoin(servers, eq(servers.id, partnerServers.serverId))
      .where(and(eq(partnerServers.partnerId, partner.id), eq(servers.status, 'deleted'), ne(partnerServers.playerId, player.id), or(gt(partnerServers.cooldownUntil, now), and(gt(partnerServers.runSeconds, 0), gt(partnerServers.lastStopAt, restedSince)))));
    if (Number(total?.n ?? 0) >= fresh.maxServers) {
      throw new ApiError(409, 'partner_limit_reached', L('Die Höchstzahl an Servern für diesen Partner ist erreicht.', 'The maximum number of servers for this partner has been reached.'));
    }
    if (Number(total?.n ?? 0) + Number(resting?.n ?? 0) >= fresh.maxServers) {
      throw new ApiError(409, 'partner_limit_reached', L('Die Höchstzahl an Servern für diesen Partner ist erreicht. Plätze kürzlich gelöschter Server werden erst nach deren Pause wieder frei.', 'The maximum number of servers for this partner has been reached. Slots of recently deleted servers only become free after their break.'));
    }
    const [mine] = await tx
      .select({ n: count() })
      .from(partnerServers)
      .innerJoin(servers, eq(servers.id, partnerServers.serverId))
      .where(and(eq(partnerServers.playerId, player.id), inArray(servers.status, [...LIVE])));
    if (Number(mine?.n ?? 0) >= fresh.maxServersPerPlayer) {
      throw new ApiError(409, 'player_limit_reached', L(`Dieser Spieler hat bereits die Höchstzahl an Servern (${fresh.maxServersPerPlayer}).`, `This player already has the maximum number of servers (${fresh.maxServersPerPlayer}).`));
    }
    // Übertrag aus einem zuvor gelöschten Server: Laufzeit und Pflichtpause gelten weiter
    const [who] = await tx.select().from(partnerPlayers).where(eq(partnerPlayers.id, player.id)).limit(1);
    const cooling = who?.carryCooldownUntil && who.carryCooldownUntil > now ? who.carryCooldownUntil : null;
    const recent = !!who?.carryLastStopAt && now.getTime() - who.carryLastStopAt.getTime() < fresh.cooldownHours * 3_600_000;
    await tx.insert(servers).values({
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
    await tx.insert(partnerServers).values({
      serverId: id,
      partnerId: partner.id,
      playerId: player.id,
      runSeconds: recent || cooling ? (who?.carryRunSeconds ?? 0) : 0,
      lastStopAt: recent || cooling ? (who?.carryLastStopAt ?? null) : null,
      cooldownUntil: cooling,
      cooldownNotified: !cooling,
      installedNotified: false,
      stopReason: cooling ? 'session_limit' : null,
      // Nach der Grundinstallation im Panel richtet der Software-Job die gewünschte Software ein
      softwareJob: software ? newSoftwareJob(software, true) : null,
    });
    await tx.update(partnerPlayers).set({ lastSeenAt: now }).where(eq(partnerPlayers.id, player.id));
    // Der neue Server hat den Stand dieses Spielers übernommen – seine gelöschten Server belegen keinen Platz mehr
    await tx
      .update(partnerServers)
      .set({ runSeconds: 0, cooldownUntil: null })
      .where(and(eq(partnerServers.playerId, player.id), inArray(partnerServers.serverId, tx.select({ id: servers.id }).from(servers).where(and(eq(servers.partnerId, partner.id), eq(servers.status, 'deleted'))))));
  });
  await audit({ userId: partner.userId, serverId: id, actor: 'system', action: 'partner.server_created', message: `Partner „${partner.name}“: Server „${name}“ für Spieler ${player.id} (${player.externalId}) angelegt`, ip });
  // Direkt im Panel anlegen – schlägt das fehl, versucht es der Hintergrund-Job erneut
  await provisionServer(id, 'system', ip);
  return getPartnerServer(partner, id);
}

/** Server stoppen und die Laufzeit verbuchen. `cooldown` = Pflichtpause beginnt (Laufzeit-Grenze erreicht) */
async function endSession(partner: Partner, server: Server, ps: PartnerServer, reason: 'host_stopped' | 'host_timeout' | 'session_limit' | 'settings_limit' | 'admin', now: Date): Promise<void> {
  const limit = reason === 'session_limit';
  // Eine Pflichtpause gibt es nur beim Erreichen der Laufzeit-Grenze
  const pause = limit;
  const cooldownUntil = pause ? new Date(now.getTime() + partner.cooldownHours * 3_600_000) : null;
  // Nur eine laufende Sitzung lässt sich beenden. So löst z. B. wiederholtes „Stopp“ auf einen Server ohne Sitzung
  // keinen weiteren Panel-Aufruf aus (der Stopp-Befehl unten zählt bewusst nicht gegen das Kontingent).
  const ended = await db
    .update(partnerServers)
    .set({
      hostActive: false,
      runSeconds: limit ? 0 : Math.min(partner.sessionMaxHours * 3600, runSecondsNow(ps, now, 'ceil')),
      countedAt: null,
      lastStopAt: now,
      stopReason: reason,
      warnedMinutes: null,
      ...(pause ? { cooldownUntil, cooldownNotified: false } : {}),
    })
    .where(and(eq(partnerServers.serverId, server.id), eq(partnerServers.hostActive, true)));
  if (affectedRows(ended) !== 1) return;
  liveCache.delete(server.id);
  // Das Durchsetzen einer Grenze darf nie am Kontingent für Partner-Anfragen scheitern. Kommt der Befehl trotzdem nicht
  // an, holt ihn der Hintergrund-Job nach (und beendet den Server notfalls hart).
  if (server.pteroIdentifier) await unbudgeted(() => pterodactyl().sendPowerSignal(server.pteroIdentifier!, 'stop')).catch(() => {});
  await emitPartnerEvent(partner.id, 'server.stopped', { ...eventServer(server, ps), reason, cooldownUntil: cooldownUntil?.toISOString() ?? null }).catch(() => {});
}

/** Angaben zum Server in jedem Webhook-Ereignis */
const eventServer = (server: Server, ps: PartnerServer) => ({ serverId: server.id, name: server.name, playerId: ps.playerId });

/**
 * Server starten (bzw. nach der Pflichtpause reaktivieren). Ab jetzt muss der Launcher regelmäßig ein Lebenszeichen
 * schicken. Beim ersten Start muss der Spieler die Minecraft-EULA akzeptiert haben (`acceptEula: true`).
 */
export async function startPartnerServer(partner: Partner, id: string, opts: { acceptEula?: boolean }, ip?: string): Promise<PartnerServerDTO> {
  const { server, ps, player } = await loadPartnerServer(partner, id);
  const now = new Date();
  if (player.blocked) throw Errors.forbidden(L('Dieser Spieler ist gesperrt.', 'This player is blocked.'));
  if (server.status !== 'active' || !server.pteroIdentifier) {
    const failed = server.status === 'provisioning_failed';
    throw new ApiError(409, failed ? 'server_failed' : server.status === 'suspended' ? 'server_suspended' : 'server_installing', failed ? L('Die Einrichtung des Servers ist fehlgeschlagen und wird erneut versucht.', 'Setting up the server failed and is being retried.') : server.status === 'suspended' ? L('Dieser Server ist gesperrt.', 'This server is suspended.') : L('Der Server wird noch eingerichtet. Bitte gleich noch einmal versuchen.', 'The server is still being set up. Please try again shortly.'));
  }
  if (ps.softwareJob) {
    if (ps.softwareJob.error) throw new ApiError(409, 'server_failed', L('Die Server-Software konnte nicht eingerichtet werden. Bitte neu installieren (POST /reinstall) oder Typ/Version erneut setzen.', 'The server software could not be set up. Please reinstall (POST /reinstall) or set type/version again.'));
    throw new ApiError(409, 'server_installing', L('Die Server-Software wird noch eingerichtet. Bitte gleich noch einmal versuchen.', 'The server software is still being set up. Please try again shortly.'));
  }
  // Frisch nachsehen (nicht den kurz gemerkten Stand): Darauf beruht, ob eine neue Sitzung beginnen darf
  const state = await liveState(server, !ps.hostActive);
  if (state === 'failed') throw new ApiError(409, 'server_failed', L('Die Installation des Servers ist fehlgeschlagen. Bitte neu installieren (POST /reinstall).', 'Installing the server failed. Please reinstall (POST /reinstall).'));
  if (state === 'installing') throw new ApiError(409, 'server_installing', L('Der Server wird noch installiert. Bitte gleich noch einmal versuchen.', 'The server is still being installed. Please try again shortly.'));
  // Eine neue Sitzung beginnt erst, wenn der Server aus der vorigen wirklich aus ist. Sonst ließe sich ein Server,
  // der den Stopp-Befehl ignoriert, mit „Start, Stopp, Start, Stopp …“ ohne gezählte Laufzeit am Leben halten.
  if (!ps.hostActive && state !== 'offline') {
    throw new ApiError(409, 'server_stopping', L('Der Server fährt noch herunter. Bitte in ein paar Sekunden erneut versuchen.', 'The server is still shutting down. Please try again in a few seconds.'));
  }
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
  // Grenzen der Einstellungen durchsetzen (z. B. nach einem direkten Datei-Upload oder einem eingespielten Backup)
  try {
    await enforceSettingsCaps(server.pteroIdentifier, server.serverType);
  } catch {
    throw Errors.unavailable(L('Der Server ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.', 'The server cannot be reached right now. Please try again shortly.'));
  }
  // War der Server lange genug aus (mindestens die Pausenlänge), beginnt die Laufzeit wieder bei null
  const rested = !ps.hostActive && (!ps.lastStopAt || now.getTime() - ps.lastStopAt.getTime() >= partner.cooldownHours * 3_600_000);
  // Nur setzen, wenn sich der Stand seit dem Lesen nicht geändert hat – sonst könnte ein Start, der gleichzeitig mit dem
  // Erreichen der Laufzeit-Grenze eintrifft, die eben verhängte Pause wieder löschen
  const started = await db
    .update(partnerServers)
    .set({
      hostActive: true,
      heartbeatAt: now,
      sessionStartedAt: ps.hostActive ? (ps.sessionStartedAt ?? now) : now,
      // Läuft die Sitzung schon, bleibt die Verbuchung unberührt: Wiederholtes „Start“ darf keine Bruchteile von
      // Sekunden verwerfen (sonst bliebe die Laufzeit bei schnellen Wiederholungen stehen)
      ...(ps.hostActive ? {} : { runSeconds: rested ? 0 : ps.runSeconds, countedAt: now }),
      lastStartAt: now,
      stopReason: null,
      cooldownUntil: null,
      eulaAcceptedAt: ps.eulaAcceptedAt ?? now,
      runningNotified: ps.hostActive ? ps.runningNotified : false,
      cooldownNotified: true,
      deletionWarnedAt: null,
    })
    .where(and(eq(partnerServers.serverId, id), eq(partnerServers.hostActive, ps.hostActive), sql`${partnerServers.softwareJob} is null`, or(sql`${partnerServers.cooldownUntil} is null`, lt(partnerServers.cooldownUntil, now)), ps.lastStopAt ? eq(partnerServers.lastStopAt, ps.lastStopAt) : sql`${partnerServers.lastStopAt} is null`));
  if (affectedRows(started) !== 1) throw Errors.conflict('state_changed', L('Der Stand des Servers hat sich gerade geändert. Bitte noch einmal versuchen.', 'The state of the server has just changed. Please try again.'));
  await db.update(partnerPlayers).set({ lastSeenAt: now }).where(eq(partnerPlayers.id, player.id));
  try {
    await pterodactyl().sendPowerSignal(server.pteroIdentifier, 'start');
  } catch {
    // Lief die Sitzung schon, bleibt sie unverändert. Sonst exakt den Stand von vorher wiederherstellen – ein
    // fehlgeschlagener Start darf weder die Laufzeit zurücksetzen noch als „benutzt“ zählen.
    if (!ps.hostActive) {
      await db
        .update(partnerServers)
        .set({ hostActive: false, runSeconds: ps.runSeconds, countedAt: null, sessionStartedAt: ps.sessionStartedAt, lastStartAt: ps.lastStartAt, lastStopAt: ps.lastStopAt, stopReason: ps.stopReason, cooldownUntil: ps.cooldownUntil, runningNotified: ps.runningNotified, cooldownNotified: ps.cooldownNotified, deletionWarnedAt: ps.deletionWarnedAt })
        .where(eq(partnerServers.serverId, id));
    }
    throw Errors.unavailable(L('Der Server konnte gerade nicht gestartet werden. Bitte gleich noch einmal versuchen.', 'The server could not be started right now. Please try again shortly.'));
  }
  liveCache.delete(id);
  return getPartnerServer(partner, id);
}

/** Lebenszeichen des Launchers: Der Host ist noch da. Antwort enthält die verbleibende Laufzeit. */
export async function heartbeatPartnerServer(partner: Partner, id: string): Promise<PartnerServerDTO> {
  const { server, ps, player } = await loadPartnerServer(partner, id);
  if (!ps.hostActive) {
    throw new ApiError(409, 'not_running', L('Für diesen Server läuft keine Sitzung (mehr). Bitte neu starten.', 'No session is running for this server (any more). Please start it again.'), { reason: ps.stopReason ?? 'not_started' });
  }
  const now = new Date();
  await db.update(partnerServers).set({ heartbeatAt: now }).where(and(eq(partnerServers.serverId, id), eq(partnerServers.hostActive, true)));
  // Ohne Panel-Abfrage: Lebenszeichen kommen ständig und dürfen das Kontingent für Panel-Aufrufe nicht aufbrauchen
  return toDTO(partner, server, { ...ps, heartbeatAt: now }, player, now, false);
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

/**
 * So lange darf ein Server ohne Lebenszeichen des Hosts höchstens weiterlaufen, wenn noch Spieler darauf sind.
 * Die Spielerzahl meldet der Server selbst – sie lässt sich also fälschen und darf deshalb nichts unbegrenzt verlängern.
 */
export const KEEP_ALIVE_MAX_SECONDS = 2 * 3600;

/** Spielerzahl eines laufenden Servers (null = antwortet nicht) */
export async function playersOnline(server: Pick<Server, 'address'>): Promise<{ online: number; max: number } | null> {
  if (!server.address) return null;
  const at = server.address.lastIndexOf(':');
  const status = await minecraftStatus(server.address.slice(0, at), Number(server.address.slice(at + 1)), 2500).catch(() => null);
  return status ? { online: status.online, max: status.max } : null;
}

/**
 * Der Host hat den Launcher geschlossen: Server herunterfahren – die Daten bleiben erhalten.
 * Mit `whenEmpty` (und der Freigabe „weiterlaufen, solange Spieler online sind“) läuft der Server weiter,
 * bis niemand mehr darauf ist.
 */
export async function stopPartnerServer(partner: Partner, id: string, opts: { whenEmpty?: boolean } = {}): Promise<PartnerServerDTO> {
  const { server, ps } = await loadPartnerServer(partner, id);
  if (opts.whenEmpty && partner.keepAliveWhilePlayers && ps.hostActive && ((await playersOnline(server))?.online ?? 0) > 0) {
    // Der Host ist weg: kein Lebenszeichen mehr – der Hintergrund-Job stoppt, sobald der Server leer ist
    await db.update(partnerServers).set({ heartbeatAt: new Date(Date.now() - (partner.heartbeatTimeoutSeconds + 1) * 1000) }).where(and(eq(partnerServers.serverId, id), eq(partnerServers.hostActive, true)));
    return getPartnerServer(partner, id);
  }
  // Ohne laufende Sitzung gibt es nichts zu beenden (läuft der Server trotzdem, stoppt ihn der Hintergrund-Job)
  if (ps.hostActive) await endSession(partner, server, ps, 'host_stopped', new Date());
  return getPartnerServer(partner, id);
}

/** Konsolenbefehl an den laufenden Server (z. B. `op <Name>` für den Host) */
export async function commandPartnerServer(partner: Partner, id: string, command: string): Promise<void> {
  const { server, ps } = await loadPartnerServer(partner, id);
  if (!ps.hostActive || !server.pteroIdentifier) throw new ApiError(409, 'not_running', L('Der Server läuft nicht.', 'The server is not running.'));
  try {
    await pterodactyl().sendCommand(server.pteroIdentifier, command.replace(/^\//, '').replace(/[\r\n]+/g, ' ').slice(0, 200));
  } catch {
    throw new ApiError(409, 'not_running', L('Der Server nimmt gerade keine Befehle an (noch nicht hochgefahren?).', 'The server does not accept commands right now (not started yet?).'));
  }
}

/**
 * Beim Löschen eines Servers Laufzeit und Pflichtpause auf den Spieler übertragen – sonst ließe sich die
 * Laufzeit-Regel durch Löschen und neu Erstellen zurücksetzen. Es gilt jeweils der strengere Stand.
 */
async function carryOver(partner: Partner, ps: PartnerServer, playerId: string, now: Date): Promise<void> {
  const run = Math.min(partner.sessionMaxHours * 3600, runSecondsNow(ps, now, 'ceil'));
  const lastStop = ps.hostActive ? now : ps.lastStopAt;
  const cooling = ps.cooldownUntil && ps.cooldownUntil > now ? ps.cooldownUntil : null;
  const window = partner.cooldownHours * 3_600_000;
  const relevant = !!cooling || (run > 0 && !!lastStop && now.getTime() - lastStop.getTime() < window);
  if (!relevant) return;
  const [cur] = await db.select().from(partnerPlayers).where(eq(partnerPlayers.id, playerId)).limit(1);
  const curRecent = !!cur?.carryLastStopAt && now.getTime() - cur.carryLastStopAt.getTime() < window;
  const curCooling = cur?.carryCooldownUntil && cur.carryCooldownUntil > now ? cur.carryCooldownUntil : null;
  await db
    .update(partnerPlayers)
    .set({
      carryRunSeconds: Math.max(run, curRecent ? (cur?.carryRunSeconds ?? 0) : 0),
      carryLastStopAt: lastStop && cur?.carryLastStopAt && curRecent ? new Date(Math.max(lastStop.getTime(), cur.carryLastStopAt.getTime())) : lastStop,
      carryCooldownUntil: cooling && curCooling ? new Date(Math.max(cooling.getTime(), curCooling.getTime())) : (cooling ?? curCooling),
    })
    .where(eq(partnerPlayers.id, playerId));
}

/** Server samt Daten löschen */
export async function deletePartnerServer(partner: Partner, id: string, ip?: string): Promise<void> {
  const { server, ps, player } = await loadPartnerServer(partner, id);
  // Während der Einrichtung gäbe es im Panel einen Server, den wir noch nicht kennen – erst danach löschen
  if (server.status === 'provisioning') throw new ApiError(409, 'server_installing', L('Der Server wird noch eingerichtet. Bitte gleich noch einmal versuchen.', 'The server is still being set up. Please try again shortly.'));
  // Eine Sperre durch uns lässt sich nicht durch Löschen und neu Erstellen aufheben
  if (server.status === 'suspended') throw new ApiError(409, 'server_suspended', L('Dieser Server ist gesperrt und kann nur von CraftingHosting gelöscht werden.', 'This server is suspended and can only be deleted by CraftingHosting.'));
  const now = new Date();
  // Erst den Stand auf den Spieler übertragen, dann löschen: Schlägt das Löschen fehl, schadet der Übertrag nicht
  await carryOver(partner, ps, player.id, now);
  // Backups mit entfernen – sonst blieben sie auf dem Node liegen und jede Runde „löschen und neu erstellen“ kostete Speicher
  try {
    if (server.pteroIdentifier) await purgePartnerBackups(server.pteroIdentifier);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(503, 'panel_unavailable', L('Der Server konnte gerade nicht gelöscht werden. Bitte später erneut versuchen.', 'The server could not be deleted right now. Please try again later.'));
  }
  await hardDeleteServer(server);
  await db.update(partnerServers).set({ hostActive: false, countedAt: null, runSeconds: Math.min(partner.sessionMaxHours * 3600, runSecondsNow(ps, now, 'ceil')), ...(ps.hostActive ? { lastStopAt: now, stopReason: 'host_stopped' } : {}) }).where(eq(partnerServers.serverId, id));
  mustBeOffSince.delete(id);
  await audit({ userId: partner.userId, serverId: id, actor: 'system', action: 'partner.server_deleted', message: `Partner „${partner.name}“: Server „${server.name}“ gelöscht`, ip });
}

/* ------------------------------------------------------------ Hintergrund-Job */

/** Wann die Einstellungen eines laufenden Servers zuletzt nachgeprüft wurden – und wie oft sie sich nicht lesen ließen */
const settingsCheckedAt = new Map<string, number>();
const settingsUnreadable = new Map<string, number>();
const SETTINGS_FIRST_CHECK_MS = 60_000;
const SETTINGS_RECHECK_MS = 5 * 60_000;

/** Ist für diese Sitzung eine Nachprüfung fällig? (eine Minute nach dem Start, danach alle fünf Minuten – unabhängig vom gemeldeten Zustand) */
function settingsCheckDue(ps: PartnerServer, serverId: string, now: Date): boolean {
  if (!ps.lastStartAt || now.getTime() - ps.lastStartAt.getTime() < SETTINGS_FIRST_CHECK_MS) return false;
  const last = settingsCheckedAt.get(serverId) ?? 0;
  return last < ps.lastStartAt.getTime() + SETTINGS_FIRST_CHECK_MS || now.getTime() - last >= SETTINGS_RECHECK_MS;
}

/**
 * Nachprüfung bei laufender Sitzung: Vor jedem Start begrenzen wir die Einstellungen. Wer die Datei genau zwischen
 * dieser Prüfung und dem Hochfahren austauscht, fällt bei der ersten Nachprüfung auf (Minecraft schreibt beim
 * Hochfahren die geladenen Werte in die server.properties zurück): Die Dateien werden korrigiert und der Server gestoppt.
 * Spätere Funde (jemand ändert die Datei bei laufendem Server) werden nur korrigiert – sie wirken ohnehin erst beim
 * nächsten Start, und der begrenzt wieder. Rückgabe: true = gestoppt.
 */
async function verifySettings(partner: Partner, server: Server, ps: PartnerServer, now: Date): Promise<boolean> {
  if (!server.pteroIdentifier) return false;
  const first = (settingsCheckedAt.get(server.id) ?? 0) < (ps.lastStartAt?.getTime() ?? 0);
  let result: 'ok' | 'violation' | 'unreadable';
  try {
    result = await checkSettingsCaps(server.pteroIdentifier, server.serverType);
  } catch {
    return false; // Panel gerade nicht erreichbar – beim nächsten Lauf erneut
  }
  if (settingsCheckedAt.size > 20_000) settingsCheckedAt.clear();
  settingsCheckedAt.set(server.id, now.getTime());
  if (result === 'unreadable') {
    // Lässt sich die Datei mehrfach nicht lesen (z. B. künstlich aufgebläht), gilt das wie ein Verstoß
    const strikes = (settingsUnreadable.get(server.id) ?? 0) + 1;
    settingsUnreadable.set(server.id, strikes);
    settingsCheckedAt.delete(server.id);
    if (strikes < 3) return false;
  } else if (result === 'ok' || !first) {
    settingsUnreadable.delete(server.id);
    return false;
  }
  settingsUnreadable.delete(server.id);
  await pterodactyl().sendCommand(server.pteroIdentifier, 'say Die Servereinstellungen überschreiten die erlaubten Grenzen – der Server wird gestoppt. / The server settings exceed the allowed limits – the server is being stopped.').catch(() => {});
  await endSession(partner, server, ps, 'settings_limit', now);
  await audit({ userId: partner.userId, serverId: server.id, actor: 'system', action: 'partner.settings_limit', message: `Partner „${partner.name}“: „${server.name}“ lief mit Einstellungen über den Grenzen und wurde gestoppt` });
  return true;
}

/** Seit wann ein Server ohne Sitzung noch läuft (für die Frist zwischen Stopp und hartem Beenden) */
const mustBeOffSince = new Map<string, number>();

/**
 * Läuft alle 30 Sekunden:
 *  – verbucht die Laufzeit laufender Sitzungen und stoppt bei ausbleibendem Lebenszeichen oder erreichter Grenze
 *  – stoppt Partner-Server, die ohne aktive Sitzung laufen (z. B. weil ein Stopp-Befehl das Panel nicht erreicht hat)
 *  – löscht lange nicht gestartete Server
 */
export async function runPartnerSessions(now = new Date()) {
  const stats = { active: 0, timeouts: 0, limits: 0, warned: 0, strays: 0, killed: 0, settingsStops: 0, idleDeleted: 0, keptAlive: 0, failed: 0 };
  const all = await db.select().from(partners);
  const byId = new Map(all.map((p) => [p.id, p]));

  const active = await db.select({ ps: partnerServers, server: servers }).from(partnerServers).innerJoin(servers, eq(servers.id, partnerServers.serverId)).where(eq(partnerServers.hostActive, true));
  stats.active = active.length;
  // Jede Sitzung für sich und mehrere gleichzeitig: Ein einzelner hängender oder fehlerhafter Server darf die Regeln
  // für alle anderen nicht aufhalten
  const sessions = await mapLimit(active, 8, async ({ ps, server }) => {
    const partner = byId.get(ps.partnerId);
    if (!partner) return;
    const max = partner.sessionMaxHours * 3600;
    const run = runSecondsNow(ps, now);
    // Nur um die verbuchten ganzen Sekunden vorrücken – der Rest zählt beim nächsten Lauf mit
    const booked = ps.countedAt ? new Date(ps.countedAt.getTime() + (run - ps.runSeconds) * 1000) : now;
    const silent = ps.heartbeatAt ? (now.getTime() - ps.heartbeatAt.getTime()) / 1000 : Infinity;
    if (!partner.enabled || server.status !== 'active') {
      await endSession(partner, server, ps, 'admin', now);
    } else if (run >= max) {
      if (server.pteroIdentifier) await pterodactyl().sendCommand(server.pteroIdentifier, `say Laufzeit-Grenze erreicht – der Server pausiert jetzt ${partner.cooldownHours} Stunden. / Runtime limit reached – the server now pauses for ${partner.cooldownHours} hours.`).catch(() => {});
      await endSession(partner, server, ps, 'session_limit', now);
      stats.limits++;
    } else if (silent > partner.heartbeatTimeoutSeconds && partner.keepAliveWhilePlayers && silent < partner.heartbeatTimeoutSeconds + KEEP_ALIVE_MAX_SECONDS && ((await playersOnline(server))?.online ?? 0) > 0) {
      // Der Host ist weg, aber es sind noch Spieler da: weiterlaufen lassen (die Laufzeit zählt weiter)
      await db.update(partnerServers).set({ runSeconds: run, countedAt: booked }).where(and(eq(partnerServers.serverId, ps.serverId), eq(partnerServers.hostActive, true)));
      stats.keptAlive++;
    } else if (silent > partner.heartbeatTimeoutSeconds) {
      // Der Launcher des Hosts meldet sich nicht mehr (geschlossen, abgestürzt, offline)
      await endSession(partner, server, ps, 'host_timeout', now);
      stats.timeouts++;
    } else if (settingsCheckDue(ps, server.id, now) && (await verifySettings(partner, server, ps, now))) {
      // Der Server läuft mit Einstellungen über den Grenzen (Datei nach unserer Prüfung ausgetauscht)
      stats.settingsStops++;
    } else {
      // Laufzeit verbuchen und kurz vor der Grenze im Spiel Bescheid sagen (10 und 1 Minute)
      const leftMinutes = (max - run) / 60;
      const step = leftMinutes <= 1 ? 1 : leftMinutes <= 10 ? 10 : null;
      const warn = step !== null && (ps.warnedMinutes === null || ps.warnedMinutes > step);
      await db.update(partnerServers).set({ runSeconds: run, countedAt: booked, ...(warn ? { warnedMinutes: step } : {}) }).where(and(eq(partnerServers.serverId, ps.serverId), eq(partnerServers.hostActive, true)));
      if (warn && server.pteroIdentifier) {
        await pterodactyl().sendCommand(server.pteroIdentifier, `say Noch ${step} Minute${step === 1 ? '' : 'n'} bis zur Pause (${partner.cooldownHours} h). / ${step} minute${step === 1 ? '' : 's'} left until the break (${partner.cooldownHours} h).`).catch(() => {});
        stats.warned++;
      }
    }
  });
  stats.failed += sessions.failed;

  // Ohne aktive Sitzung muss ein Partner-Server aus sein – und zwar dauerhaft durchgesetzt, nicht mit einem einzelnen
  // Stopp-Befehl: Ein Server, der „stop“ ignoriert (z. B. durch ein hochgeladenes Plugin), wird nach der Frist hart
  // beendet. Der Stand kommt aus dem Power-Abgleich (jede Minute); bei unbekanntem Stand wird direkt nachgefragt.
  const mustBeOff = await db
    .select({ server: servers, ps: partnerServers })
    .from(partnerServers)
    .innerJoin(servers, eq(servers.id, partnerServers.serverId))
    .where(
      and(
        eq(partnerServers.hostActive, false),
        inArray(servers.status, ['active', 'suspended']),
        isNotNull(servers.pteroIdentifier),
        or(inArray(servers.powerState, ['running', 'starting', 'stopping']), and(eq(servers.powerState, 'unknown'), isNotNull(partnerServers.lastStartAt))),
      ),
    )
    .orderBy(desc(partnerServers.lastStopAt))
    .limit(500);
  const seen = new Set<string>();
  const enforced = await mapLimit(mustBeOff, 8, async ({ server, ps }) => {
    // Im Panel nachsehen: Der gemerkte Stand kann bis zu einer Minute alt sein
    const state = (await pterodactyl().getResources(server.pteroIdentifier!)).state;
    if (state !== 'running' && state !== 'starting' && state !== 'stopping') return;
    seen.add(server.id);
    // Zeit, die ein Server nach dem Ende der Sitzung weiterläuft, zählt als Laufzeit – sonst ließe sie sich mit einem
    // Server, der den Stopp-Befehl ignoriert, immer wieder kostenlos herausholen
    const partner = byId.get(ps.partnerId);
    if (partner && server.status === 'active') {
      const elapsed = ps.lastStopAt ? Math.min(600, Math.max(0, Math.floor((now.getTime() - ps.lastStopAt.getTime()) / 1000))) : 0;
      const max = partner.sessionMaxHours * 3600;
      const over = ps.runSeconds + elapsed >= max && !(ps.cooldownUntil && ps.cooldownUntil > now);
      const cooldownUntil = new Date(now.getTime() + partner.cooldownHours * 3_600_000);
      if (elapsed > 0 || !ps.lastStopAt) {
        await db
          .update(partnerServers)
          .set(over ? { runSeconds: 0, lastStopAt: now, stopReason: 'session_limit', cooldownUntil, cooldownNotified: false } : { runSeconds: Math.min(max, ps.runSeconds + elapsed), lastStopAt: now })
          .where(and(eq(partnerServers.serverId, server.id), eq(partnerServers.hostActive, false)));
      }
      if (over) {
        await pterodactyl().sendPowerSignal(server.pteroIdentifier!, 'kill');
        await emitPartnerEvent(partner.id, 'server.stopped', { ...eventServer(server, ps), reason: 'session_limit', cooldownUntil: cooldownUntil.toISOString() }).catch(() => {});
        stats.killed++;
        stats.limits++;
        return;
      }
    }
    const since = mustBeOffSince.get(server.id) ?? now.getTime();
    mustBeOffSince.set(server.id, since);
    if (now.getTime() - since >= freeHostingConfig.cycle.stopGraceSeconds * 1000) {
      await pterodactyl().sendPowerSignal(server.pteroIdentifier!, 'kill');
      stats.killed++;
    } else {
      await pterodactyl().sendPowerSignal(server.pteroIdentifier!, 'stop');
      stats.strays++;
    }
  });
  stats.failed += enforced.failed;
  // Wer inzwischen aus ist (oder wieder eine Sitzung hat), fällt aus der Beobachtung
  for (const id of mustBeOffSince.keys()) if (!seen.has(id)) mustBeOffSince.delete(id);

  // Webhooks: „läuft“ (einmal je Sitzung), „installiert“, „Pause vorbei“, „Löschung steht bevor“.
  // Bewusst NACH dem Durchsetzen der Regeln: Benachrichtigungen dürfen einen Stopp nie verzögern.
  const toNotify = await db
    .select({ ps: partnerServers, server: servers })
    .from(partnerServers)
    .innerJoin(servers, eq(servers.id, partnerServers.serverId))
    .where(
      and(
        ne(servers.status, 'deleted'),
        or(
          and(eq(partnerServers.hostActive, true), eq(partnerServers.runningNotified, false)),
          // „installiert“ erst, wenn auch die Server-Software fertig ist (laufende und fehlgeschlagene Einrichtungen warten nicht in dieser Liste)
          and(eq(partnerServers.installedNotified, false), sql`${partnerServers.softwareJob} is null`, eq(servers.status, 'active')),
          eq(partnerServers.cooldownNotified, false),
        ),
      ),
    )
    .orderBy(desc(partnerServers.lastStartAt))
    .limit(300);
  const notified = await mapLimit(toNotify, 8, async ({ ps, server }) => {
    const partner = byId.get(ps.partnerId);
    if (!partner) return;
    const patch: Partial<typeof partnerServers.$inferInsert> = {};
    const wantsInstalled = !ps.installedNotified && !ps.softwareJob && server.status === 'active';
    const state = wantsInstalled || (ps.hostActive && !ps.runningNotified) ? await liveState(server) : null;
    if (wantsInstalled && state !== null && state !== 'installing') {
      patch.installedNotified = true;
      if (state === 'failed') await emitPartnerEvent(partner.id, 'server.install_failed', { ...eventServer(server, ps), serverType: server.serverType, version: server.version, error: 'Die Installation im Panel ist fehlgeschlagen.' }).catch(() => {});
      else await emitPartnerEvent(partner.id, 'server.installed', { ...eventServer(server, ps), address: server.address }).catch(() => {});
    }
    if (ps.hostActive && !ps.runningNotified && state === 'running') {
      patch.runningNotified = true;
      await emitPartnerEvent(partner.id, 'server.running', { ...eventServer(server, ps), address: server.address }).catch(() => {});
    }
    if (!ps.cooldownNotified && (!ps.cooldownUntil || ps.cooldownUntil <= now)) {
      patch.cooldownNotified = true;
      await emitPartnerEvent(partner.id, 'server.cooldown_ended', eventServer(server, ps)).catch(() => {});
    }
    if (Object.keys(patch).length) await db.update(partnerServers).set(patch).where(eq(partnerServers.serverId, ps.serverId));
  });
  stats.failed += notified.failed;
  for (const partner of all) {
    if (partner.deleteAfterIdleDays <= 0 || !partner.webhookUrl) continue;
    // Drei Tage vor der Löschung Bescheid geben (bei kürzerer Frist: ab der Hälfte)
    const lead = Math.min(3, partner.deleteAfterIdleDays / 2) * 86_400_000;
    const threshold = new Date(now.getTime() - (partner.deleteAfterIdleDays * 86_400_000 - lead));
    const soon = await db
      .select({ ps: partnerServers, server: servers })
      .from(partnerServers)
      .innerJoin(servers, eq(servers.id, partnerServers.serverId))
      .where(and(eq(partnerServers.partnerId, partner.id), eq(partnerServers.hostActive, false), sql`${partnerServers.deletionWarnedAt} is null`, eq(servers.status, 'active'), lt(servers.createdAt, threshold), or(sql`${partnerServers.lastStartAt} is null`, lt(partnerServers.lastStartAt, threshold)), or(sql`${partnerServers.lastStopAt} is null`, lt(partnerServers.lastStopAt, threshold))))
      .limit(50);
    for (const { ps, server } of soon) {
      const lastUse = lastUseOf(server, ps);
      await db.update(partnerServers).set({ deletionWarnedAt: now }).where(eq(partnerServers.serverId, ps.serverId));
      await emitPartnerEvent(partner.id, 'server.deletion_soon', { ...eventServer(server, ps), deleteAt: new Date(lastUse + partner.deleteAfterIdleDays * 86_400_000).toISOString() }).catch(() => {});
    }
  }

  // Lange nicht gestartete Server löschen (je Lauf höchstens ein paar, damit das Panel nicht überlastet wird).
  // Nicht während einer Wartung und kurz danach, und nicht bei deaktivierten Partnern – dort konnte niemand starten.
  const mayDelete = await deletionsAllowed(now);
  for (const partner of all) {
    if (partner.deleteAfterIdleDays <= 0 || !partner.enabled || !mayDelete) continue;
    const before = new Date(now.getTime() - partner.deleteAfterIdleDays * 86_400_000);
    const idle = await db
      .select({ server: servers, ps: partnerServers })
      .from(partnerServers)
      .innerJoin(servers, eq(servers.id, partnerServers.serverId))
      .where(and(eq(partnerServers.partnerId, partner.id), eq(partnerServers.hostActive, false), inArray(servers.status, ['active', 'provisioning_failed']), lt(servers.createdAt, before), or(sql`${partnerServers.lastStartAt} is null`, lt(partnerServers.lastStartAt, before)), or(sql`${partnerServers.lastStopAt} is null`, lt(partnerServers.lastStopAt, before)), or(sql`${partnerServers.cooldownUntil} is null`, lt(partnerServers.cooldownUntil, now))))
      .orderBy(sql`random()`)
      .limit(10);
    let deleted = 0;
    for (const { server, ps } of idle) {
      if (deleted >= 3) break;
      try {
        await carryOver(partner, ps, ps.playerId, now);
        if (server.pteroIdentifier) await purgePartnerBackups(server.pteroIdentifier, true);
        await hardDeleteServer(server);
        await emitPartnerEvent(partner.id, 'server.deleted', { ...eventServer(server, ps), reason: 'idle' }).catch(() => {});
        await audit({ userId: partner.userId, serverId: server.id, actor: 'system', action: 'partner.server_idle_deleted', message: `Partner „${partner.name}“: Server „${server.name}“ nach ${partner.deleteAfterIdleDays} Tagen ohne Start gelöscht` });
        stats.idleDeleted++;
        deleted++;
      } catch {
        /* Panel nicht erreichbar – beim nächsten Lauf */
      }
    }
  }
  return stats;
}
