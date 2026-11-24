/**
 * Kostenpflichtige Extras („Add-ons“) für kostenlose Server (Admin → Extras).
 *
 * Das Gratis-Angebot bleibt, wie es ist – Extras sind freiwillig und werden je Server gebucht. Bezahlt wird immer im
 * Voraus für eine Laufzeit (z. B. 30 Tage). Standard ist die einmalige Buchung: Sie endet von selbst, zu kündigen gibt
 * es nichts. Wahlweise (je Extra einstellbar, nur mit Online-Zahlung) als Abo: Es verlängert sich automatisch um eine
 * Laufzeit, bis der Kunde kündigt. Wer nicht verlängert, fällt automatisch auf das kostenlose Angebot zurück.
 */
import { productKinds, type ProductKind } from './config/freehosting.config';
import type { Localized } from './i18n';

/**
 * Was ein Extra bewirkt:
 *  – always_on: Das System hebt Fair-Use-Pausen und den 30-Tage-Zyklus für den Server auf („24/7“) – automatisch.
 *  – manual: Das Team richtet es ein (z. B. eigene IPv4-Adresse, Umzug auf andere Hardware, mehr Arbeitsspeicher) –
 *    nach der Zahlung erscheint eine Aufgabe im Admin-Bereich.
 */
export type AddonEffect = 'always_on' | 'manual';
export const ADDON_EFFECTS: AddonEffect[] = ['always_on', 'manual'];

export type AddonIcon = 'clock' | 'ip' | 'cpu' | 'memory' | 'disk' | 'backup' | 'star' | 'plus';
export const ADDON_ICONS: AddonIcon[] = ['clock', 'ip', 'cpu', 'memory', 'disk', 'backup', 'star', 'plus'];

export interface AddonSetting {
  /** Fester Kurzname (a–z, 0–9, Bindestrich) – bleibt gleich, auch wenn sich Name oder Preis ändern */
  id: string;
  /** Buchbar (ausgeschaltet: bestehende Buchungen laufen weiter, neue gibt es nicht) */
  enabled: boolean;
  name: Localized;
  description: Localized;
  icon: AddonIcon;
  effect: AddonEffect;
  /** Preis je Laufzeit in Cent (Euro) */
  priceCents: number;
  /** Laufzeit einer Zahlung in Tagen (0 = einmalig, gilt so lange es den Server gibt) */
  periodDays: number;
  /** Für welche Angebote (Minecraft-Server, Discord-Bots) */
  kinds: ProductKind[];
  /** Nur für diese Pakete (leer = alle) – z. B. unterschiedliche Preise je Paketgröße */
  planIds: string[];
  /** Höchstzahl gleichzeitig aktiver Buchungen (null = unbegrenzt) – z. B. so viele freie IPv4-Adressen es gibt */
  maxActive: number | null;
  /** Eigener Zahlungslink für dieses Extra (z. B. ein Zahlungslink mit festem Betrag) – für Zahlungen ohne Mollie */
  paymentUrl: string;
  /** Auf der Website hervorheben („Beliebt“) */
  highlighted: boolean;
  /** Auch als Abo anbieten: verlängert sich automatisch um eine Laufzeit (nur mit Online-Zahlung und Laufzeit > 0) */
  subscription: boolean;
}

export interface AddonSettings {
  /** Extras auf der Website anbieten */
  enabled: boolean;
  items: AddonSetting[];
  /** Hinweis unter jedem Preis, z. B. „inkl. MwSt.“ oder „Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.“ */
  priceNote: Localized;
  /** So wird ohne Automatik bezahlt (erscheint nach der Bestellung zusammen mit dem Verwendungszweck) */
  paymentNote: Localized;
  /** Vor dem Kauf bestätigen lassen: volljährig oder Zustimmung der Erziehungsberechtigten */
  requireAdultConfirm: boolean;
  /** Offene, unbezahlte Bestellungen nach so vielen Tagen verwerfen */
  pendingDays: number;
  /** So viele Tage vor Ablauf an die Verlängerung erinnern */
  remindDaysBefore: number;
}

export const MAX_ADDONS = 30;
/** Kürzeste Laufzeit, für die es ein Abo geben kann */
export const MIN_SUBSCRIPTION_DAYS = 7;
export const ADDON_ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

const preset = (id: string, icon: AddonIcon, effect: AddonEffect, priceCents: number, name: Localized, description: Localized, extra: Partial<AddonSetting> = {}): AddonSetting => ({
  id,
  enabled: false,
  name,
  description,
  icon,
  effect,
  priceCents,
  periodDays: 30,
  kinds: ['minecraft'],
  planIds: [],
  maxActive: null,
  paymentUrl: '',
  highlighted: false,
  subscription: false,
  ...extra,
});

