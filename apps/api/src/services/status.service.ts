/**
 * Netzwerkstatus. Welche Gruppen und Komponenten die Statusseite zeigt, legt der Admin-Bereich fest
 * (Einstellungen → status). Jede Komponente hat eine Quelle:
 *  – service/api/panel/nodes/node/website/http: automatische Prüfung
 *  – manual: kein Check, der Status wird im Admin-Bereich gesetzt
 * Mit STATUS_PROVIDER=static melden alle Prüfungen „operational“ (z. B. für Wartung der Checks).
 * Darüber liegen: Wartungsmodus der Website, Vorfälle/Wartungen und der manuelle Status je Komponente.
 * Verlauf und Uptime kommen aus dem Status-Verlauf (Job „status-history“, alle 5 Minuten).
 */
import { count, desc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';
import {
  freeHostingConfig,
  getTimeZoneOffset,
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
} from '@chfree/shared';
import { env } from '../env';
import { db, pingDb } from '../db/client';
import { jobRuns, statusChecks, statusIncidents } from '../db/schema';
import { pterodactyl } from '../pterodactyl';
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

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T; ms: number } | { ok: false; ms: number }> {
  const started = performance.now();
  try {
    const value = await fn();
    return { ok: true, value, ms: Math.round(performance.now() - started) };
  } catch {
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
async function runChecks(settings: SiteSettings['status']): Promise<Record<string, CheckResult>> {
  const used = new Set(settings.components.map((c) => c.source));
  const needs = (...sources: StatusComponentSetting['source'][]) => sources.some((s) => used.has(s));
  const ptero = pterodactyl();

  const [dbCheck, panelCheck, nodesCheck, webCheck, workerCheck] = await Promise.all([
    needs('api', 'service') ? timed(() => pingDb()) : null,
    needs('panel', 'service') ? timed(() => ptero.ping()) : null,
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

  // Nodes: Wartungsmodus aus dem Panel, dazu (wenn eingeschaltet) ein direkter Ping auf Wings
  const nodes: PteroNode[] = nodesCheck?.ok ? nodesCheck.value : [];
  const wanted = used.has('nodes') ? nodes : nodes.filter((n) => settings.components.some((c) => c.source === 'node' && c.target === String(n.id)));
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
  const panel: CheckResult | null = panelCheck && { status: panelCheck.ok ? (panelCheck.ms > 2000 ? 'degraded' : 'operational') : 'major_outage', latencyMs: panelCheck.ms };

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
        const node = nodes.find((n) => String(n.id) === c.target);
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

/** Automatische Prüfungen mit 30 Sekunden Cache (verhindert Last durch viele Besucher). */
async function getRawStatus(settings: SiteSettings['status'], fresh = false): Promise<RawStatus> {
  // Ändert der Admin die Komponenten, gilt der alte Stand nicht mehr
  const key = JSON.stringify([settings.pingNodes, settings.components.map((c) => [c.id, c.source, c.target])]);
  if (!fresh && rawCache && rawCache.key === key && Date.now() - rawCache.at < 30_000) return rawCache.value;
  if (!inflight || inflight.key !== key) {
    const isStatic = env.STATUS_PROVIDER === 'static';
    const promise = (
      isStatic
        ? Promise.resolve(Object.fromEntries(settings.components.map((c) => [c.id, { status: 'operational', latencyMs: null } as CheckResult])))
        : runChecks(settings)
    )
      .then((results) => {
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
const HISTORY_DAYS = 90;

interface DayCounts {
  total: number;
  outage: number;
  degraded: number;
  maintenance: number;
}
type History = Map<string, Map<number, DayCounts>>;

let historyCache: { at: number; offset: number; value: History } | null = null;

/** Messungen der letzten 90 Tage je Komponente und Kalendertag (Zeitzone der Website), 5 Minuten Cache. */
async function loadHistory(offset: number, today: number): Promise<History> {
  if (historyCache && historyCache.offset === offset && Date.now() - historyCache.at < 5 * 60_000) return historyCache.value;
  const day = sql<number>`cast((${statusChecks.checkedAt} + ${sql.raw(String(offset))}) / ${sql.raw(String(DAY_MS))} as integer)`;
  const rows = await db
    .select({ component: statusChecks.component, day, status: statusChecks.status, n: count() })
    .from(statusChecks)
    .where(gte(statusChecks.checkedAt, new Date((today - HISTORY_DAYS + 1) * DAY_MS - offset)))
    .groupBy(statusChecks.component, day, statusChecks.status);
  const value: History = new Map();
  for (const r of rows) {
    const category = statusCategory(r.status);
    if (category === 'none') continue;
    let days = value.get(r.component);
    if (!days) value.set(r.component, (days = new Map()));
    let c = days.get(Number(r.day));
    if (!c) days.set(Number(r.day), (c = { total: 0, outage: 0, degraded: 0, maintenance: 0 }));
    const n = Number(r.n);
    c.total += n;
    if (category !== 'operational') c[category] += n;
  }
  historyCache = { at: Date.now(), offset, value };
  return value;
}

const DAY_SEVERITY: StatusDayState[] = ['none', 'operational', 'maintenance', 'degraded', 'outage'];
const round2 = (v: number) => Math.floor(v * 100) / 100;

/**
 * Farbe eines Tages: Ein einzelner Aussetzer (eine Messung, 5 Minuten) färbt den Tag nicht um.
 * Ab zwei Messungen mit Ausfall ist der Tag rot, ab zwei auffälligen Messungen orange.
 */
function dayState(c: DayCounts | undefined): StatusDayState {
  if (!c || c.total === 0) return 'none';
  if (c.outage >= 2) return 'outage';
  if (c.outage + c.degraded >= 2) return 'degraded';
  if (c.maintenance >= 1) return 'maintenance';
  return 'operational';
}

function buildDays(
  measured: Map<number, DayCounts> | undefined,
  corrections: Record<string, StatusCategory> | undefined,
  today: number,
  days: number,
  current: ComponentStatus,
): { days: StatusDayDTO[]; uptime: number | null } {
  const out: StatusDayDTO[] = [];
  let sum = 0;
  let withData = 0;
  for (let idx = today - days + 1; idx <= today; idx++) {
    const date = new Date(idx * DAY_MS).toISOString().slice(0, 10);
    const c = measured?.get(idx);
    let state = dayState(c);
    let uptime = c && c.total > 0 ? ((c.total - c.outage) / c.total) * 100 : null;
    // Korrektur aus dem Admin-Bereich (z. B. Fehlalarm oder nachgetragener Ausfall)
    const fixed = corrections?.[date];
    if (fixed) {
      state = fixed;
      // „Ausfall“ färbt den Tag rot, die Prozentzahl folgt weiter den Messungen (ohne Messung zählt der Tag als ausgefallen).
      // Jeder andere Zustand erklärt den Tag für verfügbar.
      uptime = fixed === 'outage' ? (uptime ?? 0) : 100;
    }
    // Heute zählt zusätzlich der aktuelle Zustand – ein laufender Ausfall ist sofort sichtbar
    if (idx === today) {
      const now = statusCategory(current);
      if (DAY_SEVERITY.indexOf(now) > DAY_SEVERITY.indexOf(state)) state = now;
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
  const [raw, incidents] = await Promise.all([getRawStatus(cfg, fresh), relevantIncidents(now).catch(() => [] as StatusIncidentDTO[])]);
  const active = incidents.filter((i) => i.state === 'active');

  const offset = getTimeZoneOffset(now, freeHostingConfig.fairUse.timezone);
  const today = Math.floor((now.getTime() + offset) / DAY_MS);
  const history = withHistory ? await loadHistory(offset, today).catch(() => new Map() as History) : null;

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
    const h = history ? buildDays(history.get(c.id), cfg.history[c.id], today, cfg.page.days, status) : { days: [], uptime: null };
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
