/**
 * Öffentliche Einstellungen aus dem Admin-Bereich (Wartung, Registrierungsmodus,
 * Warteliste, Kennzahlen). Nur serverseitig.
 *
 * Bewusst ohne Next-Datencache: Änderungen im Admin-Bereich sollen nach wenigen Sekunden
 * überall sichtbar sein. Ein kurzer Zwischenspeicher im Prozess hält die Last gering.
 */
import { connection } from 'next/server';
import { defaultSiteSettings, freeHostingConfig, serverTypesOf, type ProductKind, type PublicProductDTO, type PublicSiteDTO } from '@chfree/shared';

const API = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const TTL_MS = 5_000;

const defaults = defaultSiteSettings();

/** Standard-Pakete, falls die API kurz nicht erreichbar ist */
function fallbackProduct(kind: ProductKind): PublicProductDTO {
  const p = defaults.products[kind];
  return {
    kind,
    enabled: p.enabled,
    fairUse: p.fairUse,
    capacity: p.capacity,
    used: 0,
    remaining: p.capacity,
    available: true,
    plans: p.plans.map(({ enabled: _enabled, reserved: _reserved, ...plan }) => ({ ...plan, kind, used: 0, remaining: plan.capacity, available: true })),
    serverTypes: serverTypesOf(kind).map((t) => ({ id: t.id, available: true })),
  };
}

export const fallbackSite: PublicSiteDTO = {
  maintenance: { enabled: false, message: { en: '', de: '' }, until: null },
  registration: { mode: 'open', maxServersPerUser: freeHostingConfig.limits.maxServersPerUser },
  waitlist: { total: null, epycSlots: 0, epycUsed: 0, epycRemaining: 0 },
  plans: [],
  products: { minecraft: fallbackProduct('minecraft'), discord: fallbackProduct('discord') },
  hardware: { ...defaults.hardware, storage: freeHostingConfig.hardware.storage, network: freeHostingConfig.hardware.network },
  donate: { enabled: false, url: null },
  stats: null,
};

let cache: { at: number; value: PublicSiteDTO } | null = null;
let inflight: Promise<PublicSiteDTO> | null = null;

async function load(): Promise<PublicSiteDTO> {
  try {
    const res = await fetch(`${API}/api/v1/site`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    const data = (await res.json()) as { site?: PublicSiteDTO };
    if (!res.ok || !data.site) throw new Error(String(res.status));
    // Fehlende Felder (z. B. API noch auf altem Stand während eines Updates) mit Standardwerten auffüllen
    const value: PublicSiteDTO = { ...fallbackSite, ...data.site };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    // API kurz nicht erreichbar → letzter bekannter Stand bzw. Standardwerte
    return cache?.value ?? fallbackSite;
  }
}

export async function getSite(): Promise<PublicSiteDTO> {
  // Seite bei jedem Aufruf rendern – die Einstellungen dürfen nicht statisch eingefroren werden
  await connection();
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  inflight ??= load().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Aktuelle Werte ohne Zwischenspeicher (z. B. für die Wartungsseite) */
export async function getSiteFresh(): Promise<PublicSiteDTO> {
  cache = null;
  return getSite();
}
