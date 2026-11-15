/**
 * Einstellungen der Statusseite: Gruppen, Komponenten, Texte, Farben und Verlauf.
 * Alles hier ist im Admin-Bereich änderbar; die Standardwerte bilden die fünf eingebauten Prüfungen ab.
 */
import {
  statusIcons,
  statusSources,
  type ComponentStatus,
  type IncidentImpact,
  type SiteSettings,
  type StatusCategory,
  type StatusComponentSetting,
  type StatusDayState,
  type StatusGroupSetting,
  type StatusIcon,
  type StatusPageSettings,
  type StatusRangeSetting,
  type StatusSource,
} from './api-types';
import type { Localized } from './i18n';

export type StatusSettings = SiteSettings['status'];

export const statusCategories: StatusCategory[] = ['operational', 'degraded', 'maintenance', 'outage'];
export const statusLimits = { groups: 12, components: 40, minDays: 7, maxDays: 90, corrections: 200, ranges: 50 } as const;

/** Ordnet den Status einer Komponente einer der vier Kategorien der Legende zu (none = unbekannt) */
export function statusCategory(status: ComponentStatus): StatusDayState {
  if (status === 'operational' || status === 'degraded' || status === 'maintenance') return status;
  if (status === 'partial_outage' || status === 'major_outage') return 'outage';
  return 'none';
}

const defaultLabels = (): Record<StatusCategory, Localized> => ({
  operational: { de: 'Betriebsbereit', en: 'Operational' },
  degraded: { de: 'Eingeschränkt', en: 'Degraded' },
  maintenance: { de: 'Geplante Wartung', en: 'Scheduled maintenance' },
  outage: { de: 'Ausfall', en: 'Outage' },
});

const defaultBanners = (): Record<StatusCategory, Localized> => ({
  operational: { de: 'Alle Systeme laufen normal', en: 'All systems operational' },
  degraded: { de: 'Einige Systeme sind eingeschränkt', en: 'Some systems are degraded' },
  maintenance: { de: 'Geplante Wartungsarbeiten', en: 'Scheduled maintenance in progress' },
  outage: { de: 'Es liegt eine Störung vor', en: 'We are experiencing an outage' },
});

export const defaultStatusColors = (): Record<StatusDayState, string> => ({
  operational: '#34d17f',
  degraded: '#f59e0b',
  maintenance: '#6366f1',
  outage: '#ef4444',
  none: '#2b3140',
});

export function defaultStatusPage(): StatusPageSettings {
  return {
    title: { de: '', en: '' },
    intro: { de: '', en: '' },
    days: 90,
    showBanner: true,
    showBars: true,
    showUptime: true,
    showLegend: true,
    showLatency: false,
    showPast: true,
    showExternalLink: true,
    labels: defaultLabels(),
    banners: defaultBanners(),
    colors: defaultStatusColors(),
  };
}

export function defaultStatusGroups(): StatusGroupSetting[] {
  return [
    { id: 'dienste', name: { de: 'Dienste', en: 'Services' }, icon: 'globe' },
    { id: 'infrastruktur', name: { de: 'Infrastruktur', en: 'Infrastructure' }, icon: 'network' },
  ];
}

const empty = (): Localized => ({ de: '', en: '' });

/** Die eingebauten Komponenten. Die IDs bleiben gleich, damit der bisherige Verlauf erhalten bleibt. */
export function defaultStatusComponents(): StatusComponentSetting[] {
  const c = (id: string, group: string, name: Localized, subtitle: Localized, source: StatusSource): StatusComponentSetting => ({
    id,
    group,
    name,
    subtitle,
    source,
    target: '',
    operationalLabel: empty(),
    visible: true,
  });
  return [
    c(
      'freehosting',
      'dienste',
      { de: 'FreeHosting', en: 'FreeHosting' },
      { de: 'Registrierung · Server-Erstellung · Fair-Use-System', en: 'Sign-up · server creation · fair-use system' },
      'service',
    ),
    c('website', 'dienste', { de: 'Website', en: 'Website' }, { de: 'craftinghosting.free', en: 'craftinghosting.free' }, 'website'),
    c('api', 'dienste', { de: 'API', en: 'API' }, { de: 'API · Datenbank', en: 'API · database' }, 'api'),
    c('pterodactyl', 'infrastruktur', { de: 'Pterodactyl Panel', en: 'Pterodactyl Panel' }, { de: 'Server-Verwaltung', en: 'Server management' }, 'panel'),
    c(
      'nodes',
      'infrastruktur',
      { de: 'Server-Nodes', en: 'Server nodes' },
      { de: 'Deutschland · Dual Intel Xeon Gold 6230', en: 'Germany · Dual Intel Xeon Gold 6230' },
      'nodes',
    ),
  ];
}

