/**
 * Standardwerte der im Admin-Bereich änderbaren Einstellungen.
 * Gespeichert wird in der Datenbank nur, was vom Standard abweicht bzw. geändert wurde.
 */
import { defaultServerLimits, normalizeServerLimits } from './server-limits';
import type {
  BrandSettings,
  DomainSetting,
  EggRef,
  HardwareLocation,
  PlanRules,
  PlanSetting,
  UserLimitOverrides,
  ProductSettings,
  RegistrationMode,
  RuleSettings,
  SiteSettings,
  SoftwareItem,
  WaitlistBlock,
} from './api-types';
import { DIRECTORY_NOT_GAME_SERVERS, builtinServerTypes, freeHostingConfig, getServerType, productKinds, type PlanConfig, type ProductKind, type ServerTypeConfig, type SoftwareInstall } from './config/freehosting.config';
import { defaultChatSettings, normalizeChatSettings } from './chat-settings';
import { defaultDiscordSettings, normalizeDiscordSettings } from './discord-settings';
import type { Locale, Localized } from './i18n';
import { defaultStatusSettings, normalizeStatusSettings } from './status-settings';

const toSetting = (p: PlanConfig): PlanSetting => ({ ...p, highlighted: p.highlighted ?? false, enabled: true, reserved: 0, serverTypes: [], audience: 'all', perUser: null });

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

/**
 * Werkseinstellungen der Regeln und Links – beim Laden des Moduls gesichert, weil `applyRuntimeConfig`
 * die zentrale Konfiguration zur Laufzeit mit den Werten aus dem Admin-Bereich überschreibt.
 */
const factory = {
  fairUse: { ...freeHostingConfig.fairUse },
  cycle: { ...freeHostingConfig.cycle, reminderDaysBefore: [...freeHostingConfig.cycle.reminderDaysBefore] },
  brand: { ...freeHostingConfig.brand },
};

export function defaultRules(): RuleSettings {
  const { fairUse: f, cycle: c } = factory;
  return {
    fairUse: {
      maxSessionHours: f.maxSessionHours,
      sessionWarningMinutes: f.sessionWarningMinutes,
      cooldownMinutes: f.cooldownMinutes,
      weeklyOfflineHours: f.weeklyOfflineHours,
      weeklyOfflineWarningHours: f.weeklyOfflineWarningHours,
    },
    cycle: {
      days: c.days,
      reminderDaysBefore: [...c.reminderDaysBefore],
      reactivationCooldownMinutes: c.reactivationCooldownMinutes,
      deleteAfterRestHours: c.deleteAfterRestHours,
      deleteReminderHours: c.deleteReminderHours,
    },
  };
}

/** Standard-Links der Marke (aus der Konfigurationsdatei) */
export function defaultBrand(): BrandSettings {
  const b = factory.brand;
  return { discordUrl: b.discordUrl, supportEmail: b.supportEmail, parentUrl: b.parentUrl, parentPricingUrl: b.parentPricingUrl, statusUrl: b.statusUrl };
}

let runtimeVersion = 0;

/** Zählt hoch, sobald sich Regeln oder Links geändert haben (für Zwischenspeicher, die davon abhängen) */
export function runtimeConfigVersion(): number {
  return runtimeVersion;
}

/**
 * Übernimmt Regeln und Links aus dem Admin-Bereich in die zentrale Konfiguration (`freeHostingConfig`).
 * So greifen alle Stellen, die bisher feste Werte gelesen haben (Jobs, E-Mails, Texte), ohne Neustart auf
 * die Einstellungen zu. Wird von API, Worker und Website nach jedem Laden der Einstellungen aufgerufen.
 */