/** Vorschläge – alle ausgeschaltet, bis der Admin sie prüft, bepreist und einschaltet */
export function defaultAddons(): AddonSetting[] {
  return [
    preset(
      'always-on',
      'clock',
      'always_on',
      250,
      { de: '24/7 – ohne Pausen', en: '24/7 – no breaks' },
      {
        de: 'Dein Server läuft durchgehend: keine Fair-Use-Pausen, kein Ruhetag und kein Verlängern alle 30 Tage, solange das Extra aktiv ist.',
        en: 'Your server runs around the clock: no fair-use breaks, no rest day and no renewing every 30 days while the extra is active.',
      },
      { highlighted: true, subscription: true },
    ),
    preset(
      'ipv4',
      'ip',
      'manual',
      350,
      { de: 'Eigene IPv4-Adresse', en: 'Dedicated IPv4 address' },
      {
        de: 'Eine eigene IPv4-Adresse nur für deinen Server – mit Standard-Port 25565, ganz ohne Port in der Adresse. Wir richten sie nach der Zahlung für dich ein.',
        en: 'An IPv4 address just for your server – with the default port 25565, no port in the address. We set it up for you after payment.',
      },
    ),
    preset(
      'epyc',
      'cpu',
      'manual',
      200,
      { de: 'Upgrade auf AMD EPYC', en: 'Upgrade to AMD EPYC' },
      {
        de: 'Dein Server zieht vom Intel Xeon auf unsere schnelleren AMD-EPYC-Systeme um – spürbar mehr Leistung pro Kern. Den Umzug übernehmen wir, deine Welt bleibt erhalten.',
        en: 'Your server moves from Intel Xeon to our faster AMD EPYC systems – noticeably more performance per core. We handle the move, your world is kept.',
      },
    ),
  ];
}

export function defaultAddonSettings(): AddonSettings {
  return {
    enabled: false,
    items: defaultAddons(),
    priceNote: { de: '', en: '' },
    paymentNote: {
      de: 'Bitte überweise den Betrag über den Zahlungslink und gib den Verwendungszweck an. Sobald die Zahlung bei uns eingegangen ist, schalten wir das Extra frei – in der Regel innerhalb von 24 Stunden.',
      en: 'Please pay the amount via the payment link and state the payment reference. As soon as we have received the payment we activate the extra – usually within 24 hours.',
    },
    requireAdultConfirm: true,
    pendingDays: 7,
    remindDaysBefore: 3,
  };
}

const text = (v: unknown, max: number, fallback = ''): string => (typeof v === 'string' ? v.trim().slice(0, max) : fallback);
const loc = (v: unknown, max: number, fallback: Localized): Localized => {
  const o = (v ?? {}) as Partial<Localized>;
  return { de: text(o.de, max, fallback.de), en: text(o.en, max, fallback.en) };
};
const int = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const httpsUrl = (v: unknown): string => {
  const s = text(v, 300);
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
};

function normalizeAddon(raw: unknown, used: Set<string>): AddonSetting | null {
  const i = (raw ?? {}) as Partial<AddonSetting>;
  const id = text(i.id, 32).toLowerCase();
  if (!ADDON_ID_RE.test(id) || used.has(id)) return null;
  const name = loc(i.name, 60, { de: '', en: '' });
  if (!name.de && !name.en) return null;
  used.add(id);
  const kinds = Array.isArray(i.kinds) ? productKinds.filter((k) => (i.kinds as unknown[]).includes(k)) : [];
  return {
    id,
    enabled: i.enabled === true,
    name: { de: name.de || name.en, en: name.en || name.de },
    description: loc(i.description, 400, { de: '', en: '' }),
    icon: ADDON_ICONS.includes(i.icon as AddonIcon) ? (i.icon as AddonIcon) : 'plus',
    effect: ADDON_EFFECTS.includes(i.effect as AddonEffect) ? (i.effect as AddonEffect) : 'manual',
    priceCents: int(i.priceCents, 0, 100_000, 0),
    periodDays: int(i.periodDays, 0, 366, 30),
    kinds: kinds.length ? kinds : ['minecraft'],
    planIds: Array.isArray(i.planIds) ? [...new Set(i.planIds.filter((p): p is string => typeof p === 'string' && p.length > 0 && p.length <= 64))].slice(0, 40) : [],
    maxActive: i.maxActive === null || i.maxActive === undefined || (i.maxActive as unknown) === '' ? null : int(i.maxActive, 0, 100_000, 0),
    paymentUrl: httpsUrl(i.paymentUrl),
    highlighted: i.highlighted === true,
    // Abos erst ab einer Woche Laufzeit – darunter ließe sich die Abbuchung nicht rechtzeitig ankündigen
    subscription: i.subscription === true && int(i.periodDays, 0, 366, 30) >= MIN_SUBSCRIPTION_DAYS,
  };
}

