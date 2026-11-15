/**
 * Wie viele kostenlose Server eine Person haben darf (Admin → Einstellungen):
 *  – je Angebot getrennt (Minecraft-Server, Discord-Bots)
 *  – optional eine Obergrenze über beide Angebote zusammen
 *  – optional jedes Paket nur einmal (z. B. ein 4-GB- und ein 6-GB-Server, aber nicht zweimal 4 GB)
 */
import type { ProductKind } from './config/freehosting.config';
import type { Locale } from './i18n';

export interface ServerLimits {
  /** Höchstzahl an Minecraft-Servern je Person (0 = keiner) */
  minecraft: number;
  /** Höchstzahl an Discord-Bots je Person (0 = keiner) */
  discord: number;
  /** Obergrenze für alle Server einer Person zusammen (0 = keine zusätzliche Grenze) */
  total: number;
  /** Jedes Paket dieses Angebots höchstens einmal je Person */
  uniquePlan: Record<ProductKind, boolean>;
}

export const serverLimitBounds = { perKind: 10, total: 20 } as const;

export function defaultServerLimits(perKind = 1): ServerLimits {
  return { minecraft: perKind, discord: perKind, total: 0, uniquePlan: { minecraft: false, discord: false } };
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const int = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};

/**
 * `legacy` = die frühere Einstellung „Server pro Person“ (galt je Angebot) – sie wird übernommen,
 * solange noch keine getrennten Grenzen gespeichert sind.
 */
export function normalizeServerLimits(input: unknown, legacy: unknown, fallback = 1): ServerLimits {
  const i = obj(input);
  const u = obj(i.uniquePlan);
  const base = int(legacy, fallback, 1, serverLimitBounds.perKind);
  return {
    minecraft: int(i.minecraft, base, 0, serverLimitBounds.perKind),
    discord: int(i.discord, base, 0, serverLimitBounds.perKind),
    total: int(i.total, 0, 0, serverLimitBounds.total),
    uniquePlan: { minecraft: u.minecraft === true, discord: u.discord === true },
  };
}

export interface OwnedServerRef {
  kind: ProductKind;
  planId: string;
}

/**
 * Zusätzlicher Slot einer Person (z. B. Belohnung für Einladungen auf Discord).
 * `planId` = nur für dieses Paket gültig (null = jedes Paket des Angebots).
 */
export interface BonusSlot {
  kind: ProductKind;
  planId: string | null;
}

/** kind = Grenze des Angebots erreicht · total = Gesamtgrenze erreicht · plan = dieses Paket hat die Person schon */
export type ServerLimitBlock = 'kind' | 'total' | 'plan';

/**
 * Server, die NICHT von einem paketgebundenen Bonus-Slot gedeckt sind. Ein solcher Slot deckt genau einen Server
 * dieses Pakets – gedeckte Server zählen nicht gegen die Grenzen.
 */
function uncovered(owned: OwnedServerRef[], bonus: BonusSlot[]): OwnedServerRef[] {
  const bound = bonus.filter((b) => b.planId !== null);
  return owned.filter((o) => {
    const i = bound.findIndex((b) => b.kind === o.kind && b.planId === o.planId);
    if (i === -1) return true;
    bound.splice(i, 1);
    return false;
  });
}

/**
 * Darf die Person noch einen Server dieses Angebots (und, falls angegeben, dieses Pakets) anlegen? null = ja.
 * Bonus-Slots ohne Paketbindung erhöhen die Grenze des Angebots (und die Gesamtgrenze) um eins.
 */
export function serverLimitBlock(limits: ServerLimits, owned: OwnedServerRef[], kind: ProductKind, planId?: string, bonus: BonusSlot[] = []): ServerLimitBlock | null {
  const counted = uncovered(owned, bonus);
  // Deckt ein paketgebundener Bonus-Slot den neuen Server, ist er immer möglich
  if (planId && uncovered([...owned, { kind, planId }], bonus).length === counted.length) return null;
  const free = bonus.filter((b) => b.planId === null);
  if (counted.filter((o) => o.kind === kind).length >= limits[kind] + free.filter((b) => b.kind === kind).length) return 'kind';
  if (limits.total > 0 && counted.length >= limits.total + free.length) return 'total';
  if (planId && limits.uniquePlan[kind] && counted.some((o) => o.kind === kind && o.planId === planId)) return 'plan';
  return null;
}

/** Pakete eines Angebots, die die Person nicht (mehr) wählen kann, weil sie sie schon hat */
export function takenPlanIds(limits: ServerLimits, owned: OwnedServerRef[], kind: ProductKind, bonus: BonusSlot[] = []): string[] {
  if (!limits.uniquePlan[kind]) return [];
  return [...new Set(owned.filter((o) => o.kind === kind).map((o) => o.planId))].filter((id) => serverLimitBlock(limits, owned, kind, id, bonus) === 'plan');
}

/** Ist das Angebot für die Person ganz ausgeschöpft? `planIds` = die buchbaren Pakete dieses Angebots */
export function kindExhausted(limits: ServerLimits, owned: OwnedServerRef[], kind: ProductKind, planIds: string[], bonus: BonusSlot[] = []): boolean {
  if (planIds.length === 0) return serverLimitBlock(limits, owned, kind, undefined, bonus) !== null;
  return planIds.every((id) => serverLimitBlock(limits, owned, kind, id, bonus) !== null);
}

/** Die Grenzen als Satz für Website, Regeln und FAQ. `offered` = die Angebote, die es gerade gibt */
export function describeServerLimits(limits: ServerLimits, lang: Locale, offered: readonly ProductKind[] = ['minecraft', 'discord']): string {
  const de = lang === 'de';
  const name = (kind: ProductKind, n: number) =>
    kind === 'minecraft' ? (de ? `${n} Minecraft-Server` : `${n} Minecraft ${n === 1 ? 'server' : 'servers'}`) : de ? `${n} Discord-${n === 1 ? 'Bot' : 'Bots'}` : `${n} Discord ${n === 1 ? 'bot' : 'bots'}`;
  const kinds = offered.filter((k) => limits[k] > 0);
  if (kinds.length === 0) return de ? 'Derzeit können keine kostenlosen Server angelegt werden.' : 'No free servers can be created at the moment.';
  const parts = kinds.map((k) => name(k, limits[k]));
  const sum = kinds.reduce((n, k) => n + limits[k], 0);
  let text = de ? `Pro Person ${sum === 1 ? 'ist' : 'sind'} derzeit ${sum === 1 ? '' : 'bis zu '}${parts.join(' und ')} möglich` : `Per person, ${sum === 1 ? '' : 'up to '}${parts.join(' and ')} ${sum === 1 ? 'is' : 'are'} currently possible`;
  if (limits.total > 0 && limits.total < sum) text += de ? ` – zusammen höchstens ${limits.total} Server` : ` – at most ${limits.total} ${limits.total === 1 ? 'server' : 'servers'} in total`;
  text += '.';
  const unique = kinds.filter((k) => limits.uniquePlan[k] && limits[k] > 1);
  if (unique.length === kinds.length && kinds.length > 1) text += de ? ' Jedes Paket ist dabei nur einmal möglich.' : ' Each plan can only be used once.';
  else if (unique.length > 0) {
    const label = unique[0] === 'minecraft' ? (de ? 'Minecraft-Paket' : 'Minecraft plan') : de ? 'Discord-Bot-Paket' : 'Discord bot plan';
    text += de ? ` Jedes ${label} ist dabei nur einmal möglich.` : ` Each ${label} can only be used once.`;
  }
  return text;
}
