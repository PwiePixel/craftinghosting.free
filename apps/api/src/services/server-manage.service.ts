/**
 * Server auf der Website verwalten („Meine Server“ → Server): Live-Zustand, Starten/Stoppen/Neustarten, Konsole,
 * Ports. Alles läuft über unsere API – Grenzen und Regeln gelten genauso wie im Panel bzw. per Discord:
 *  – Starten nur, wenn die Fair-Use-Regeln es erlauben (Pause, wöchentliche Offline-Zeit, Ablauf, Sperre)
 *  – keine Aktionen während einer Auszeit, einer Sperre oder während die Software eingerichtet wird
 *  – Minecraft startet erst nach Zustimmung zur EULA
 *  – Ports nur bis zur Obergrenze des Pakets (prüft zusätzlich das Panel)
 * Server der Partner-API sind hier nicht erreichbar.
 */
import { and, eq, isNull, ne } from 'drizzle-orm';
import { mapLimit } from '../jobs/types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { findPlan, formatDateTime, freeHostingConfig, startBlockMessages, type ServerDetailDTO, type ServerLiveDTO, type ServerPortDTO, type ServerPowerAction } from '@chfree/shared';
import { db } from '../db/client';
import { authSessions, servers, users, type Server, type User } from '../db/schema';
import { ApiError, Errors, L } from '../lib/errors';
import { pterodactyl, PterodactylError } from '../pterodactyl';
import { audit } from './audit.service';
import { streamServerConsole } from './partner-console';
import { computeRuntimeState, loadWeekSessions } from './runtime';
import { assertNoTimeout } from './sanction-gate';
import { getOwnedServer, toServerDTO } from './server.service';
import { getSettings } from './settings.service';

const EULA_RE = /^\s*eula\s*=\s*true\s*$/im;

/** Server des Nutzers, der sich hier verwalten lässt (nicht von der Partner-API) */
async function manageable(user: User, id: string): Promise<Server> {
  const server = await getOwnedServer(user, id);
  if (server.partnerId) throw Errors.notFound(L('Server nicht gefunden.', 'Server not found.'));
  return server;
}

/** Für Aktionen: Server läuft im Panel, ist nicht gesperrt und nicht gerade in der Einrichtung */
function assertActionable(server: Server): asserts server is Server & { pteroIdentifier: string; pteroServerId: number } {
  if (server.status !== 'active' || !server.pteroIdentifier || !server.pteroServerId) {
    throw Errors.conflict('server_not_active', L('Dieser Server ist gerade nicht aktiv (gesperrt, abgelaufen oder noch nicht angelegt).', 'This server is not active right now (suspended, expired or not created yet).'));
  }
  if (server.softwareJob) {
    throw Errors.conflict(
      'server_installing',
      server.softwareJob.error
        ? L('Die Server-Software konnte noch nicht eingerichtet werden. Wir versuchen es automatisch erneut.', 'The server software could not be set up yet. We retry automatically.')
        : L('Die Server-Software wird gerade eingerichtet. Bitte gleich noch einmal versuchen.', 'The server software is being set up. Please try again shortly.'),
    );
  }
}

/*
 * Panel-Kontingent schonen: Website-Abfragen (Live-Werte, Ports, EULA-Datei) gehen über dieselben Panel-Keys wie
 * unsere Jobs (Stopps, Sperren). Deshalb kurz zwischenspeichern und insgesamt begrenzen – ist das Kontingent der
 * Website erschöpft, gibt es den letzten bekannten Stand statt einer neuen Abfrage. Aktionen (Start/Stopp, Ports)
 * sind davon ausgenommen; sie sind je Route begrenzt.
 */
const WEB_PANEL_CALLS_PER_MINUTE = 180;
const panelWindow = { start: 0, used: 0 };
function takeWebPanelCall(): boolean {
  const now = Date.now();
  if (now - panelWindow.start > 60_000) {
    panelWindow.start = now;
    panelWindow.used = 0;
  }
  if (panelWindow.used >= WEB_PANEL_CALLS_PER_MINUTE) return false;
  panelWindow.used++;
  return true;
}
const liveCache = new Map<string, { at: number; value: ServerLiveDTO | null }>();
const portsCache = new Map<string, { at: number; value: ServerDetailDTO['ports'] }>();
const LIVE_TTL_MS = 2500;
const PORTS_TTL_MS = 15_000;
const trim = (map: Map<string, unknown>) => {
  if (map.size > 2000) map.clear();
};

const panelDown = () => Errors.unavailable(L('Das Panel ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.', 'The panel cannot be reached right now. Please try again shortly.'));

