/**
 * Einstellungen aus dem Admin-Bereich (Wartung, Registrierung, Warteliste, Kennzahlen, Status).
 * Gespeichert als JSON in der Tabelle `settings`; kurzer Cache, damit API und Worker
 * Änderungen nach wenigen Sekunden übernehmen.
 */
import { and, count, eq, gte, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm';
import {
  applyRuntimeConfig,
  blockSpotsBefore,
  defaultBrand,
  defaultSiteSettings,
  freeHostingConfig,
  normalizeSiteSettings,
  productKinds,
  serverTypesOf,
  versionsFor,
  websiteEpycSlots,
  type BrandSettings,
  type PlanAvailabilityDTO,
  type ProductKind,
  type PublicProductDTO,
  type PublicSiteDTO,
  type SiteSettings,
  type WaitlistBlock,
} from '@chfree/shared';
import { getEggMapping } from '../config/pterodactyl.config';
import { assets } from '../db/schema';
import { env } from '../env';
import { db } from '../db/client';
import { getDiscordSecrets, getDiscordState } from '../discord/store';
import { servers, settings as settingsTable, statusChecks, users } from '../db/schema';

const KEY = 'site';
const TTL_MS = 5_000;
let cache: { value: SiteSettings; at: number } | null = null;

/** Höchste bisher vergebene Warteliste-Position (auch freigeschaltete/gelöschte) – neue Anmeldungen bekommen MAX + 1 */
async function maxWaitlistPosition(): Promise<number> {
  const [row] = await db.select({ max: sql<number | null>`max(${servers.waitlistPosition})` }).from(servers);
  return Number(row?.max ?? 0);
}

export async function getSettings(): Promise<SiteSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, KEY)).limit(1);
    let value = normalizeSiteSettings(row?.value ?? {});
    // Vormerkungs-Blöcke ohne Anker (z. B. aus der früheren einfachen Zahl) hinter alle bisherigen Plätze setzen
    if (value.waitlist.blocks.some((b) => b.after === null)) {
      const after = await maxWaitlistPosition();
      const at = new Date().toISOString();
      value = normalizeSiteSettings({
        ...value,
        waitlist: { ...value.waitlist, blocks: value.waitlist.blocks.map((b) => (b.after === null ? { ...b, after, at: b.at ?? at } : b)) },
      });
      await db.insert(settingsTable).values({ key: KEY, value }).onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
    }
    cache = { value, at: Date.now() };
    await loadBotInvite();
    applyRuntime(value);
    return value;
  } catch {
    // z. B. Migration noch nicht gelaufen – mit Standardwerten weiterarbeiten
    return cache?.value ?? defaultSiteSettings();
  }
}

/** Speichert Einstellungen. Wird die Wartung beendet, merkt sich das System den Zeitpunkt (Schutzfrist für Löschungen). */
export async function saveSettings(next: unknown, opts: { blocks?: WaitlistBlock[] } = {}): Promise<SiteSettings> {
  const before = await getSettings();
  // Vormerkungs-Blöcke ändern sich nur über adjustExternalSpots – ein Formular mit altem Stand überschreibt sie nicht
  const blocks = opts.blocks ?? before.waitlist.blocks;
  const input = next && typeof next === 'object' ? (next as Record<string, unknown>) : {};
  const value = normalizeSiteSettings({ ...input, waitlist: { ...((input.waitlist as object) ?? {}), blocks } });
  if (before.maintenance.enabled && !value.maintenance.enabled) value.maintenance.endedAt = new Date().toISOString();
  else value.maintenance.endedAt = before.maintenance.endedAt;
  await db.insert(settingsTable).values({ key: KEY, value }).onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
  cache = { value, at: Date.now() };
  applyRuntime(value);
  return value;
}

/** Links der Marke: Einstellung aus dem Admin-Bereich → .env (NEXT_PUBLIC_*) → Standard aus der Konfiguration */
export function resolveBrand(s: Pick<SiteSettings, 'brand' | 'discord'>): BrandSettings {
  const d = defaultBrand();
  return {
    // Ist die Discord-Anbindung aktiv, gilt überall der Einladungslink, den der Bot erstellt hat
    discordUrl: (s.discord.enabled && botInviteUrl) || s.brand.discordUrl || process.env.NEXT_PUBLIC_DISCORD_URL || d.discordUrl,
    supportEmail: s.brand.supportEmail || d.supportEmail,
    parentUrl: s.brand.parentUrl || process.env.NEXT_PUBLIC_PARENT_URL || d.parentUrl,
    parentPricingUrl: s.brand.parentPricingUrl || process.env.NEXT_PUBLIC_PARENT_PRICING_URL || d.parentPricingUrl,
    statusUrl: s.brand.statusUrl || process.env.NEXT_PUBLIC_STATUS_URL || d.statusUrl,
  };
}

