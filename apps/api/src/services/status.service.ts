/**
 * Netzwerkstatus. Über STATUS_PROVIDER austauschbar:
 *  – internal: eigene Checks (DB, API, Pterodactyl, Nodes, Website, Worker)
 *  – static:   meldet immer "operational" (z. B. für Wartung der Checks)
 * Darüber liegen die Angaben aus dem Admin-Bereich: manueller Status je Komponente,
 * Vorfälle/Wartungen und der Wartungsmodus der Website. Die Uptime kommt aus dem
 * Status-Verlauf (Job „status-history“, alle 5 Minuten).
 */
import { and, desc, eq, gte, isNull, lt, or } from 'drizzle-orm';
import type { ComponentStatus, StatusComponentDTO, StatusDTO, StatusIncidentDTO } from '@chfree/shared';
import { env } from '../env';
import { db, pingDb } from '../db/client';
import { jobRuns, statusChecks, statusIncidents } from '../db/schema';
import { pterodactyl } from '../pterodactyl';
import { getSettings, uptimePercent } from './settings.service';

type RawComponent = Omit<StatusComponentDTO, 'uptime30d'>;
interface RawStatus {
  components: RawComponent[];
  provider: string;
}

export interface StatusProvider {
  readonly name: string;
  getStatus(): Promise<RawStatus>;
}

export const COMPONENTS = {
  freehosting: { name: 'FreeHosting', description: 'Registrierung, Server-Erstellung und Fair-Use-System' },
  pterodactyl: { name: 'Pterodactyl Panel', description: 'Server-Management-Panel' },
  api: { name: 'API', description: 'CraftingHosting.free API und Datenbank' },
  nodes: { name: 'Minecraft Nodes', description: 'Game-Server-Nodes in Deutschland und den Niederlanden' },
  website: { name: 'Website', description: 'craftinghosting.free' },
} as const;

type ComponentId = keyof typeof COMPONENTS;

const SEVERITY: ComponentStatus[] = ['operational', 'maintenance', 'unknown', 'degraded', 'partial_outage', 'major_outage'];
const worst = (list: ComponentStatus[]): ComponentStatus =>
  list.reduce<ComponentStatus>((acc, s) => (SEVERITY.indexOf(s) > SEVERITY.indexOf(acc) ? s : acc), 'operational');

function component(id: ComponentId, status: ComponentStatus, latencyMs: number | null): RawComponent {
  return { id, ...COMPONENTS[id], status, latencyMs, checkedAt: new Date().toISOString() };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T; ms: number } | { ok: false; ms: number }> {
  const started = performance.now();
  try {
    const value = await fn();
    return { ok: true, value, ms: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, ms: Math.round(performance.now() - started) };
  }
}

class InternalStatusProvider implements StatusProvider {
  readonly name = 'internal';