async function live(server: Server, fresh = false): Promise<ServerLiveDTO | null> {
  if (!server.pteroIdentifier || server.status !== 'active') return null;
  const hit = liveCache.get(server.id);
  if (!fresh && hit && Date.now() - hit.at < LIVE_TTL_MS) return hit.value;
  if (!fresh && !takeWebPanelCall()) return hit?.value ?? null;
  // Panel gerade nicht erreichbar oder ausgelastet: den letzten bekannten Stand weiter zeigen statt „kein Wert“
  const value = (await liveFromPanel(server)) ?? hit?.value ?? null;
  trim(liveCache);
  liveCache.set(server.id, { at: Date.now(), value });
  return value;
}

async function liveFromPanel(server: Server & {}): Promise<ServerLiveDTO | null> {
  if (!server.pteroIdentifier) return null;
  try {
    const r = await pterodactyl().getResources(server.pteroIdentifier);
    return {
      state: r.isSuspended ? 'offline' : r.state,
      cpuPercent: Math.round(r.cpuAbsolute * 10) / 10,
      memoryBytes: r.memoryBytes,
      memoryLimitBytes: server.memoryMb * 1024 * 1024,
      diskBytes: r.diskBytes,
      uptimeMs: r.uptimeMs,
    };
  } catch {
    return null;
  }
}

async function ports(server: Server, fresh = false): Promise<ServerDetailDTO['ports']> {
  if (!server.pteroIdentifier || server.status !== 'active') return null;
  const hit = portsCache.get(server.id);
  if (!fresh && hit && Date.now() - hit.at < PORTS_TTL_MS) return hit.value;
  if (!fresh && !takeWebPanelCall()) return hit?.value ?? null;
  const value = await portsFromPanel(server);
  trim(portsCache);
  portsCache.set(server.id, { at: Date.now(), value });
  return value;
}

async function portsFromPanel(server: Server): Promise<ServerDetailDTO['ports']> {
  if (!server.pteroIdentifier) return null;
  try {
    const list = await pterodactyl().listServerPorts(server.pteroIdentifier);
    const plan = findPlan(await getSettings(), server.planId);
    const items: ServerPortDTO[] = list.map((p) => ({ id: p.id, host: p.alias || p.ip, port: p.port, notes: p.notes, primary: p.primary }));
    return { items, limit: Math.max(1, plan?.allocations ?? 1) };
  } catch {
    return null;
  }
}

async function eulaAccepted(server: Server): Promise<boolean> {
  if (server.kind !== 'minecraft') return true;
  if (server.eulaAcceptedAt) return true;
  if (!server.pteroIdentifier || !takeWebPanelCall()) return false;
  const text = await pterodactyl()
    .readFile(server.pteroIdentifier, '/eula.txt')
    .catch(() => null);
  const accepted = !!text && EULA_RE.test(text);
  // Steht die Zustimmung schon in der Datei (z. B. im Panel bestätigt), merken – dann muss sie nicht wieder gelesen werden
  if (accepted) await db.update(servers).set({ eulaAcceptedAt: new Date() }).where(and(eq(servers.id, server.id), isNull(servers.eulaAcceptedAt)));
  return accepted;
}

/** Nur die Live-Werte eines Servers (für Diagramme, die alle paar Sekunden nachladen) */
export async function getServerLive(user: User, id: string): Promise<ServerLiveDTO | null> {
  return live(await manageable(user, id));
}

/** Live-Werte aller eigenen, aktiven Server (Übersicht „Meine Server“) – höchstens 4 Panel-Abfragen gleichzeitig */
export async function listServersLive(user: User): Promise<Record<string, ServerLiveDTO | null>> {
  const rows = await db
    .select()
    .from(servers)
    .where(and(eq(servers.userId, user.id), eq(servers.status, 'active'), isNull(servers.partnerId)))
    .limit(50);
  const out: Record<string, ServerLiveDTO | null> = {};
  await mapLimit(rows, 4, async (server) => {
    out[server.id] = await live(server);
  });
  return out;
}

/** `withPorts`: Ports mitliefern (nur für den Reiter „Ports“ – spart Panel-Abfragen) */
export async function getServerDetail(user: User, id: string, opts: { withPorts?: boolean; fresh?: boolean } = {}): Promise<ServerDetailDTO> {
  const server = await manageable(user, id);
  const [dto, liveState, portList, eula] = await Promise.all([
    toServerDTO(server, user),
    live(server, opts.fresh),
    opts.withPorts ? ports(server, opts.fresh) : Promise.resolve(null),
    eulaAccepted(server),
  ]);
  return { server: dto, live: liveState, ports: portList, eulaAccepted: eula };
}

