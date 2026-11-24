/**
 * Öffentliche Einstellungen aus dem Admin-Bereich (Wartung, Registrierungsmodus,
 * Warteliste, Kennzahlen). Nur serverseitig.
 *
 * Bewusst ohne Next-Datencache: Änderungen im Admin-Bereich sollen nach wenigen Sekunden
 * überall sichtbar sein. Ein kurzer Zwischenspeicher im Prozess hält die Last gering.
 */
import { connection } from 'next/server';
import { applyRuntimeConfig, defaultBrand, defaultServerLimits, defaultSiteSettings, freeHostingConfig, websiteTypesOf, type ProductKind, type PublicProductDTO, type PublicSiteDTO } from '@chfree/shared';

import { site } from './site';

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
    serverTypes: websiteTypesOf(kind).map((t) => ({ id: t.id, available: true, general: true, versions: t.versions })),
  };
}

export const fallbackSite: PublicSiteDTO = {
  maintenance: { enabled: false, message: { en: '', de: '' }, until: null },
  registration: { mode: 'open', limits: defaultServerLimits(freeHostingConfig.limits.maxServersPerUser) },
  waitlist: { total: null, epycSlots: 0, epycUsed: 0, epycRemaining: 0 },
  plans: [],
  products: { minecraft: fallbackProduct('minecraft'), discord: fallbackProduct('discord') },
  software: websiteTypesOf('minecraft').map((t) => ({ id: t.id, kind: t.kind, name: t.name, description: t.description, versions: t.versions, defaultVersion: t.defaultVersion, ...(t.recommended ? { recommended: true } : {}), edition: t.edition ?? 'java' })),
  hardware: { ...defaults.hardware, storage: freeHostingConfig.hardware.storage, network: freeHostingConfig.hardware.network },
  donate: { enabled: false, url: null },
  addons: { enabled: false, priceNote: { de: '', en: '' }, items: [] },
  chat: null,
  discord: { available: false, required: false, autoJoin: true, signup: false, inviteUrl: null, note: { de: '', en: '' } },
  botFairUse: defaults.botFairUse,
  brand: {
    ...defaultBrand(),
    ...(process.env.NEXT_PUBLIC_DISCORD_URL ? { discordUrl: process.env.NEXT_PUBLIC_DISCORD_URL } : {}),
    ...(process.env.NEXT_PUBLIC_PARENT_URL ? { parentUrl: process.env.NEXT_PUBLIC_PARENT_URL } : {}),
    ...(process.env.NEXT_PUBLIC_PARENT_PRICING_URL ? { parentPricingUrl: process.env.NEXT_PUBLIC_PARENT_PRICING_URL } : {}),
    ...(process.env.NEXT_PUBLIC_STATUS_URL ? { statusUrl: process.env.NEXT_PUBLIC_STATUS_URL } : {}),
  },
  rules: defaults.rules,
  domains: [],
  newsletter: { enabled: false, footerForm: false, signupCheckbox: false },
  announcement: null,
  seo: defaults.seo,
  logo: null,
  session: { idleMinutes: 30, maxHours: 12, persistent: false, cookieName: process.env.SESSION_COOKIE_NAME ?? 'chf_session' },
  beta: { instance: ['1', 'true', 'yes', 'on'].includes((process.env.BETA_MODE ?? '').toLowerCase()), url: null, mainUrl: process.env.MAIN_URL || null },
  stats: null,
};

/**
 * Regeln (Fair-Use, Laufzeit) und Links aus dem Admin-Bereich für diesen Prozess übernehmen:
 * Texte (getDict) und `site` aus lib/site lesen danach die eingestellten Werte.
 */
function applyRuntime(value: PublicSiteDTO) {
  // Software-Katalog: Im Bestellformular stehen genau die Einträge, die im Admin-Bereich für die Website eingeschaltet sind
  applyRuntimeConfig({ rules: value.rules, brand: value.brand, software: value.software ?? undefined });
  Object.assign(site, value.brand);
}

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
    applyRuntime(value);
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
