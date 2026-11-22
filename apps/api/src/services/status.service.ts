/**
 * Netzwerkstatus. Welche Gruppen und Komponenten die Statusseite zeigt, legt der Admin-Bereich fest
 * (Einstellungen → status). Jede Komponente hat eine Quelle:
 *  – service/api/panel/nodes/node/website/http: automatische Prüfung
 *  – manual: kein Check, der Status wird im Admin-Bereich gesetzt
 * Mit STATUS_PROVIDER=static melden alle Prüfungen „operational“ (z. B. für Wartung der Checks).
 * Darüber liegen: Wartungsmodus der Website, Vorfälle/Wartungen und der manuelle Status je Komponente.
 * Verlauf und Uptime kommen aus dem Status-Verlauf (Job „status-history“, alle 5 Minuten).
 * Ein Balken steht je nach Einstellung für einen Kalendertag oder für eine Stunde (dann rückt der Verlauf stündlich weiter).
 */
import { count, desc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';
import {
  freeHostingConfig,
  getTimeZoneOffset,
  rangeStateFor,
  statusBarCount,
  statusCategory,
  type ComponentStatus,
  type SiteSettings,
  type StatusCategory,
  type StatusComponentDTO,
  type StatusComponentSetting,
  type StatusDTO,
  type StatusDayDTO,
  type StatusDayState,
  type StatusIncidentDTO,
  type StatusRangeSetting,
} from '@chfree/shared';
import { env } from '../env';
import { db, pingDb } from '../db/client';
import { jobRuns, statusChecks, statusIncidents } from '../db/schema';
import { pterodactyl, PterodactylError } from '../pterodactyl';
import type { PteroNode } from '../pterodactyl/types';
import { getSettings } from './settings.service';

interface CheckResult {
  status: ComponentStatus;
  latencyMs: number | null;
}
interface RawStatus {
  results: Record<string, CheckResult>;
  provider: string;
  checkedAt: string;
}

const SEVERITY: ComponentStatus[] = ['operational', 'maintenance', 'unknown', 'degraded', 'partial_outage', 'major_outage'];
const worst = (list: ComponentStatus[]): ComponentStatus =>
  list.reduce<ComponentStatus>((acc, s) => (SEVERITY.indexOf(s) > SEVERITY.indexOf(acc) ? s : acc), 'operational');

/** Gesetzt, wenn während der laufenden Prüfung das Anfrage-Limit des Panels griff (429) – das ist kein Ausfall */
let panelBusyDuringCheck = false;

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T; ms: number } | { ok: false; ms: number }> {
  const started = performance.now();
  try {
    const value = await fn();
    return { ok: true, value, ms: Math.round(performance.now() - started) };
  } catch (err) {
    if (err instanceof PterodactylError && err.status === 429) panelBusyDuringCheck = true;
    return { ok: false, ms: Math.round(performance.now() - started) };
  }
}

/** Antwortet die Adresse überhaupt? Jede HTTP-Antwort unter 500 zählt als erreichbar. */
async function reachable(url: string, method: 'HEAD' | 'GET', failOn5xx: boolean): Promise<true> {
  const res = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(5000) });
  await res.body?.cancel().catch(() => undefined);
  if (failOn5xx && res.status >= 500) throw new Error(String(res.status));
  return true;
}

type NodeState = 'up' | 'maintenance' | 'down';