/** Starten, Stoppen, Neustarten, Beenden – mit denselben Regeln wie überall sonst */
export async function serverPower(user: User, id: string, action: ServerPowerAction, opts: { acceptEula?: boolean }, ip?: string): Promise<ServerDetailDTO> {
  assertNoTimeout(user);
  const server = await manageable(user, id);
  assertActionable(server);
  const ptero = pterodactyl();
  const res = await ptero.getResources(server.pteroIdentifier).catch(() => {
    throw panelDown();
  });
  if (res.isSuspended) throw Errors.conflict('server_suspended', L('Dieser Server ist gesperrt.', 'This server is suspended.'));
  if (res.state === 'installing') throw Errors.conflict('server_installing', L('Der Server wird gerade installiert. Bitte gleich noch einmal versuchen.', 'The server is being installed. Please try again shortly.'));

  const starts = action === 'start' || (action === 'restart' && res.state === 'offline');
  if (starts) {
    if (res.state === 'running' || res.state === 'starting') return getServerDetail(user, id);
    // Fair-Use: Pause, wöchentliche Offline-Zeit, Ablauf … (wie beim Start im Panel bzw. per Discord)
    const now = new Date();
    const settings = await getSettings();
    const { startGate } = computeRuntimeState({ ...server, powerState: res.state }, user, await loadWeekSessions(server.id, now), now, settings.products[server.kind].fairUse);
    if (!startGate.allowed && startGate.reason !== 'already_online') {
      const why = startBlockMessages[startGate.reason ?? 'not_active'];
      const tz = freeHostingConfig.fairUse.timezone;
      const until = startGate.until;
      throw new ApiError(
        409,
        'start_blocked',
        L(`${why.de}${until ? ` Wieder möglich ab ${formatDateTime(until, tz, 'de')}.` : ''}`, `${why.en}${until ? ` Possible again from ${formatDateTime(until, tz, 'en')}.` : ''}`),
      );
    }
    // Minecraft-EULA: Zustimmung beim Bestellen oder hier – sonst würde der Start sofort wieder enden
    if (server.kind === 'minecraft' && !server.eulaAcceptedAt && !(await eulaAccepted(server))) {
      if (!opts.acceptEula) {
        throw new ApiError(409, 'eula_required', L('Bitte stimme vor dem ersten Start der Minecraft-EULA zu.', 'Please agree to the Minecraft EULA before the first start.'));
      }
      await db.update(servers).set({ eulaAcceptedAt: now }).where(eq(servers.id, server.id));
      await audit({ userId: user.id, serverId: server.id, actor: 'user', action: 'server.eula_accepted', message: `Minecraft-EULA für „${server.name}“ auf der Website akzeptiert`, ip });
    }
    if (server.kind === 'minecraft') {
      await ptero.writeFile(server.pteroIdentifier, '/eula.txt', '# Zugestimmt auf CraftingHosting.free\neula=true\n').catch(() => {
        throw panelDown();
      });
    }
  }

  const signal = starts ? 'start' : action;
  if (signal === 'stop' && (res.state === 'offline' || res.state === 'stopping')) return getServerDetail(user, id);
  if (signal === 'kill' && res.state === 'offline') return getServerDetail(user, id);
  try {
    await ptero.sendPowerSignal(server.pteroIdentifier, signal);
  } catch (err) {
    if (err instanceof PterodactylError && err.status === 409) throw Errors.conflict('server_busy', L('Der Server ist gerade beschäftigt (z. B. Installation oder Backup). Bitte gleich noch einmal versuchen.', 'The server is busy right now (e.g. installing or a backup). Please try again shortly.'));
    throw panelDown();
  }
  const next = signal === 'start' ? 'starting' : signal === 'kill' ? 'offline' : signal === 'stop' ? 'stopping' : 'starting';
  await db.update(servers).set({ powerState: next, powerStateAt: new Date() }).where(and(eq(servers.id, server.id), ne(servers.status, 'deleted')));
  const label = { start: 'gestartet', stop: 'gestoppt', restart: 'neu gestartet', kill: 'hart beendet' }[signal];
  await audit({ userId: user.id, serverId: server.id, actor: 'user', action: `web.server_${signal}`, message: `Server „${server.name}“ auf der Website ${label}`, ip });
  liveCache.delete(server.id);
  return getServerDetail(user, id, { fresh: true });
}

