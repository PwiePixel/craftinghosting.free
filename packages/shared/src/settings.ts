/**
 * Standardwerte der im Admin-Bereich änderbaren Einstellungen.
 * Gespeichert wird in der Datenbank nur, was vom Standard abweicht bzw. geändert wurde.
 */
import type { IncidentImpact, PlanCapacitySetting, RegistrationMode, SiteSettings, WaitlistBlock } from './api-types';
import { freeHostingConfig } from './config/freehosting.config';

export function defaultSiteSettings(): SiteSettings {
  return {
    maintenance: { enabled: false, message: { en: '', de: '' }, until: null, endedAt: null },
    registration: { mode: 'open', maxServersPerUser: freeHostingConfig.limits.maxServersPerUser },
    waitlist: { epycSlots: 50, showCounter: true, externalCount: 0, epycReserved: 0, blocks: [] },
    plans: Object.fromEntries(freeHostingConfig.plans.map((p) => [p.id, { capacity: p.capacity, reserved: 0 }])),
    stats: {
      show: true,
      users: { mode: 'auto', value: 0, offset: 0 },
      servers: { mode: 'auto', value: 0, offset: 0 },
      uptime: { mode: 'auto', value: 99.9 },
    },
    status: { overrides: {} },
  };
}

const REG_MODES: RegistrationMode[] = ['open', 'preregistration', 'closed'];
const IMPACTS: (IncidentImpact | 'auto')[] = ['auto', 'operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'];

const int = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
const num = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
const str = (v: unknown, def: string, max = 1000) => (typeof v === 'string' ? v.slice(0, max) : def);
const isoOrNull = (v: unknown) => (typeof v === 'string' && v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/**
 * Blöcke von Vormerkungen außerhalb der Website. Ältere Einstellungen hatten nur eine Zahl
 * (externalCount) – daraus wird ein Block ohne Anker (after = null), den die API beim Lesen
 * hinter die bis dahin vergebenen Plätze setzt.
 */
function normalizeBlocks(w: Record<string, unknown>): WaitlistBlock[] {
  if (!Array.isArray(w.blocks)) {
    const legacy = int(w.externalCount, 0, 0, 10_000_000);
    return legacy > 0 ? [{ after: null, count: legacy, at: null }] : [];
  }
  return w.blocks
    .slice(0, 200)
    .map((raw) => {
      const b = obj(raw);
      return {
        after: b.after === null || b.after === undefined ? null : int(b.after, 0, -1_000_000_000, 1_000_000_000),
        count: int(b.count, 0, 0, 10_000_000),
        at: isoOrNull(b.at),
      };
    })
    .filter((b) => b.count > 0);
}

/** Vormerkungs-Plätze, die vor einer Warteliste-Position liegen */
export function blockSpotsBefore(position: number, blocks: WaitlistBlock[]): number {
  return blocks.reduce((sum, b) => (b.after !== null && b.after < position ? sum + b.count : sum), 0);
}

/** Führt gespeicherte (evtl. unvollständige/alte) Werte mit den Standardwerten zusammen und prüft sie. */
export function normalizeSiteSettings(input: unknown): SiteSettings {
  const d = defaultSiteSettings();
  const i = obj(input);
  const m = obj(i.maintenance);
  const r = obj(i.registration);
  const w = obj(i.waitlist);
  const st = obj(i.stats);
  const su = obj(st.users);
  const ss = obj(st.servers);
  const sp = obj(st.uptime);
  const overrides = obj(obj(i.status).overrides);
  return {
    maintenance: {
      enabled: bool(m.enabled, d.maintenance.enabled),
      message: { en: str(obj(m.message).en, ''), de: str(obj(m.message).de, '') },
      until: isoOrNull(m.until),
      endedAt: isoOrNull(m.endedAt),
    },
    registration: {
      mode: REG_MODES.includes(r.mode as RegistrationMode) ? (r.mode as RegistrationMode) : d.registration.mode,
      maxServersPerUser: int(r.maxServersPerUser, d.registration.maxServersPerUser, 1, 10),
    },
    waitlist: (() => {
      const blocks = normalizeBlocks(w);
      return {
        epycSlots: int(w.epycSlots, d.waitlist.epycSlots, 0, 100_000),
        showCounter: bool(w.showCounter, d.waitlist.showCounter),
        // Summe aller Blöcke – wird nicht mehr direkt gesetzt, sondern über „+ / −“ im Admin
        externalCount: blocks.reduce((a, b) => a + b.count, 0),
        epycReserved: int(w.epycReserved, 0, 0, 100_000),
        blocks,
      };
    })(),
    plans: Object.fromEntries(
      freeHostingConfig.plans.map((p) => {
        const v = obj(obj(i.plans)[p.id]);
        // null/leer = unbegrenzt · fehlt der Wert ganz, gilt der Standard aus der Konfiguration
        const capacity: PlanCapacitySetting['capacity'] = !('capacity' in v)
          ? p.capacity
          : v.capacity === null || v.capacity === ''
            ? null
            : int(v.capacity, p.capacity ?? 0, 0, 1_000_000);
        return [p.id, { capacity, reserved: int(v.reserved, 0, 0, 1_000_000) }];
      }),
    ),
    stats: {
      show: bool(st.show, d.stats.show),
      users: { mode: su.mode === 'manual' ? 'manual' : 'auto', value: int(su.value, 0, 0, 100_000_000), offset: int(su.offset, 0, 0, 100_000_000) },
      servers: { mode: ss.mode === 'manual' ? 'manual' : 'auto', value: int(ss.value, 0, 0, 100_000_000), offset: int(ss.offset, 0, 0, 100_000_000) },
      uptime: { mode: sp.mode === 'manual' ? 'manual' : 'auto', value: num(sp.value, d.stats.uptime.value, 0, 100) },
    },
    status: {
      overrides: Object.fromEntries(
        Object.entries(overrides).filter(([k, v]) => /^[a-z0-9_-]{1,32}$/.test(k) && IMPACTS.includes(v as IncidentImpact | 'auto') && v !== 'auto'),
      ) as SiteSettings['status']['overrides'],
    },
  };
}

/** Hardware-Stufe eines Wartelisten-Platzes */
export function tierForPosition(position: number, epycSlots: number): 'epyc' | 'xeon' {
  return position <= epycSlots ? 'epyc' : 'xeon';
}

/** EPYC-Plätze, die für Anmeldungen über diese Website übrig sind (gesamt minus außerhalb belegt) */
export function websiteEpycSlots(waitlist: Pick<SiteSettings['waitlist'], 'epycSlots' | 'epycReserved'>): number {
  return Math.max(0, waitlist.epycSlots - waitlist.epycReserved);
}