/** Führt genau die Prüfungen aus, die von den eingerichteten Komponenten gebraucht werden. */
async function runChecks(settings: SiteSettings['status'], privateNodeIds: number[]): Promise<Record<string, CheckResult>> {
  const used = new Set(settings.components.map((c) => c.source));
  const needs = (...sources: StatusComponentSetting['source'][]) => sources.some((s) => used.has(s));
  const ptero = pterodactyl();

  const [dbCheck, panelCheck, nodesCheck, webCheck, workerCheck] = await Promise.all([
    needs('api', 'service') ? timed(() => pingDb()) : null,
    // Eine Abfrage für beides: Die Node-Liste zeigt auch, ob das Panel antwortet (spart eine Abfrage je Prüfung)
    needs('panel', 'service') && !needs('nodes', 'node') ? timed(() => ptero.ping()) : null,
    needs('nodes', 'node') ? timed(() => ptero.listNodes()) : null,
    needs('website') && env.WEB_INTERNAL_URL ? timed(() => reachable(env.WEB_INTERNAL_URL!, 'HEAD', true)) : null,
    needs('service')
      ? timed(async () => {
          const [last] = await db
            .select({ startedAt: jobRuns.startedAt })
            .from(jobRuns)
            .where(eq(jobRuns.job, 'enforce-fair-use'))
            .orderBy(desc(jobRuns.startedAt))
            .limit(1);
          return last?.startedAt ?? null;
        })
      : null,
  ]);

  const panelSource = panelCheck ?? (needs('panel', 'service') ? nodesCheck : null);
  // Nodes: Wartungsmodus aus dem Panel, dazu (wenn eingeschaltet) ein direkter Ping auf Wings
  // Private Nodes gehören nicht zum Angebot – sie zählen nicht in den Sammelstatus „Server-Nodes“ (einzeln beobachten geht weiter)
  const allNodes: PteroNode[] = nodesCheck?.ok ? nodesCheck.value : [];
  const nodes = allNodes.filter((n) => !privateNodeIds.includes(n.id));
  const wanted = allNodes.filter((n) => (used.has('nodes') && !privateNodeIds.includes(n.id)) || settings.components.some((c) => c.source === 'node' && c.target === String(n.id)));
  const nodeStates = new Map<number, { state: NodeState; ms: number | null }>();
  await Promise.all(
    wanted.map(async (n) => {
      if (n.maintenanceMode) return void nodeStates.set(n.id, { state: 'maintenance', ms: null });
      if (!settings.pingNodes || !n.daemonUrl) return void nodeStates.set(n.id, { state: 'up', ms: null });
      // Wings antwortet ohne Anmeldung mit 401 – das genügt als Lebenszeichen
      const ping = await timed(() => reachable(n.daemonUrl!, 'GET', false));
      nodeStates.set(n.id, { state: ping.ok ? 'up' : 'down', ms: ping.ms });
    }),
  );

  const api: CheckResult | null = dbCheck && { status: dbCheck.ok ? (dbCheck.ms > 500 ? 'degraded' : 'operational') : 'major_outage', latencyMs: dbCheck.ms };
  const panel: CheckResult | null = panelSource && { status: panelSource.ok ? (panelSource.ms > 2000 ? 'degraded' : 'operational') : 'major_outage', latencyMs: panelSource.ms };

  const httpChecks = new Map<string, CheckResult>();
  await Promise.all(
    settings.components
      .filter((c) => c.source === 'http' && c.target)
      .map(async (c) => {
        const check = await timed(() => reachable(c.target, 'GET', true));
        httpChecks.set(c.id, { status: check.ok ? (check.ms > 3000 ? 'degraded' : 'operational') : 'major_outage', latencyMs: check.ms });
      }),
  );

  const one = (c: StatusComponentSetting): CheckResult => {
    switch (c.source) {
      case 'api':
        return api ?? { status: 'unknown', latencyMs: null };
      case 'panel':
        return panel ?? { status: 'unknown', latencyMs: null };
      case 'service': {
        // Worker gilt als gesund, wenn der Fair-Use-Job in den letzten 10 Minuten lief.
        const lastRun = workerCheck?.ok ? workerCheck.value : null;
        const workerHealthy = !!lastRun && Date.now() - lastRun.getTime() < 10 * 60_000;
        const inputs: ComponentStatus[] = [api?.status ?? 'unknown', panel?.status ?? 'unknown'];
        if (!workerHealthy) inputs.push('degraded');
        return { status: worst(inputs), latencyMs: null };
      }
      case 'website':
        return { status: !webCheck || webCheck.ok ? 'operational' : 'major_outage', latencyMs: webCheck?.ms ?? null };
      case 'nodes': {
        if (!nodesCheck?.ok || nodes.length === 0) return { status: 'unknown', latencyMs: null };
        const states = nodes.map((n) => nodeStates.get(n.id)?.state ?? 'up');
        const down = states.filter((s) => s === 'down').length;
        const maintenance = states.filter((s) => s === 'maintenance').length;
        const status: ComponentStatus =
          down === states.length
            ? 'major_outage'
            : down > 0
              ? 'partial_outage'
              : maintenance === states.length
                ? 'maintenance'
                : maintenance > 0
                  ? 'degraded'
                  : 'operational';
        return { status, latencyMs: null };
      }
      case 'node': {
        const node = allNodes.find((n) => String(n.id) === c.target);
        const state = node ? nodeStates.get(node.id) : undefined;
        if (!node || !state) return { status: 'unknown', latencyMs: null };
        return { status: state.state === 'up' ? 'operational' : state.state === 'maintenance' ? 'maintenance' : 'major_outage', latencyMs: state.ms };
      }
      case 'http':
        return httpChecks.get(c.id) ?? { status: 'unknown', latencyMs: null };
      case 'manual':
        return { status: 'operational', latencyMs: null };
    }
  };
  return Object.fromEntries(settings.components.map((c) => [c.id, one(c)]));
}