/** Vom Discord-Bot erstellter Einladungslink (aus discord-state, wird mit den Einstellungen geladen) */
let botInviteUrl: string | null = null;
async function loadBotInvite(): Promise<void> {
  const code = (await getDiscordState().catch(() => null))?.inviteCode;
  botInviteUrl = code ? `https://discord.gg/${code}` : null;
}

/**
 * Regeln (Fair-Use, Laufzeit) und Links aus dem Admin-Bereich in die zentrale Konfiguration übernehmen –
 * Jobs, E-Mail-Vorlagen und Texte lesen danach automatisch die eingestellten Werte.
 */
function applyRuntime(s: SiteSettings) {
  applyRuntimeConfig({ rules: s.rules, brand: resolveBrand(s) });
}

/** Hostname der Beta-Instanz (nur auf der Hauptseite bekannt) */
export function betaHost(): string | null {
  try {
    return env.BETA_URL ? new URL(env.BETA_URL).hostname : null;
  } catch {
    return null;
  }
}

/** Alle Hostnamen, unter denen die Website erreichbar sein darf (Hauptdomain, www, weitere Domains aus dem Admin-Bereich) */
export function allowedHosts(s: Pick<SiteSettings, 'domains'>): Set<string> {
  const primary = new URL(env.APP_URL).hostname;
  const hosts = new Set([primary, `www.${primary}`]);
  for (const d of s.domains.extra) hosts.add(d.host);
  // Beta-Instanz (install.sh --beta) – z. B. beta.craftinghosting.free
  const beta = betaHost();
  if (beta) hosts.add(beta);
  return hosts;
}

/**
 * Vormerkungen außerhalb der Website anpassen:
 *  + N → neuer Block mit N Plätzen hinter allen bisher vergebenen Plätzen (spätere Anmeldungen reihen sich dahinter ein)
 *  − N → entfernt Plätze aus den zuletzt hinzugefügten Blöcken (Nachfolgende rücken auf)
 */
export async function adjustExternalSpots(delta: number): Promise<SiteSettings> {
  const s = await getSettings();
  const blocks = s.waitlist.blocks.map((b) => ({ ...b }));
  if (delta > 0) {
    blocks.push({ after: await maxWaitlistPosition(), count: delta, at: new Date().toISOString() });
  } else {
    let remove = -delta;
    while (remove > 0 && blocks.length) {
      const last = blocks[blocks.length - 1]!;
      const take = Math.min(remove, last.count);
      last.count -= take;
      remove -= take;
      if (last.count === 0) blocks.pop();
    }
  }
  const value = await saveSettings(s, { blocks });
  publicCache = null;
  return value;
}

/**
 * Automatische Löschungen pausieren während einer Wartung und 24 h danach –
 * Nutzer sollen nicht ihren Server verlieren, weil sie wegen der Wartung nicht reaktivieren konnten.
 */
export async function deletionsAllowed(now = new Date()): Promise<boolean> {
  const s = await getSettings();
  if (s.maintenance.enabled) return false;
  if (s.maintenance.endedAt && now.getTime() - Date.parse(s.maintenance.endedAt) < 24 * 3_600_000) return false;
  return true;
}

/* ------------------------------------------------------------ Kennzahlen */

/** Verfügbarkeit der letzten 30 Tage aus dem Status-Verlauf (Wartung zählt nicht als Ausfall). */
export async function uptimePercent(component: string, days = 30): Promise<number | null> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({ status: statusChecks.status, n: count() })
    .from(statusChecks)
    .where(and(eq(statusChecks.component, component), gte(statusChecks.checkedAt, since)))
    .groupBy(statusChecks.status);
  let up = 0;
  let total = 0;
  for (const r of rows) {
    const n = Number(r.n);
    if (r.status === 'unknown') continue;
    total += n;
    if (r.status === 'operational' || r.status === 'degraded' || r.status === 'maintenance') up += n;
  }
  if (total === 0) return null;
  return Math.floor((up / total) * 1000) / 10;
}

/** Wartelisten-Einträge, die einen Platz belegen: wartend (bestätigt) oder bereits freigeschaltet (nicht gelöscht) */
const holdsSpot = and(isNotNull(servers.waitlistPosition), ne(servers.status, 'deleted'));

/**
 * Tatsächlicher Rang eines Wartelisten-Platzes: Wer vor einem die Warteliste verlässt, macht Platz –
 * so rückt man nach und kann auch noch auf den EPYC kommen.
 */
export async function waitlistRank(position: number): Promise<number> {
  const [row, s] = await Promise.all([
    db
      .select({ n: count() })
      .from(servers)
      .where(and(holdsSpot, lte(servers.waitlistPosition, position)))
      .then((r) => r[0]),
    getSettings(),
  ]);
  // + Vormerkungen außerhalb der Website, die vor diesem Platz eingereiht wurden
  return Number(row?.n ?? position) + blockSpotsBefore(position, s.waitlist.blocks);
}