  async getStatus(): Promise<RawStatus> {
    const [dbCheck, pteroCheck, nodesCheck, webCheck, workerCheck] = await Promise.all([
      timed(() => pingDb()),
      timed(() => pterodactyl().ping()),
      timed(() => pterodactyl().listNodes()),
      env.WEB_INTERNAL_URL
        ? timed(async () => {
            const res = await fetch(env.WEB_INTERNAL_URL!, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
            if (res.status >= 500) throw new Error(String(res.status));
            return true;
          })
        : Promise.resolve(null),
      timed(async () => {
        const [last] = await db
          .select({ startedAt: jobRuns.startedAt })
          .from(jobRuns)
          .where(eq(jobRuns.job, 'enforce-fair-use'))
          .orderBy(desc(jobRuns.startedAt))
          .limit(1);
        return last?.startedAt ?? null;
      }),
    ]);

    const api = component('api', dbCheck.ok ? (dbCheck.ms > 500 ? 'degraded' : 'operational') : 'major_outage', dbCheck.ms);
    const panel = component('pterodactyl', pteroCheck.ok ? (pteroCheck.ms > 2000 ? 'degraded' : 'operational') : 'major_outage', pteroCheck.ms);

    let nodesStatus: ComponentStatus = 'unknown';
    if (nodesCheck.ok) {
      const nodes = nodesCheck.value;
      const maintenance = nodes.filter((n) => n.maintenanceMode).length;
      nodesStatus = nodes.length === 0 ? 'unknown' : maintenance === 0 ? 'operational' : maintenance === nodes.length ? 'maintenance' : 'degraded';
    } else if (!pteroCheck.ok) {
      nodesStatus = 'unknown';
    }
    const nodes = component('nodes', nodesStatus, null);

    const website = component('website', webCheck === null ? 'operational' : webCheck.ok ? 'operational' : 'major_outage', webCheck?.ms ?? null);

    // Worker gilt als gesund, wenn der Fair-Use-Job in den letzten 10 Minuten lief.
    const lastRun = workerCheck.ok ? workerCheck.value : null;
    const workerHealthy = !!lastRun && Date.now() - lastRun.getTime() < 10 * 60_000;
    const freehostingInputs: ComponentStatus[] = [api.status, panel.status];
    if (!workerHealthy) freehostingInputs.push('degraded');
    const freehosting = component('freehosting', worst(freehostingInputs), null);

    return { components: [freehosting, panel, api, nodes, website], provider: this.name };
  }
}

class StaticStatusProvider implements StatusProvider {
  readonly name = 'static';
  async getStatus(): Promise<RawStatus> {
    return { components: (Object.keys(COMPONENTS) as ComponentId[]).map((id) => component(id, 'operational', null)), provider: this.name };
  }
}

const provider: StatusProvider = env.STATUS_PROVIDER === 'static' ? new StaticStatusProvider() : new InternalStatusProvider();

let rawCache: { at: number; value: RawStatus } | null = null;
let inflight: Promise<RawStatus> | null = null;

/** Automatische Prüfungen mit 30 Sekunden Cache (verhindert Last durch viele Besucher). */
async function getRawStatus(fresh = false): Promise<RawStatus> {
  if (!fresh && rawCache && Date.now() - rawCache.at < 30_000) return rawCache.value;
  if (!inflight) {
    inflight = provider
      .getStatus()
      .then((value) => {
        rawCache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/* ------------------------------------------------------------ Vorfälle */

type IncidentRow = typeof statusIncidents.$inferSelect;

export function incidentState(i: Pick<IncidentRow, 'startsAt' | 'endsAt' | 'resolvedAt'>, now = new Date()): StatusIncidentDTO['state'] {
  if (i.resolvedAt || (i.endsAt && i.endsAt <= now)) return 'resolved';
  if (i.startsAt > now) return 'scheduled';
  return 'active';
}

export function toIncidentDTO(i: IncidentRow, now = new Date()): StatusIncidentDTO {
  return {
    id: i.id,
    kind: i.kind,
    impact: i.impact,
    components: Array.isArray(i.components) ? i.components : [],
    title: { en: i.titleEn || i.titleDe, de: i.titleDe || i.titleEn },
    message: { en: i.messageEn || i.messageDe, de: i.messageDe || i.messageEn },
    startsAt: i.startsAt.toISOString(),
    endsAt: i.endsAt?.toISOString() ?? null,
    resolvedAt: i.resolvedAt?.toISOString() ?? null,
    state: incidentState(i, now),
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

/** Aktive und geplante Einträge sowie alles, was in den letzten 14 Tagen endete */
async function relevantIncidents(now: Date): Promise<StatusIncidentDTO[]> {
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const rows = await db
    .select()
    .from(statusIncidents)
    .where(or(isNull(statusIncidents.resolvedAt), gte(statusIncidents.resolvedAt, since)))
    .orderBy(desc(statusIncidents.startsAt))
    .limit(50);
  return rows
    .map((r) => toIncidentDTO(r, now))
    .filter((i) => i.state !== 'resolved' || Date.parse(i.resolvedAt ?? i.endsAt ?? i.startsAt) >= since.getTime());
}

/* ------------------------------------------------------------ Uptime */

let uptimeCache: { at: number; value: Record<string, number | null> } | null = null;

async function uptimes(ids: string[]): Promise<Record<string, number | null>> {
  if (uptimeCache && Date.now() - uptimeCache.at < 5 * 60_000) return uptimeCache.value;
  const entries = await Promise.all(ids.map(async (id) => [id, await uptimePercent(id)] as const));
  uptimeCache = { at: Date.now(), value: Object.fromEntries(entries) };
  return uptimeCache.value;
}

/* ------------------------------------------------------------ Gesamtbild */

async function compose(raw: RawStatus, withUptime: boolean): Promise<StatusDTO> {
  const now = new Date();
  const [settings, incidents] = await Promise.all([getSettings(), relevantIncidents(now).catch(() => [] as StatusIncidentDTO[])]);
  const active = incidents.filter((i) => i.state === 'active');
  const up = withUptime ? await uptimes([...raw.components.map((c) => c.id), 'overall']).catch(() => ({}) as Record<string, number | null>) : {};

  const components: StatusComponentDTO[] = raw.components.map((c) => {
    // Reihenfolge (spätere Regel gewinnt): automatische Prüfung → Wartungsmodus → Meldungen → manueller Status
    let status: ComponentStatus = c.status;
    // Wartungsmodus der Website: Prüfungen schlagen während Arbeiten erwartbar fehl – echte Ausfälle bleiben sichtbar
    if (settings.maintenance.enabled && (c.id === 'freehosting' || c.id === 'website') && SEVERITY.indexOf(status) < SEVERITY.indexOf('partial_outage')) {
      status = 'maintenance';
    }
    // Laufende Meldungen mit Auswirkung auf diese Komponente ersetzen die automatische Prüfung
    const impacts = active.filter((i) => i.components.includes(c.id) && i.impact !== 'operational').map((i) => i.impact as ComponentStatus);
    if (impacts.length) status = worst(impacts);
    // Manueller Status aus dem Admin-Bereich hat immer Vorrang
    const override = settings.status.overrides[c.id];
    if (override && override !== 'auto') status = override;
    return { ...c, status, uptime30d: up[c.id] ?? null };
  });

  return {
    overall: worst(components.map((c) => c.status)),
    components,
    incidents,
    provider: raw.provider,
    updatedAt: now.toISOString(),
  };
}

/** Status für die Statusseite (automatische Prüfung max. 30 s alt, Angaben aus dem Admin sofort) */
export async function getStatus(): Promise<StatusDTO> {
  return compose(await getRawStatus(), true);
}

/** Speichert den aktuellen Status im Verlauf (Grundlage für die Uptime). */
export async function recordStatusSnapshot(): Promise<{ components: number }> {
  const status = await compose(await getRawStatus(true), false);
  const checkedAt = new Date();
  await db.insert(statusChecks).values([
    ...status.components.map((c) => ({ component: c.id, status: c.status, checkedAt })),
    { component: 'overall', status: status.overall, checkedAt },
  ]);
  uptimeCache = null;
  return { components: status.components.length };
}

/** Verlauf älter als 90 Tage entfernen */
export async function pruneStatusChecks(): Promise<void> {
  await db.delete(statusChecks).where(lt(statusChecks.checkedAt, new Date(Date.now() - 90 * 86_400_000)));
}


