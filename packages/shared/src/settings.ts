/**
 * Standardwerte der im Admin-Bereich änderbaren Einstellungen.
 * Gespeichert wird in der Datenbank nur, was vom Standard abweicht bzw. geändert wurde.
 */
import type { EggRef, HardwareLocation, IncidentImpact, PlanSetting, ProductSettings, RegistrationMode, SiteSettings, WaitlistBlock } from './api-types';
import { freeHostingConfig, productKinds, type PlanConfig, type ProductKind } from './config/freehosting.config';
import type { Locale, Localized } from './i18n';

const toSetting = (p: PlanConfig): PlanSetting => ({ ...p, highlighted: p.highlighted ?? false, enabled: true, reserved: 0 });

/** Standard-Pakete eines Produkts (aus der Konfigurationsdatei) */
export function defaultPlans(kind: ProductKind): PlanSetting[] {
  return (kind === 'discord' ? freeHostingConfig.discordPlans : freeHostingConfig.plans).map(toSetting);
}

export function maxPlans(kind: ProductKind): number {
  return kind === 'discord' ? freeHostingConfig.limits.maxDiscordPlans : freeHostingConfig.limits.maxMinecraftPlans;
}

function defaultProduct(kind: ProductKind): ProductSettings {
  return {
    enabled: true,
    capacity: freeHostingConfig.capacity[kind],
    reserved: 0,
    // Minecraft: Fair-Use-System aktiv · Discord-Bots laufen dauerhaft (nur der 30-Tage-Zyklus gilt)
    fairUse: kind === 'minecraft',
    plans: defaultPlans(kind),
    nodeIds: [],
    eggs: {},
  };
}

export function defaultSiteSettings(): SiteSettings {
  return {
    maintenance: { enabled: false, message: { en: '', de: '' }, until: null, endedAt: null },
    registration: { mode: 'open', maxServersPerUser: freeHostingConfig.limits.maxServersPerUser },
    // EPYC-Plätze: 0 = es gibt nur eine Hardware-Stufe (aktuell Intel Xeon)
    waitlist: { epycSlots: 0, showCounter: true, externalCount: 0, epycReserved: 0, blocks: [] },
    products: { minecraft: defaultProduct('minecraft'), discord: defaultProduct('discord') },
    hardware: { locations: freeHostingConfig.hardware.locations.map((l) => ({ ...l })), cpus: [...freeHostingConfig.hardware.cpus] },
    donate: { enabled: false, url: '' },
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

/* ------------------------------------------------------------------ Pakete */

/** Anzeige-Text für das CPU-Limit, z. B. „Geteilte CPU (bis zu 1,5 Threads)“ */
export function cpuLabelFor(cpuPercent: number): Localized {
  const threads = cpuPercent / 100;
  return {
    de: `Geteilte CPU (bis zu ${threads.toLocaleString('de-DE')} ${threads === 1 ? 'Thread' : 'Threads'})`,
    en: `Shared CPU (up to ${threads.toLocaleString('en-GB')} ${threads === 1 ? 'thread' : 'threads'})`,
  };
}

/** Macht aus einem Namen eine Paket-ID (klein, a–z 0–9 -) */
export function planIdFromName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'paket'
  );
}

const localized = (v: unknown, def: Localized, max = 160): Localized => {
  const o = obj(v);
  const de = str(o.de, def.de, max).trim();
  const en = str(o.en, def.en, max).trim();
  // Fehlt eine Sprache, gilt die andere
  return { de: de || en, en: en || de };
};

function normalizePlan(raw: unknown, kind: ProductKind, usedIds: Set<string>): PlanSetting | null {
  const v = obj(raw);
  const name = str(v.name, '', 40).trim();
  if (!name) return null;
  let id = /^[a-z0-9][a-z0-9-]{0,31}$/.test(String(v.id ?? '')) ? String(v.id) : planIdFromName(name);
  // IDs sind über beide Produkte eindeutig
  for (let n = 2; usedIds.has(id); n++) id = `${id.replace(/-\d+$/, '').slice(0, 28)}-${n}`;
  usedIds.add(id);
  const cpuPercent = int(v.cpuPercent, 100, 5, 3200);
  const features = Array.isArray(v.features)
    ? v.features
        .slice(0, 6)
        .map((f) => localized(f, { de: '', en: '' }, 80))
        .filter((f) => f.de)
    : [];
  return {
    id,
    name,
    tagline: localized(v.tagline, { de: '', en: '' }),
    memoryMb: int(v.memoryMb, kind === 'discord' ? 512 : 4096, 64, 262_144),
    cpuPercent,
    cpuLabel: cpuLabelFor(cpuPercent),
    diskMb: int(v.diskMb, kind === 'discord' ? 2048 : 10_240, 128, 2_097_152),
    swapMb: int(v.swapMb, 0, -1, 65_536),
    ioWeight: int(v.ioWeight, 500, 10, 1000),
    databases: int(v.databases, 0, 0, 20),
    backups: int(v.backups, kind === 'discord' ? 0 : 1, 0, 20),
    allocations: int(v.allocations, 1, 1, 10),
    highlighted: bool(v.highlighted, false),
    // null/leer = unbegrenzt
    capacity: v.capacity === null || v.capacity === undefined || v.capacity === '' ? null : int(v.capacity, 0, 0, 1_000_000),
    features,
    enabled: bool(v.enabled, true),
    reserved: int(v.reserved, 0, 0, 1_000_000),
  };
}