/** Befehl in die Konsole (wie im Panel) – nur, solange der Server läuft */
export async function serverCommand(user: User, id: string, command: string): Promise<void> {
  assertNoTimeout(user);
  const server = await manageable(user, id);
  assertActionable(server);
  const res = await pterodactyl()
    .getResources(server.pteroIdentifier)
    .catch(() => {
      throw panelDown();
    });
  if (res.state !== 'running' && res.state !== 'starting') throw Errors.conflict('server_offline', L('Der Server ist aus – Befehle gehen nur, während er läuft.', 'The server is offline – commands only work while it is running.'));
  await pterodactyl()
    .sendCommand(server.pteroIdentifier, command)
    .catch(() => {
      throw panelDown();
    });
}

export async function addServerPort(user: User, id: string, ip?: string): Promise<ServerDetailDTO> {
  assertNoTimeout(user);
  const server = await manageable(user, id);
  assertActionable(server);
  const current = await ports(server, true);
  if (!current) throw panelDown();
  if (current.items.length >= current.limit) {
    throw Errors.conflict('port_limit', L(`Dein Paket erlaubt ${current.limit} Port${current.limit === 1 ? '' : 's'} – mehr geht nicht.`, `Your plan allows ${current.limit} port${current.limit === 1 ? '' : 's'} – no more are possible.`));
  }
  let port;
  try {
    port = await pterodactyl().addServerPort(server.pteroIdentifier);
  } catch (err) {
    if (err instanceof PterodactylError && err.status < 500) {
      throw Errors.conflict('port_unavailable', L('Gerade lässt sich kein weiterer Port zuweisen (Obergrenze erreicht oder keine freien Ports auf der Node). Bitte öffne ein Ticket, wenn das so bleibt.', 'No further port can be assigned right now (limit reached or no free ports on the node). Please open a ticket if this persists.'));
    }
    throw panelDown();
  }
  await audit({ userId: user.id, serverId: server.id, actor: 'user', action: 'web.port_added', message: `Port ${port.port} für „${server.name}“ hinzugefügt`, ip });
  return getServerDetail(user, id, { withPorts: true, fresh: true });
}

export async function removeServerPort(user: User, id: string, allocationId: number, ip?: string): Promise<ServerDetailDTO> {
  assertNoTimeout(user);
  const server = await manageable(user, id);
  assertActionable(server);
  const current = await ports(server, true);
  const target = current?.items.find((p) => p.id === allocationId);
  if (!target) throw Errors.notFound(L('Diesen Port gibt es bei diesem Server nicht.', 'This port does not exist on this server.'));
  if (target.primary) throw Errors.conflict('port_primary', L('Der Hauptport lässt sich nicht entfernen.', 'The main port cannot be removed.'));
  try {
    await pterodactyl().removeServerPort(server.pteroIdentifier, allocationId);
  } catch (err) {
    if (err instanceof PterodactylError && err.status < 500) throw Errors.conflict('port_in_use', L('Dieser Port lässt sich gerade nicht entfernen.', 'This port cannot be removed right now.'));
    throw panelDown();
  }
  await audit({ userId: user.id, serverId: server.id, actor: 'user', action: 'web.port_removed', message: `Port ${target.port} von „${server.name}“ entfernt`, ip });
  return getServerDetail(user, id, { withPorts: true, fresh: true });
}

/** Live-Konsole (Server-Sent Events) – endet, sobald der Server nicht mehr diesem Nutzer gehört oder nicht mehr aktiv ist */
export async function streamWebConsole(user: User, sessionId: string | null, id: string, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const server = await manageable(user, id);
  assertActionable(server);
  await streamServerConsole(
    {
      owner: `user:${user.id}`,
      maxPerOwner: 6,
      server: { id: server.id, pteroIdentifier: server.pteroIdentifier },
      // Endet, wenn der Server nicht mehr aktiv ist oder dem Nutzer gehört, das Konto gesperrt ist oder die Sitzung
      // beendet wurde (Abmelden, „überall abmelden“, Passwortwechsel)
      stillAllowed: async () => {
        const [row] = await db.select({ status: servers.status, userId: servers.userId }).from(servers).where(eq(servers.id, server.id)).limit(1);
        if (!row || row.status !== 'active' || row.userId !== user.id) return false;
        const [account] = await db.select({ status: users.status }).from(users).where(eq(users.id, user.id)).limit(1);
        if (account?.status !== 'active') return false;
        if (!sessionId) return false;
        const [session] = await db.select({ expiresAt: authSessions.expiresAt }).from(authSessions).where(eq(authSessions.id, sessionId)).limit(1);
        return !!session && session.expiresAt > new Date();
      },
    },
    request,
    reply,
  );
}