export function applyRuntimeConfig(input: { rules: RuleSettings; brand: BrandSettings; software?: ServerTypeConfig[] }): boolean {
  const before = JSON.stringify([freeHostingConfig.fairUse, freeHostingConfig.cycle, freeHostingConfig.brand, freeHostingConfig.serverTypes]);
  Object.assign(freeHostingConfig.fairUse, input.rules.fairUse);
  Object.assign(freeHostingConfig.cycle, { ...input.rules.cycle, reminderDaysBefore: [...input.rules.cycle.reminderDaysBefore] });
  Object.assign(freeHostingConfig.brand, input.brand);
  if (input.software) {
    // Software-Katalog: die Minecraft-Einträge an Ort und Stelle ersetzen (alle Verweise auf die Liste bleiben gültig)
    const others = freeHostingConfig.serverTypes.filter((t) => t.kind !== 'minecraft');
    freeHostingConfig.serverTypes.splice(0, freeHostingConfig.serverTypes.length, ...input.software.map((t) => ({ ...t, kind: 'minecraft' as const })), ...others);
  }
  const changed = before !== JSON.stringify([freeHostingConfig.fairUse, freeHostingConfig.cycle, freeHostingConfig.brand, freeHostingConfig.serverTypes]);
  if (changed) runtimeVersion++;
  return changed;
}

/* ---- Software-Katalog (Minecraft) ---- */

const builtinSoftware = () => builtinServerTypes.filter((t) => t.kind === 'minecraft');

/** Katalog im Auslieferungszustand: alle fest hinterlegten Einträge mit ihren Voreinstellungen */
export function defaultSoftware(): SoftwareItem[] {
  return builtinSoftware().map((t) => ({
    id: t.id,
    name: t.name,
    description: { ...t.description },
    edition: t.edition ?? 'java',
    directory: t.directory ?? '',
    install: 'auto',
    website: t.website !== false,
    partner: !!t.partner,
    versionVariable: '',
    custom: false,
    eggOnly: !!t.eggOnly || t.edition === 'bedrock' || !t.directory,
  }));
}

const INSTALLS: SoftwareInstall[] = ['auto', 'egg', 'directory'];

/** Katalog aus gespeicherten Einstellungen: fest hinterlegte Einträge (nur Schalter änderbar) + eigene Einträge */
export function normalizeSoftware(input: unknown): SoftwareItem[] {
  const stored = new Map<string, Record<string, unknown>>();
  if (Array.isArray(input)) for (const raw of input) if (raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string') stored.set((raw as { id: string }).id, raw as Record<string, unknown>);
  const install = (v: unknown): SoftwareInstall => (INSTALLS.includes(v as SoftwareInstall) ? (v as SoftwareInstall) : 'auto');
  const variable = (v: unknown) => (typeof v === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(v.trim()) ? v.trim() : '');
  const out = defaultSoftware().map((d) => {
    const o = stored.get(d.id);
    if (!o) return d;
    // Nur über Egg: Installation steht fest, und über die Partner-API (dort richtet die API die Software selbst ein) nicht wählbar
    return { ...d, website: typeof o.website === 'boolean' ? o.website : d.website, partner: !d.eggOnly && d.edition === 'java' && (typeof o.partner === 'boolean' ? o.partner : d.partner), install: d.eggOnly ? ('egg' as const) : install(o.install), versionVariable: variable(o.versionVariable) };
  });
  const taken = new Set([...out.map((x) => x.id), ...builtinServerTypes.map((t) => t.id)]);
  for (const [id, o] of stored) {
    if (out.length >= 60) break;
    // „constructor“ ist ein Schlüssel jedes JavaScript-Objekts – als Kennung würde er Werte von Object.prototype lesen
    if (taken.has(id) || !/^[a-z][a-z0-9-]{1,23}$/.test(id) || id in Object.prototype) continue;
    const name = typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim().slice(0, 30) : '';
    if (!name) continue;
    const d = o.description && typeof o.description === 'object' ? (o.description as Record<string, unknown>) : {};
    const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 200) : '');
    const edition = o.edition === 'bedrock' ? ('bedrock' as const) : ('java' as const);
    // Über das Verzeichnis nur echte Java-Spielserver – Bedrock und Proxys laufen immer über ein eigenes Egg
    const wanted = typeof o.directory === 'string' && /^[A-Z][A-Z0-9_]{1,23}$/.test(o.directory.trim()) ? o.directory.trim() : '';
    const directory = edition === 'java' && !DIRECTORY_NOT_GAME_SERVERS.includes(wanted) ? wanted : '';
    taken.add(id);
    out.push({
      id,
      name,
      description: { de: text(d.de), en: text(d.en) || text(d.de) },
      edition,
      directory,
      install: directory ? install(o.install) : 'egg',
      website: typeof o.website === 'boolean' ? o.website : false,
      partner: !!directory && o.partner === true,
      versionVariable: variable(o.versionVariable),
      custom: true,
      eggOnly: !directory,
    });
  }
  return out;
}