export function defaultStatusSettings(): StatusSettings {
  return { overrides: {}, page: defaultStatusPage(), groups: defaultStatusGroups(), components: defaultStatusComponents(), pingNodes: true, history: {}, ranges: [] };
}

/* ------------------------------------------------------------------ Prüfung */

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max).trim() : '');
const localized = (v: unknown, def: Localized, max: number): Localized => {
  const o = obj(v);
  const de = text(o.de, max) || def.de;
  const en = text(o.en, max) || def.en;
  // Fehlt eine Sprache, gilt die andere
  return { de: de || en, en: en || de };
};

/** Macht aus einem Namen eine ID (klein, a–z 0–9 -) */
export function statusIdFromName(name: string, fallback = 'eintrag'): string {
  return (
    name
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || fallback
  );
}

const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Gültiger Kalendertag (kein 31. Februar) */
const validDay = (v: string) => DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const IMPACTS: IncidentImpact[] = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'];

function uniqueId(raw: unknown, name: string, used: Set<string>, fallback: string): string {
  let id = ID.test(String(raw ?? '')) ? String(raw) : statusIdFromName(name, fallback);
  // „overall“ ist für den Gesamtstatus im Verlauf reserviert
  if (id === 'overall') id = 'overall-1';
  for (let n = 2; used.has(id); n++) id = `${id.replace(/-\d+$/, '').slice(0, 28)}-${n}`;
  used.add(id);
  return id;
}

function normalizeTarget(source: StatusSource, raw: unknown): string {
  const v = typeof raw === 'number' ? String(raw) : text(raw, 300);
  if (source === 'node') return /^\d{1,9}$/.test(v) ? v : '';
  if (source === 'http') {
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '';
    } catch {
      return '';
    }
  }
  return '';
}