export function normalizeAddonSettings(raw: unknown): AddonSettings {
  const d = defaultAddonSettings();
  const i = (raw ?? {}) as Partial<AddonSettings>;
  const used = new Set<string>();
  const items = Array.isArray(i.items)
    ? i.items
        .slice(0, MAX_ADDONS)
        .map((a) => normalizeAddon(a, used))
        .filter((a): a is AddonSetting => a !== null)
    : d.items;
  return {
    enabled: i.enabled === true,
    items,
    priceNote: loc(i.priceNote, 200, d.priceNote),
    paymentNote: loc(i.paymentNote, 600, d.paymentNote),
    requireAdultConfirm: i.requireAdultConfirm !== false,
    pendingDays: int(i.pendingDays, 1, 30, d.pendingDays),
    remindDaysBefore: int(i.remindDaysBefore, 0, 14, d.remindDaysBefore),
  };
}

/** Preis als Text: 250 → „2,50 €“ bzw. “€2.50” */
export function formatAddonPrice(cents: number, lang: 'de' | 'en'): string {
  const euros = (cents / 100).toFixed(2);
  return lang === 'de' ? `${euros.replace('.', ',')} €` : `€${euros}`;
}

/** Laufzeit als Text: 30 → „30 Tage“, 0 → „einmalig“ */
export function formatAddonPeriod(days: number, lang: 'de' | 'en'): string {
  if (days <= 0) return lang === 'de' ? 'einmalig' : 'one-time';
  return lang === 'de' ? `${days} ${days === 1 ? 'Tag' : 'Tage'}` : `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** Passt dieses Extra zu einem Server (Angebot und Paket)? */
export function addonFits(addon: Pick<AddonSetting, 'kinds' | 'planIds'>, server: { kind: ProductKind; planId: string }): boolean {
  return addon.kinds.includes(server.kind) && (addon.planIds.length === 0 || addon.planIds.includes(server.planId));
}

/** Extra ohne interne Angaben (Zahlungslink, Höchstzahl) – für die Website */
export interface PublicAddon {
  id: string;
  name: Localized;
  description: Localized;
  icon: AddonIcon;
  effect: AddonEffect;
  priceCents: number;
  periodDays: number;
  kinds: ProductKind[];
  planIds: string[];
  highlighted: boolean;
  /** Auch als Abo buchbar (nur wenn online bezahlt werden kann) */
  subscription: boolean;
}

/** `online` = Online-Zahlung ist eingerichtet (nur dann gibt es Abos) */
export function publicAddon(a: AddonSetting, online = false): PublicAddon {
  return { id: a.id, name: a.name, description: a.description, icon: a.icon, effect: a.effect, priceCents: a.priceCents, periodDays: a.periodDays, kinds: a.kinds, planIds: a.planIds, highlighted: a.highlighted, subscription: online && a.subscription && a.periodDays >= MIN_SUBSCRIPTION_DAYS };
}

export interface PublicAddonCatalog {
  enabled: boolean;
  priceNote: Localized;
  items: PublicAddon[];
  /** Unbezahlte Bestellungen verfallen nach so vielen Tagen */
  pendingDays: number;
  /** So viele Tage vor dem Ende gibt es eine Erinnerung (0 = keine) */
  remindDaysBefore: number;
  /** Online-Zahlung eingerichtet (sonst Zahlungslink und Bestätigung durch das Team) */
  online: boolean;
  /** Mindestens ein Extra gibt es auch als Abo */
  subscriptions: boolean;
}

/** Katalog für die öffentliche Website: nur eingeschaltete Extras mit Preis */
export function publicAddonCatalog(s: AddonSettings, online = false): PublicAddonCatalog {
  const items = s.enabled ? s.items.filter((a) => a.enabled && a.priceCents > 0).map((a) => publicAddon(a, online)) : [];
  return { enabled: s.enabled, priceNote: s.priceNote, items, pendingDays: s.pendingDays, remindDaysBefore: s.remindDaysBefore, online, subscriptions: items.some((a) => a.subscription) };
}

/** Abo: so viele Tage vor dem Ende der Laufzeit wird abgebucht (Lastschriften brauchen ein paar Tage) */
export function addonRenewLeadDays(periodDays: number): number {
  return Math.max(1, Math.min(3, Math.floor(periodDays / 3)));
}