function normalizeEggs(raw: unknown): Record<string, EggRef> {
  const out: Record<string, EggRef> = {};
  for (const [key, value] of Object.entries(obj(raw))) {
    const v = obj(value);
    const nestId = int(v.nestId, 0, 0, 1_000_000);
    const eggId = int(v.eggId, 0, 0, 1_000_000);
    if (/^[a-z0-9_-]{1,32}$/.test(key) && nestId > 0 && eggId > 0) out[key] = { nestId, eggId, name: str(v.name, '', 120) };
  }
  return out;
}

function normalizeProduct(raw: unknown, kind: ProductKind, usedIds: Set<string>): ProductSettings {
  const d = defaultProduct(kind);
  const v = obj(raw);
  // Fehlt die Paketliste ganz (erste Einrichtung), gelten die Standard-Pakete
  const plans = Array.isArray(v.plans)
    ? v.plans
        .map((p) => normalizePlan(p, kind, usedIds))
        .filter((p): p is PlanSetting => p !== null)
        .slice(0, maxPlans(kind))
    : d.plans.map((p) => {
        usedIds.add(p.id);
        return p;
      });
  return {
    enabled: bool(v.enabled, d.enabled),
    capacity: !('capacity' in v) ? d.capacity : v.capacity === null || v.capacity === '' ? null : int(v.capacity, d.capacity ?? 0, 0, 1_000_000),
    reserved: int(v.reserved, 0, 0, 1_000_000),
    fairUse: bool(v.fairUse, d.fairUse),
    plans,
    nodeIds: Array.isArray(v.nodeIds)
      ? [...new Set(v.nodeIds.map((n) => int(n, 0, 0, 1_000_000)).filter((n) => n > 0))].slice(0, 50)
      : [],
    eggs: normalizeEggs(v.eggs),
  };
}

function normalizeLocations(raw: unknown, def: HardwareLocation[]): HardwareLocation[] {
  if (!Array.isArray(raw)) return def;
  const seen = new Set<string>();
  return raw
    .slice(0, 12)
    .map((l) => {
      const v = obj(l);
      const code = str(v.code, '', 3)
        .toUpperCase()
        .replace(/[^A-Z]/g, '');
      // Fehlt eine Sprache, gilt die andere – fehlen beide, der Ländercode
      const name = localized(v.name, { de: '', en: '' }, 60);
      return { code, name: name.de ? name : { de: code, en: code } };
    })
    .filter((l) => l.code.length >= 2 && !seen.has(l.code) && seen.add(l.code));
}

/** Nur https-Links (Zahlungslink) – alles andere wird verworfen */
function httpsUrl(v: unknown): string {
  const s = str(v, '', 500).trim();
  try {
    return s && new URL(s).protocol === 'https:' ? s : '';
  } catch {
    return '';
  }
}

/** Alle Pakete beider Produkte */
export function allPlans(settings: Pick<SiteSettings, 'products'>): (PlanSetting & { kind: ProductKind })[] {
  return productKinds.flatMap((kind) => settings.products[kind].plans.map((p) => ({ ...p, kind })));
}

/** Paket anhand der ID – über beide Produkte, auch deaktivierte (für bestehende Server) */
export function findPlan(settings: Pick<SiteSettings, 'products'>, id: string): (PlanSetting & { kind: ProductKind }) | undefined {
  return allPlans(settings).find((p) => p.id === id);
}

/** Größter Arbeitsspeicher aller aktiven Pakete in MB (für „bis zu X GB RAM“) */
export function maxPlanMemoryMb(plans: readonly { memoryMb: number }[]): number {
  return plans.reduce((max, p) => Math.max(max, p.memoryMb), 0);
}

/** Standorte als kurzer Text: „DE · NL“ */
export function locationCodes(locations: readonly HardwareLocation[]): string {
  return locations.map((l) => l.code).join(' · ');
}

/** Standorte als Fließtext: „Deutschland“, „Deutschland und den Niederlanden“ … */
export function locationNames(locations: readonly HardwareLocation[], locale: Locale): string {
  const names = locations.map((l) => l.name[locale]);
  if (names.length <= 1) return names[0] ?? '';
  const and = locale === 'de' ? ' und ' : ' and ';
  return `${names.slice(0, -1).join(', ')}${and}${names[names.length - 1]}`;
}

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
  const products = obj(i.products);
  const hw = obj(i.hardware);
  const dn = obj(i.donate);
  const usedIds = new Set<string>();
  const cpus = Array.isArray(hw.cpus)
    ? hw.cpus
        .map((c) => str(c, '', 80).trim())
        .filter(Boolean)
        .slice(0, 6)
    : d.hardware.cpus;
  const donateUrl = httpsUrl(dn.url);
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
    products: {
      minecraft: normalizeProduct(products.minecraft, 'minecraft', usedIds),
      discord: normalizeProduct(products.discord, 'discord', usedIds),
    },
    hardware: { locations: normalizeLocations(hw.locations, d.hardware.locations), cpus },
    // Ohne gültigen Zahlungslink bleibt die Spenden-Seite aus
    donate: { enabled: bool(dn.enabled, false) && donateUrl !== '', url: donateUrl },
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