/** Katalog als Servertypen (für die zentrale Konfiguration zur Laufzeit) */
export function softwareTypes(items: SoftwareItem[]): ServerTypeConfig[] {
  const builtin = new Map(builtinSoftware().map((t) => [t.id, t]));
  return items.map((i) => {
    const b = builtin.get(i.id);
    return {
      id: i.id,
      kind: 'minecraft' as const,
      name: i.name,
      description: i.description,
      versions: b ? [...b.versions] : ['latest'],
      defaultVersion: b?.defaultVersion ?? 'latest',
      ...(b?.recommended ? { recommended: true } : {}),
      edition: i.edition,
      directory: i.directory || null,
      website: i.website,
      partner: i.partner,
      install: i.install,
      versionVariable: i.versionVariable,
      custom: i.custom,
      eggOnly: i.eggOnly,
    };
  });
}

/** Wählbare Versionen eines Servertyps: Liste aus dem Admin-Bereich, sonst die Standardliste */
export function versionsFor(settings: Pick<SiteSettings, 'versions'>, typeId: string): string[] {
  const custom = Object.hasOwn(settings.versions, typeId) ? settings.versions[typeId] : undefined;
  return custom && custom.length ? custom : (getServerType(typeId)?.versions ?? ['latest']);
}

/** Hostname prüfen und vereinheitlichen (klein, ohne Protokoll/Pfad) – null, wenn ungültig */
export function normalizeHost(value: unknown): string | null {
  const host = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
  return /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? host : null;
}

/** Bekannte Anbieter von Wegwerf-Adressen (Auswahl) – ergänzbar über die Sperrliste im Admin-Bereich */
export const DISPOSABLE_EMAIL_DOMAINS = [
  '10minutemail.com', '10minutemail.net', 'byom.de', 'discard.email', 'dispostable.com', 'emailondeck.com', 'fakeinbox.com', 'getnada.com',
  'guerrillamail.com', 'guerrillamail.de', 'guerrillamail.net', 'guerrillamail.org', 'maildrop.cc', 'mailinator.com', 'mailnesia.com',
  'minuteinbox.com', 'mohmal.com', 'muellmail.com', 'mytemp.email', 'sharklasers.com', 'spam4.me', 'spamgourmet.com', 'temp-mail.org',
  'tempail.com', 'tempmail.com', 'tempmailo.com', 'tempr.email', 'throwawaymail.com', 'trash-mail.com', 'trashmail.com', 'trashmail.de',
  'wegwerfmail.de', 'yopmail.com', 'yopmail.fr', 'yopmail.net',
];

/** Ist diese E-Mail-Adresse gesperrt (Sperrliste oder Wegwerf-Anbieter)? */
export function isEmailBlocked(email: string, blocklist: SiteSettings['blocklist']): boolean {
  const address = email.trim().toLowerCase();
  const domain = address.slice(address.lastIndexOf('@') + 1);
  if (blocklist.emails.includes(address)) return true;
  const matches = (d: string) => domain === d || domain.endsWith(`.${d}`);
  if (blocklist.emailDomains.some(matches)) return true;
  return blocklist.disposable && DISPOSABLE_EMAIL_DOMAINS.some(matches);
}