let rawCache: { at: number; key: string; value: RawStatus } | null = null;
let inflight: { key: string; promise: Promise<RawStatus> } | null = null;

/** Automatische Prüfungen mit 55 Sekunden Cache (verhindert Last durch viele Besucher und schont das Anfrage-Limit des Panels). */
async function getRawStatus(settings: SiteSettings['status'], privateNodeIds: number[], fresh = false): Promise<RawStatus> {
  // Ändert der Admin die Komponenten, gilt der alte Stand nicht mehr
  const key = JSON.stringify([settings.pingNodes, privateNodeIds, settings.components.map((c) => [c.id, c.source, c.target])]);
  if (!fresh && rawCache && rawCache.key === key && Date.now() - rawCache.at < 55_000) return rawCache.value;
  if (!inflight || inflight.key !== key) {
    const isStatic = env.STATUS_PROVIDER === 'static';
    const promise = (
      isStatic
        ? Promise.resolve(Object.fromEntries(settings.components.map((c) => [c.id, { status: 'operational', latencyMs: null } as CheckResult])))
        : (() => {
            panelBusyDuringCheck = false;
            return runChecks(settings, privateNodeIds);
          })()
    )
      .then((results) => {
        // Panel ausgelastet (429): Es antwortet – kein Ausfall. Den letzten bekannten Stand weiter zeigen.
        if (panelBusyDuringCheck && rawCache && rawCache.key === key) return rawCache.value;
        const value: RawStatus = { results, provider: isStatic ? 'static' : 'internal', checkedAt: new Date().toISOString() };
        rawCache = { at: Date.now(), key, value };
        return value;
      })
      .finally(() => {
        if (inflight?.promise === promise) inflight = null;
      });
    inflight = { key, promise };
  }
  return inflight.promise;
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

/* ------------------------------------------------------------ Verlauf */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const HISTORY_DAYS = 90;

type BarUnit = 'day' | 'hour';

interface BucketCounts {
  total: number;
  outage: number;
  degraded: number;
  maintenance: number;
}
/** Komponente → Abschnitt (Tag bzw. Stunde, fortlaufend gezählt) → Messungen */
type History = Map<string, Map<number, BucketCounts>>;

let historyCache: { at: number; key: string; value: History } | null = null;

/**
 * Messungen je Komponente und Abschnitt, 5 Minuten Cache.
 * Tage folgen der Zeitzone der Website (`offset`), Stunden sind die vollen Stunden der Uhr.
 */
async function loadHistory(unit: BarUnit, offset: number, current: number, bars: number): Promise<History> {
  const key = `${unit}:${offset}:${current}:${bars}`;
  if (historyCache && historyCache.key === key && Date.now() - historyCache.at < 5 * 60_000) return historyCache.value;
  const size = unit === 'hour' ? HOUR_MS : DAY_MS;
  const shift = unit === 'hour' ? 0 : offset;
  const bucket = sql<number>`cast((${statusChecks.checkedAt} + ${sql.raw(String(shift))}) / ${sql.raw(String(size))} as integer)`;
  const rows = await db
    .select({ component: statusChecks.component, bucket, status: statusChecks.status, n: count() })
    .from(statusChecks)
    .where(gte(statusChecks.checkedAt, new Date((current - bars + 1) * size - shift)))
    .groupBy(statusChecks.component, bucket, statusChecks.status);
  const value: History = new Map();
  for (const r of rows) {
    const category = statusCategory(r.status);
    if (category === 'none') continue;
    let buckets = value.get(r.component);
    if (!buckets) value.set(r.component, (buckets = new Map()));
    let c = buckets.get(Number(r.bucket));
    if (!c) buckets.set(Number(r.bucket), (c = { total: 0, outage: 0, degraded: 0, maintenance: 0 }));
    const n = Number(r.n);
    c.total += n;
    if (category !== 'operational') c[category] += n;
  }
  historyCache = { at: Date.now(), key, value };
  return value;
}

const BAR_SEVERITY: StatusDayState[] = ['none', 'operational', 'maintenance', 'degraded', 'outage'];
const round2 = (v: number) => Math.floor(v * 100) / 100;

/**
 * Farbe eines Abschnitts: Ein einzelner Aussetzer (eine Messung, 5 Minuten) färbt ihn nicht um.
 * Ab zwei Messungen mit Ausfall ist er rot, ab zwei auffälligen Messungen orange.
 */
function bucketState(c: BucketCounts | undefined): StatusDayState {
  if (!c || c.total === 0) return 'none';
  if (c.outage >= 2) return 'outage';
  if (c.outage + c.degraded >= 2) return 'degraded';
  if (c.maintenance >= 1) return 'maintenance';
  return 'operational';
}

/**
 * Baut die Balken einer Komponente und die Verfügbarkeit über genau diesen Zeitraum
 * (Durchschnitt aller Abschnitte mit Daten – bei 90 Stunden-Balken also die letzten 90 Stunden).
 */
function buildBars(
  component: string,
  measured: Map<number, BucketCounts> | undefined,
  corrections: Record<string, StatusCategory> | undefined,
  ranges: StatusRangeSetting[],
  unit: BarUnit,
  offset: number,
  current: number,
  count: number,
  status: ComponentStatus,
): { days: StatusDayDTO[]; uptime: number | null } {
  const out: StatusDayDTO[] = [];
  let sum = 0;
  let withData = 0;
  for (let idx = current - count + 1; idx <= current; idx++) {
    // Kalendertag des Abschnitts (Zeitzone der Website) – Korrekturen und nachgetragene Zeiträume gelten tageweise
    const day = unit === 'hour' ? new Date(idx * HOUR_MS + offset).toISOString().slice(0, 10) : new Date(idx * DAY_MS).toISOString().slice(0, 10);
    const date = unit === 'hour' ? new Date(idx * HOUR_MS).toISOString() : day;
    const c = measured?.get(idx);
    let state = bucketState(c);
    let uptime = c && c.total > 0 ? ((c.total - c.outage) / c.total) * 100 : null;
    // Aus dem Admin-Bereich: nachgetragener Zeitraum, darüber die Korrektur eines einzelnen Tages
    // (z. B. Zeit vor Beginn der Messung, Fehlalarm oder nachgetragener Ausfall)
    const fixed = corrections?.[day] ?? rangeStateFor(ranges, component, day, uptime !== null);
    if (fixed) {
      state = fixed;
      // „Ausfall“ färbt den Abschnitt rot, die Prozentzahl folgt weiter den Messungen (ohne Messung zählt er als ausgefallen).
      // Jeder andere Zustand erklärt ihn für verfügbar.
      uptime = fixed === 'outage' ? (uptime ?? 0) : 100;
    }
    // Im laufenden Abschnitt zählt zusätzlich der aktuelle Zustand – ein laufender Ausfall ist sofort sichtbar
    if (idx === current) {
      const now = statusCategory(status);
      if (BAR_SEVERITY.indexOf(now) > BAR_SEVERITY.indexOf(state)) state = now;
      if (uptime === null && now !== 'none') uptime = now === 'outage' ? 0 : 100;
    }
    if (uptime !== null) {
      sum += uptime;
      withData++;
    }
    out.push({ date, state, uptime: uptime === null ? null : round2(uptime) });
  }
  return { days: out, uptime: withData ? round2(sum / withData) : null };
}

/* ------------------------------------------------------------ Gesamtbild */

interface Composed {
  dto: StatusDTO;
  /** Alle Komponenten inkl. ausgeblendeter – Grundlage für den Verlauf */
  all: { id: string; status: ComponentStatus }[];
}

async function compose(fresh: boolean, withHistory: boolean): Promise<Composed> {
  const now = new Date();
  const settings = await getSettings();
  const cfg = settings.status;
  const [raw, incidents] = await Promise.all([getRawStatus(cfg, settings.privateNodeIds, fresh), relevantIncidents(now).catch(() => [] as StatusIncidentDTO[])]);
  const active = incidents.filter((i) => i.state === 'active');

  const offset = getTimeZoneOffset(now, freeHostingConfig.fairUse.timezone);
  // Ein Balken = ein Kalendertag (Zeitzone der Website) oder eine Stunde
  const unit: BarUnit = cfg.page.unit;
  const bars = statusBarCount(cfg.page);
  const current = unit === 'hour' ? Math.floor(now.getTime() / HOUR_MS) : Math.floor((now.getTime() + offset) / DAY_MS);
  const history = withHistory ? await loadHistory(unit, offset, current, bars).catch(() => new Map() as History) : null;

  const components: StatusComponentDTO[] = cfg.components.map((c) => {
    // Reihenfolge (spätere Regel gewinnt): automatische Prüfung → Wartungsmodus → Meldungen → manueller Status
    const check = raw.results[c.id] ?? { status: 'unknown' as ComponentStatus, latencyMs: null };
    let status = check.status;
    // Wartungsmodus der Website: Prüfungen schlagen während Arbeiten erwartbar fehl – echte Ausfälle bleiben sichtbar
    if (settings.maintenance.enabled && (c.source === 'service' || c.source === 'website') && SEVERITY.indexOf(status) < SEVERITY.indexOf('partial_outage')) {
      status = 'maintenance';
    }
    // Laufende Meldungen mit Auswirkung auf diese Komponente ersetzen die automatische Prüfung
    const impacts = active.filter((i) => i.components.includes(c.id) && i.impact !== 'operational').map((i) => i.impact as ComponentStatus);
    if (impacts.length) status = worst(impacts);
    // Manueller Status aus dem Admin-Bereich hat immer Vorrang
    const override = cfg.overrides[c.id];
    if (override && override !== 'auto') status = override;
    const h = history ? buildBars(c.id, history.get(c.id), cfg.history[c.id], cfg.ranges, unit, offset, current, bars, status) : { days: [], uptime: null };
    return {
      id: c.id,
      group: c.group,
      name: c.name,
      subtitle: c.subtitle,
      operationalLabel: c.operationalLabel,
      status,
      latencyMs: check.latencyMs,
      checkedAt: raw.checkedAt,
      uptime: h.uptime,
      days: h.days,
    };
  });

  const hidden = new Set(cfg.components.filter((c) => !c.visible).map((c) => c.id));
  const visible = components.filter((c) => !hidden.has(c.id));
  // Meldungen nennen nur Komponenten, die es (noch) gibt und die sichtbar sind
  const known = new Set(visible.map((c) => c.id));
  return {
    dto: {
      overall: worst(visible.map((c) => c.status)),
      page: cfg.page,
      groups: cfg.groups.filter((g) => visible.some((c) => c.group === g.id)),
      components: visible,
      incidents: incidents.map((i) => ({ ...i, components: i.components.filter((id) => known.has(id)) })),
      provider: raw.provider,
      updatedAt: now.toISOString(),
    },
    all: components.map((c) => ({ id: c.id, status: c.status })),
  };
}

/** Status für die Statusseite (automatische Prüfung max. 30 s alt, Angaben aus dem Admin sofort) */
export async function getStatus(): Promise<StatusDTO> {
  return (await compose(false, true)).dto;
}

/** Aktueller Stand ohne Verlauf – Grundlage für die Status-Meldungen im Discord */
export async function getStatusOverview(): Promise<StatusDTO> {
  return (await compose(false, false)).dto;
}

/** Speichert den aktuellen Status im Verlauf (Grundlage für Tagesbalken und Uptime). */
export async function recordStatusSnapshot(): Promise<{ components: number }> {
  const { dto, all } = await compose(true, false);
  const checkedAt = new Date();
  await db.insert(statusChecks).values([...all.map((c) => ({ component: c.id, status: c.status, checkedAt })), { component: 'overall', status: dto.overall, checkedAt }]);
  historyCache = null;
  return { components: all.length };
}

/** Verlauf älter als 90 Tage entfernen */
export async function pruneStatusChecks(): Promise<void> {
  await db.delete(statusChecks).where(lt(statusChecks.checkedAt, new Date(Date.now() - (HISTORY_DAYS + 1) * DAY_MS)));
}