export async function waitlistCounts(s: SiteSettings): Promise<{ confirmed: number; epycUsed: number; epycRemaining: number }> {
  const [waiting] = await db
    .select({ n: count() })
    .from(servers)
    .where(and(eq(servers.status, 'waitlist'), isNotNull(servers.waitlistPosition)));
  const [spots] = await db.select({ n: count() }).from(servers).where(holdsSpot);
  // Belegt = außerhalb belegte EPYC-Plätze + Warteschlangen-Plätze (Website + Vormerkungs-Blöcke), höchstens so viele, wie es gibt
  const websiteSlots = websiteEpycSlots(s.waitlist);
  const queued = Number(spots?.n ?? 0) + s.waitlist.externalCount;
  const epycUsed = Math.min(s.waitlist.epycSlots, s.waitlist.epycReserved + Math.min(websiteSlots, queued));
  return { confirmed: Number(waiting?.n ?? 0), epycUsed, epycRemaining: Math.max(0, s.waitlist.epycSlots - epycUsed) };
}

/** Server, die einen Paket-Platz belegen (existieren oder werden gerade eingerichtet) */
export const CAPACITY_STATUSES = ['provisioning', 'provisioning_failed', 'active', 'expiring', 'suspended'] as const;

/**
 * Belegung je Paket: Server über diese Website + außerhalb belegte Plätze (Admin-Einstellung).
 * `extra` zählt zusätzliche Server je Paket mit (z. B. freigeschaltete, noch nicht erstellte).
 */
export async function planAvailability(s?: SiteSettings, extra: Record<string, number> = {}): Promise<PlanAvailabilityDTO[]> {
  return (await capacityState(s, extra)).plans;
}

export interface ProductCapacity {
  capacity: number | null;
  used: number;
  remaining: number | null;
  available: boolean;
}

/**
 * Belegung je Produkt (Minecraft / Discord-Bots) und je Paket. Ein Paket ist nur verfügbar, wenn es aktiv ist,
 * das Produkt angeboten wird und sowohl im Paket als auch im Produkt noch Plätze frei sind.
 */
export async function capacityState(
  s?: SiteSettings,
  extra: Record<string, number> = {},
): Promise<{ products: Record<ProductKind, ProductCapacity>; plans: (PlanAvailabilityDTO & { kind: ProductKind })[] }> {
  const settings = s ?? (await getSettings());
  const rows = await db
    .select({ kind: servers.kind, planId: servers.planId, n: count() })
    .from(servers)
    .where(inArray(servers.status, [...CAPACITY_STATUSES]))
    .groupBy(servers.kind, servers.planId);
  const products = {} as Record<ProductKind, ProductCapacity>;
  const plans: (PlanAvailabilityDTO & { kind: ProductKind })[] = [];
  for (const kind of productKinds) {
    const product = settings.products[kind];
    // Auch Server entfernter Pakete belegen weiter einen Platz des Produkts
    const servers_ = rows.filter((r) => r.kind === kind).reduce((sum, r) => sum + Number(r.n), 0);
    const extras = product.plans.reduce((sum, p) => sum + (extra[p.id] ?? 0), 0);
    const used = servers_ + product.reserved + extras;
    const remaining = product.capacity === null ? null : Math.max(0, product.capacity - used);
    const open = product.enabled && (remaining === null || remaining > 0);
    products[kind] = { capacity: product.capacity, used, remaining, available: open };
    for (const p of product.plans) {
      const planUsed = Number(rows.find((r) => r.planId === p.id)?.n ?? 0) + p.reserved + (extra[p.id] ?? 0);
      let planRemaining = p.capacity === null ? null : Math.max(0, p.capacity - planUsed);
      if (planRemaining !== null && remaining !== null) planRemaining = Math.min(planRemaining, remaining);
      plans.push({ id: p.id, kind, capacity: p.capacity, used: planUsed, remaining: planRemaining, available: p.enabled && open && (planRemaining === null || planRemaining > 0) });
    }
  }
  return { products, plans };
}

/**
 * Ist ein Servertyp bestellbar? Es braucht ein Egg – und Discord-Bots zusätzlich eine eigene Node
 * (Admin → Pterodactyl), damit sie nie auf den Minecraft-Nodes landen.
 */
export function serverTypeAvailable(serverType: string, settings: SiteSettings): boolean {
  if (!getEggMapping(serverType, settings)) return false;
  const kind = serverTypesOf('discord').some((t) => t.id === serverType) ? 'discord' : 'minecraft';
  return kind === 'minecraft' || env.PTERODACTYL_MODE === 'mock' || settings.products.discord.nodeIds.length > 0;
}

let publicCache: { value: PublicSiteDTO; at: number } | null = null;