/** Führt gespeicherte (evtl. unvollständige/alte) Angaben zur Statusseite mit den Standardwerten zusammen. */
export function normalizeStatusSettings(input: unknown, now = Date.now()): StatusSettings {
  const i = obj(input);
  const d = defaultStatusSettings();
  const p = obj(i.page);
  const labels = obj(p.labels);
  const banners = obj(p.banners);
  const colors = obj(p.colors);
  const days = typeof p.days === 'number' || typeof p.days === 'string' ? Number(p.days) : NaN;

  const page: StatusPageSettings = {
    title: localized(p.title, empty(), 80),
    intro: localized(p.intro, empty(), 300),
    days: Number.isFinite(days) ? Math.min(statusLimits.maxDays, Math.max(statusLimits.minDays, Math.round(days))) : d.page.days,
    showBanner: bool(p.showBanner, d.page.showBanner),
    showBars: bool(p.showBars, d.page.showBars),
    showUptime: bool(p.showUptime, d.page.showUptime),
    showLegend: bool(p.showLegend, d.page.showLegend),
    showLatency: bool(p.showLatency, d.page.showLatency),
    showPast: bool(p.showPast, d.page.showPast),
    showExternalLink: bool(p.showExternalLink, d.page.showExternalLink),
    labels: Object.fromEntries(statusCategories.map((c) => [c, localized(labels[c], d.page.labels[c], 40)])) as StatusPageSettings['labels'],
    banners: Object.fromEntries(statusCategories.map((c) => [c, localized(banners[c], d.page.banners[c], 120)])) as StatusPageSettings['banners'],
    colors: Object.fromEntries(
      (Object.keys(d.page.colors) as StatusDayState[]).map((c) => [c, typeof colors[c] === 'string' && HEX.test(colors[c] as string) ? (colors[c] as string).toLowerCase() : d.page.colors[c]]),
    ) as StatusPageSettings['colors'],
  };

  // Gruppen: ohne gültige Gruppe gelten die Standardgruppen
  const groupIds = new Set<string>();
  let groups: StatusGroupSetting[] = (Array.isArray(i.groups) ? i.groups : [])
    .slice(0, statusLimits.groups)
    .map((raw): StatusGroupSetting | null => {
      const g = obj(raw);
      const name = localized(g.name, empty(), 60);
      if (!name.de) return null;
      return {
        id: uniqueId(g.id, name.de, groupIds, 'gruppe'),
        name,
        icon: statusIcons.includes(g.icon as StatusIcon) ? (g.icon as StatusIcon) : 'server',
      };
    })
    .filter((g): g is StatusGroupSetting => g !== null);
  if (groups.length === 0) groups = d.groups;
  const hasGroup = new Set(groups.map((g) => g.id));

  // Komponenten: nicht gesetzt = Standard · leere Liste ist erlaubt
  const componentIds = new Set<string>();
  const components: StatusComponentSetting[] = (Array.isArray(i.components) ? i.components : d.components)
    .slice(0, statusLimits.components)
    .map((raw): StatusComponentSetting | null => {
      const c = obj(raw);
      const name = localized(c.name, empty(), 60);
      if (!name.de) return null;
      const source = statusSources.includes(c.source as StatusSource) ? (c.source as StatusSource) : 'manual';
      return {
        id: uniqueId(c.id, name.de, componentIds, 'komponente'),
        group: hasGroup.has(String(c.group)) ? String(c.group) : groups[0]!.id,
        name,
        subtitle: localized(c.subtitle, empty(), 120),
        source,
        target: normalizeTarget(source, c.target),
        operationalLabel: localized(c.operationalLabel, empty(), 40),
        visible: bool(c.visible, true),
      };
    })
    .filter((c): c is StatusComponentSetting => c !== null);

  const overrides = Object.fromEntries(
    Object.entries(obj(i.overrides)).filter(([k, v]) => componentIds.has(k) && IMPACTS.includes(v as IncidentImpact)),
  ) as StatusSettings['overrides'];

  // Korrekturen am Verlauf: nur bekannte Komponenten, gültige Tage, nichts außerhalb des Verlaufs
  const oldest = new Date(now - (statusLimits.maxDays + 2) * 86_400_000).toISOString().slice(0, 10);
  const history: StatusSettings['history'] = {};
  for (const [id, raw] of Object.entries(obj(i.history))) {
    if (!componentIds.has(id)) continue;
    const entries = Object.entries(obj(raw))
      .filter(([day, state]) => DAY.test(day) && day >= oldest && statusCategories.includes(state as StatusCategory))
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, statusLimits.corrections);
    if (entries.length) history[id] = Object.fromEntries(entries) as Record<string, StatusCategory>;
  }

  // Nachgetragene Zeiträume: gültige Tage, bekannte Komponente (oder alle), nichts komplett außerhalb des Verlaufs
  const ranges: StatusRangeSetting[] = (Array.isArray(i.ranges) ? i.ranges : [])
    .map((raw): StatusRangeSetting | null => {
      const r = obj(raw);
      const a = String(r.from ?? '');
      const b = String(r.to ?? '');
      if (!validDay(a) || !validDay(b) || !statusCategories.includes(r.state as StatusCategory)) return null;
      const component = r.component === '*' ? '*' : String(r.component ?? '');
      if (component !== '*' && !componentIds.has(component)) return null;
      const [from, to] = a <= b ? [a, b] : [b, a];
      if (to < oldest) return null;
      return { component, from, to, state: r.state as StatusCategory, onlyEmpty: bool(r.onlyEmpty, true) };
    })
    .filter((r): r is StatusRangeSetting => r !== null)
    .slice(-statusLimits.ranges);

  return { overrides, page, groups, components, pingNodes: bool(i.pingNodes, d.pingNodes), history, ranges };
}

/** Zustand, den die nachgetragenen Zeiträume für einen Tag festlegen (null = keiner). Spätere Einträge gewinnen. */
export function rangeStateFor(ranges: StatusRangeSetting[], component: string, date: string, hasData: boolean): StatusCategory | null {
  let state: StatusCategory | null = null;
  for (const r of ranges) {
    if ((r.component === '*' || r.component === component) && date >= r.from && date <= r.to && (!r.onlyEmpty || !hasData)) state = r.state;
  }
  return state;
}