export function defaultSiteSettings(): SiteSettings {
  return {
    maintenance: { enabled: false, message: { en: '', de: '' }, until: null, endedAt: null },
    registration: { mode: 'open', limits: defaultServerLimits(freeHostingConfig.limits.maxServersPerUser) },
    // EPYC-Plätze: 0 = es gibt nur eine Hardware-Stufe (aktuell Intel Xeon)
    waitlist: { epycSlots: 0, showCounter: true, externalCount: 0, epycReserved: 0, blocks: [] },
    products: { minecraft: defaultProduct('minecraft'), discord: defaultProduct('discord') },
    privateNodeIds: [],
    hardware: { locations: freeHostingConfig.hardware.locations.map((l) => ({ ...l })), cpus: [...freeHostingConfig.hardware.cpus] },
    donate: { enabled: false, url: '' },
    // Links: leer = Standard aus Konfiguration bzw. .env
    brand: { discordUrl: '', supportEmail: '', parentUrl: '', parentPricingUrl: '', statusUrl: '' },
    rules: defaultRules(),
    versions: {},
    software: defaultSoftware(),
    softwareBase: null,
    domains: { extra: [] },
    newsletter: { enabled: true, footerForm: true, signupCheckbox: true, ratePerMinute: 60 },
    announcement: { enabled: false, tone: 'info', text: { de: '', en: '' }, linkUrl: '', linkLabel: { de: '', en: '' } },
    blocklist: { disposable: true, emailDomains: [], emails: [] },
    seo: { title: { de: '', en: '' }, description: { de: '', en: '' }, indexing: true, summary: { de: '', en: '' } },
    discord: defaultDiscordSettings(),
    chat: defaultChatSettings(),
    branding: { logoMode: 'icon' },
    botFairUse: {
      enabled: true,
      cpuThresholdPercent: 90,
      cpuWindowMinutes: 30,
      cooldownMinutes: 30,
      maxStrikes: 3,
      strikeWindowDays: 7,
      inactiveDays: 7,
      inactiveWarningDays: 2,
    },
    stats: {
      show: true,
      users: { mode: 'auto', value: 0, offset: 0 },
      servers: { mode: 'auto', value: 0, offset: 0 },
      uptime: { mode: 'auto', value: 99.9 },
    },
    status: defaultStatusSettings(),
  };
}

const REG_MODES: RegistrationMode[] = ['open', 'preregistration', 'closed'];

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
    // Feste Software: nur gültige Kennungen (geprüft wird gegen den Katalog, sobald er bekannt ist)
    serverTypes: Array.isArray(v.serverTypes) ? [...new Set(v.serverTypes.filter((x): x is string => typeof x === 'string' && /^[a-z][a-z0-9-]{1,23}$/.test(x)))].slice(0, 20) : [],
    audience: v.audience === 'granted' ? 'granted' : 'all',
    perUser: v.perUser === null || v.perUser === undefined || v.perUser === '' ? null : int(v.perUser, 1, 0, 10),
  };
}

/** Abweichende Grenzen eines Nutzers prüfen und vereinheitlichen */
export function normalizeLimitOverrides(input: unknown): UserLimitOverrides {
  const v = obj(input);
  const opt = (x: unknown, max: number) => (x === null || x === undefined || x === '' ? null : int(x, 0, 0, max));
  const plans: Record<string, number> = {};
  for (const [id, n] of Object.entries(obj(v.plans))) {
    if (/^[a-z0-9][a-z0-9-]{0,31}$/.test(id) && Object.keys(plans).length < 50) plans[id] = int(n, 0, 0, 10);
  }
  return { minecraft: opt(v.minecraft, 20), discord: opt(v.discord, 20), total: opt(v.total, 40), plans };
}