/** Öffentliche Einstellungen + Kennzahlen für die Website (10 s Cache) */
export async function getPublicSite(): Promise<PublicSiteDTO> {
  if (publicCache && Date.now() - publicCache.at < 10_000) return publicCache.value;
  const s = await getSettings();
  const wl = await waitlistCounts(s);
  const capacity = await capacityState(s);
  // Verknüpfen geht erst, wenn Client-ID, Server-ID, Bot-Token und Client-Secret hinterlegt sind
  const secrets = await getDiscordSecrets();
  const discordAvailable = s.discord.enabled && !!s.discord.clientId && !!s.discord.guildId && !!secrets.botToken && !!secrets.clientSecret;
  const [logoAt] = await db.select({ updatedAt: assets.updatedAt }).from(assets).where(eq(assets.key, 'logo')).limit(1);
  let stats: PublicSiteDTO['stats'] = null;
  if (s.stats.show) {
    const [u] = await db.select({ n: count() }).from(users).where(isNotNull(users.emailVerifiedAt));
    const [a] = await db.select({ n: count() }).from(servers).where(eq(servers.status, 'active'));
    stats = {
      users: s.stats.users.mode === 'manual' ? s.stats.users.value : Number(u?.n ?? 0) + s.stats.users.offset,
      activeServers: s.stats.servers.mode === 'manual' ? s.stats.servers.value : Number(a?.n ?? 0) + s.stats.servers.offset,
      uptime: s.stats.uptime.mode === 'manual' ? s.stats.uptime.value : await uptimePercent('overall'),
    };
  }
  const value: PublicSiteDTO = {
    maintenance: { enabled: s.maintenance.enabled, message: s.maintenance.message, until: s.maintenance.until },
    registration: s.registration,
    waitlist: {
      total: s.waitlist.showCounter ? wl.confirmed + s.waitlist.externalCount : null,
      epycSlots: s.waitlist.epycSlots,
      epycUsed: wl.epycUsed,
      epycRemaining: wl.epycRemaining,
    },
    plans: capacity.plans.map(({ kind: _kind, ...p }) => p),
    products: Object.fromEntries(
      productKinds.map((kind): [ProductKind, PublicProductDTO] => {
        const p = s.products[kind];
        const c = capacity.products[kind];
        return [
          kind,
          {
            kind,
            enabled: p.enabled,
            fairUse: p.fairUse,
            ...c,
            plans: p.plans
              .filter((plan) => plan.enabled)
              .map(({ enabled: _enabled, reserved: _reserved, ...plan }) => ({ ...plan, ...capacity.plans.find((a) => a.id === plan.id)! })),
            serverTypes: serverTypesOf(kind).map((t) => ({ id: t.id, available: serverTypeAvailable(t.id, s), versions: versionsFor(s, t.id) })),
          },
        ];
      }),
    ) as PublicSiteDTO['products'],
    hardware: { ...s.hardware, storage: freeHostingConfig.hardware.storage, network: freeHostingConfig.hardware.network },
    donate: { enabled: s.donate.enabled, url: s.donate.enabled ? s.donate.url : null },
    discord: {
      available: discordAvailable,
      required: discordAvailable && s.discord.required,
      inviteUrl: s.discord.enabled ? botInviteUrl : null,
      note: s.discord.requiredNote,
    },
    botFairUse: s.botFairUse,
    brand: resolveBrand(s),
    rules: s.rules,
    domains: s.domains.extra.map((d) => ({ host: d.host, redirect: d.redirect })),
    newsletter: { enabled: s.newsletter.enabled, footerForm: s.newsletter.enabled && s.newsletter.footerForm, signupCheckbox: s.newsletter.enabled && s.newsletter.signupCheckbox },
    announcement:
      s.announcement.enabled && (s.announcement.text.de || s.announcement.text.en)
        ? { tone: s.announcement.tone, text: s.announcement.text, linkUrl: s.announcement.linkUrl, linkLabel: s.announcement.linkLabel }
        : null,
    seo: s.seo,
    logo: logoAt ? { url: `/api/v1/brand/logo?v=${logoAt.updatedAt.getTime()}`, mode: s.branding.logoMode } : null,
    session: { idleMinutes: env.SESSION_IDLE_MINUTES, maxHours: env.SESSION_MAX_HOURS, persistent: env.SESSION_PERSISTENT, cookieName: env.SESSION_COOKIE_NAME },
    beta: {
      instance: env.BETA_MODE,
      url: env.BETA_MODE ? null : (env.BETA_URL || '').replace(/\/$/, '') || null,
      mainUrl: env.BETA_MODE ? (env.MAIN_URL || '').replace(/\/$/, '') || null : null,
    },
    stats,
  };
  publicCache = { value, at: Date.now() };
  return value;
}

export function invalidatePublicSite() {
  publicCache = null;
}
