/**
 * Einstellungen aus dem Admin-Bereich (Wartung, Registrierung, Warteliste, Kennzahlen, Status).
 * Gespeichert als JSON in der Tabelle `settings`; kurzer Cache, damit API und Worker
 * Änderungen nach wenigen Sekunden übernehmen.
 */
import { and, count, eq, gte, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm';
import {
  blockSpotsBefore,
  defaultSiteSettings,
  freeHostingConfig,
  normalizeSiteSettings,
  websiteEpycSlots,
  type PlanAvailabilityDTO,
  type PublicSiteDTO,
  type SiteSettings,
  type WaitlistBlock,
} from '@chfree/shared';
import { db } from '../db/client';
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
      await db.insert(settingsTable).values({ key: KEY, value }).onDuplicateKeyUpdate({ set: { value } });
    }
    cache = { value, at: Date.now() };
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
  await db.insert(settingsTable).values({ key: KEY, value }).onDuplicateKeyUpdate({ set: { value } });
  cache = { value, at: Date.now() };
  return value;
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
  const settings = s ?? (await getSettings());
  const rows = await db
    .select({ planId: servers.planId, n: count() })
    .from(servers)
    .where(inArray(servers.status, [...CAPACITY_STATUSES]))
    .groupBy(servers.planId);
  return freeHostingConfig.plans.map((p) => {
    const cfg = settings.plans[p.id] ?? { capacity: p.capacity, reserved: 0 };
    const used = Number(rows.find((r) => r.planId === p.id)?.n ?? 0) + cfg.reserved + (extra[p.id] ?? 0);
    const remaining = cfg.capacity === null ? null : Math.max(0, cfg.capacity - used);
    return { id: p.id, capacity: cfg.capacity, used, remaining, available: remaining === null || remaining > 0 };
  });
}

let publicCache: { value: PublicSiteDTO; at: number } | null = null;

/** Öffentliche Einstellungen + Kennzahlen für die Website (10 s Cache) */
export async function getPublicSite(): Promise<PublicSiteDTO> {
  if (publicCache && Date.now() - publicCache.at < 10_000) return publicCache.value;
  const s = await getSettings();
  const wl = await waitlistCounts(s);
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
    plans: await planAvailability(s),
    stats,
  };
  publicCache = { value, at: Date.now() };
  return value;
}

export function invalidatePublicSite() {
  publicCache = null;
}