/** Software eines Pakets: die feste Liste oder – ohne feste Software – `general` (die im Bestellformular freigegebene) */
export function planServerTypes(plan: Pick<PlanRules, 'serverTypes'>, general: readonly string[]): string[] {
  return plan.serverTypes.length > 0 ? [...plan.serverTypes] : [...general];
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

/** Liste von Node-IDs aus dem Panel: positive ganze Zahlen, ohne Doppelte */
function normalizeNodeIds(raw: unknown): number[] {
  return Array.isArray(raw) ? [...new Set(raw.map((n) => int(n, 0, 0, 1_000_000)).filter((n) => n > 0))].slice(0, 50) : [];
}

const withoutNodes = (product: ProductSettings, excluded: number[]): ProductSettings => ({ ...product, nodeIds: product.nodeIds.filter((id) => !excluded.includes(id)) });

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
    nodeIds: normalizeNodeIds(v.nodeIds),
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
  const products = obj(i.products);
  const hw = obj(i.hardware);
  const dn = obj(i.donate);
  const bf = obj(i.botFairUse);
  const br = obj(i.brand);
  const ru = obj(i.rules);
  const rf = obj(ru.fairUse);
  const rc = obj(ru.cycle);
  const nl = obj(i.newsletter);
  const an = obj(i.announcement);
  const bl = obj(i.blocklist);
  const seo = obj(i.seo);
  const dr = d.rules;
  const loose = (v: unknown, max: number): Localized => ({ de: str(obj(v).de, '', max).trim(), en: str(obj(v).en, '', max).trim() });
  const link = (v: unknown) => {
    const s = str(v, '', 500).trim();
    return /^https?:\/\/[^\s]+$/.test(s) ? s : '';
  };
  const list = (v: unknown, max: number, test: (s: string) => boolean): string[] =>
    Array.isArray(v)
      ? [...new Set(v.map((x) => str(x, '', 254).trim().toLowerCase()).filter((x) => x && test(x)))].slice(0, max)
      : [];
  const reminderDays = Array.isArray(rc.reminderDaysBefore)
    ? [...new Set(rc.reminderDaysBefore.map((n) => int(n, 0, 0, 60)).filter((n) => n > 0))].sort((a, b) => b - a).slice(0, 5)
    : dr.cycle.reminderDaysBefore;
  const cycleDays = int(rc.days, dr.cycle.days, 1, 365);
  const seenHosts = new Set<string>();
  const extraDomains: DomainSetting[] = Array.isArray(obj(i.domains).extra)
    ? (obj(i.domains).extra as unknown[])
        .slice(0, 50)
        .map((raw) => {
          const v = obj(raw);
          return { host: normalizeHost(v.host) ?? '', redirect: bool(v.redirect, true), addedAt: isoOrNull(v.addedAt) };
        })
        .filter((x) => x.host && !seenHosts.has(x.host) && seenHosts.add(x.host))
    : [];
  const software = normalizeSoftware(i.software);
  const baseRaw = obj(i.softwareBase);
  const baseNest = int(baseRaw.nestId, 0, 0, 1_000_000);
  const baseEgg = int(baseRaw.eggId, 0, 0, 1_000_000);
  const softwareBase = baseNest > 0 && baseEgg > 0 ? { nestId: baseNest, eggId: baseEgg, name: str(baseRaw.name, '', 120) } : null;
  const softwareIds = new Set(software.map((x) => x.id));
  const versions: Record<string, string[]> = {};
  for (const [typeId, value] of Object.entries(obj(i.versions))) {
    if (!softwareIds.has(typeId) || !Array.isArray(value)) continue;
    const cleaned = [...new Set(value.map((x) => str(x, '', 32).trim()).filter((x) => /^[A-Za-z0-9._-]{1,32}$/.test(x)))].slice(0, 80);
    if (cleaned.length) versions[typeId] = cleaned;
  }
  const inactiveDays = int(bf.inactiveDays, d.botFairUse.inactiveDays, 0, 365);
  const usedIds = new Set<string>();
  const privateNodeIds = normalizeNodeIds(i.privateNodeIds);
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
      // Früher gab es nur „Server pro Person“ (je Angebot) – der Wert wird für beide Angebote übernommen
      limits: normalizeServerLimits(r.limits, r.maxServersPerUser, freeHostingConfig.limits.maxServersPerUser),
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
    // Private Nodes gewinnen: Sie werden aus der Zuweisung der Produkte entfernt
    products: {
      minecraft: withoutNodes(normalizeProduct(products.minecraft, 'minecraft', usedIds), privateNodeIds),
      discord: withoutNodes(normalizeProduct(products.discord, 'discord', usedIds), privateNodeIds),
    },
    privateNodeIds,
    hardware: { locations: normalizeLocations(hw.locations, d.hardware.locations), cpus },
    // Ohne gültigen Zahlungslink bleibt die Spenden-Seite aus
    donate: { enabled: bool(dn.enabled, false) && donateUrl !== '', url: donateUrl },
    brand: {
      discordUrl: link(br.discordUrl),
      supportEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(br.supportEmail, '', 254).trim()) ? str(br.supportEmail, '', 254).trim() : '',
      parentUrl: link(br.parentUrl),
      parentPricingUrl: link(br.parentPricingUrl),
      statusUrl: link(br.statusUrl),
    },
    rules: {
      fairUse: {
        maxSessionHours: int(rf.maxSessionHours, dr.fairUse.maxSessionHours, 1, 167),
        sessionWarningMinutes: int(rf.sessionWarningMinutes, dr.fairUse.sessionWarningMinutes, 5, 720),
        cooldownMinutes: int(rf.cooldownMinutes, dr.fairUse.cooldownMinutes, 0, 1440),
        weeklyOfflineHours: int(rf.weeklyOfflineHours, dr.fairUse.weeklyOfflineHours, 0, 160),
        weeklyOfflineWarningHours: int(rf.weeklyOfflineWarningHours, dr.fairUse.weeklyOfflineWarningHours, 1, 72),
      },
      cycle: {
        days: cycleDays,
        // Erinnerungen müssen vor dem Ablauf liegen
        reminderDaysBefore: reminderDays.filter((n) => n < cycleDays),
        reactivationCooldownMinutes: int(rc.reactivationCooldownMinutes, dr.cycle.reactivationCooldownMinutes, 0, 43_200),
        deleteAfterRestHours: int(rc.deleteAfterRestHours, dr.cycle.deleteAfterRestHours, 0, 8760),
        deleteReminderHours: int(rc.deleteReminderHours, dr.cycle.deleteReminderHours, 1, 720),
      },
    },
    versions,
    software,
    softwareBase,
    domains: { extra: extraDomains },
    newsletter: {
      enabled: bool(nl.enabled, d.newsletter.enabled),
      footerForm: bool(nl.footerForm, d.newsletter.footerForm),
      signupCheckbox: bool(nl.signupCheckbox, d.newsletter.signupCheckbox),
      ratePerMinute: int(nl.ratePerMinute, d.newsletter.ratePerMinute, 1, 600),
    },
    announcement: {
      enabled: bool(an.enabled, false),
      tone: an.tone === 'success' || an.tone === 'warning' ? an.tone : 'info',
      text: loose(an.text, 300),
      linkUrl: link(an.linkUrl),
      linkLabel: loose(an.linkLabel, 60),
    },
    blocklist: {
      disposable: bool(bl.disposable, d.blocklist.disposable),
      emailDomains: list(bl.emailDomains, 500, (x) => normalizeHost(x) !== null),
      emails: list(bl.emails, 2000, (x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)),
    },
    discord: normalizeDiscordSettings(i.discord),
    chat: normalizeChatSettings(i.chat),
    branding: { logoMode: obj(i.branding).logoMode === 'full' ? 'full' : 'icon' },
    seo: {
      title: loose(seo.title, 90),
      description: loose(seo.description, 220),
      indexing: bool(seo.indexing, true),
      summary: loose(seo.summary, 1200),
    },
    botFairUse: {
      enabled: bool(bf.enabled, d.botFairUse.enabled),
      cpuThresholdPercent: int(bf.cpuThresholdPercent, d.botFairUse.cpuThresholdPercent, 50, 100),
      cpuWindowMinutes: int(bf.cpuWindowMinutes, d.botFairUse.cpuWindowMinutes, 5, 1440),
      cooldownMinutes: int(bf.cooldownMinutes, d.botFairUse.cooldownMinutes, 5, 1440),
      maxStrikes: int(bf.maxStrikes, d.botFairUse.maxStrikes, 0, 50),
      strikeWindowDays: int(bf.strikeWindowDays, d.botFairUse.strikeWindowDays, 1, 90),
      inactiveDays,
      // Die Erinnerung liegt immer vor der Freigabe
      inactiveWarningDays: Math.min(int(bf.inactiveWarningDays, d.botFairUse.inactiveWarningDays, 0, 30), Math.max(0, inactiveDays - 1)),
    },
    stats: {
      show: bool(st.show, d.stats.show),
      users: { mode: su.mode === 'manual' ? 'manual' : 'auto', value: int(su.value, 0, 0, 100_000_000), offset: int(su.offset, 0, 0, 100_000_000) },
      servers: { mode: ss.mode === 'manual' ? 'manual' : 'auto', value: int(ss.value, 0, 0, 100_000_000), offset: int(ss.offset, 0, 0, 100_000_000) },
      uptime: { mode: sp.mode === 'manual' ? 'manual' : 'auto', value: num(sp.value, d.stats.uptime.value, 0, 100) },
    },
    status: normalizeStatusSettings(i.status),
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
