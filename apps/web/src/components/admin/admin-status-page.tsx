'use client';

/**
 * Statusseite gestalten: Darstellung (Texte, Farben, Zeitraum), Gruppen, Komponenten mit ihrer Prüfung,
 * fester Status je Komponente und Korrekturen am Verlauf. Gespeichert wird alles zusammen.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ExternalLink, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import {
  defaultStatusPage,
  statusCategories,
  statusIcons,
  statusIdFromName,
  statusLimits,
  statusSources,
  type AdminPanelDTO,
  type IncidentImpact,
  type Localized,
  type SiteSettings,
  type StatusCategory,
  type StatusComponentSetting,
  type StatusDayState,
  type StatusGroupSetting,
  type StatusIcon,
  type StatusPageSettings,
  type StatusRangeSetting,
  type StatusSource,
} from '@chfree/shared';
import { Labeled, NumberInput, Section, Toggle } from '@/components/admin/admin-settings';
import { STATUS_ICONS } from '@/components/status/status-board';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Status = SiteSettings['status'];
type Override = IncidentImpact | 'auto';
/** Komponente im Formular: neue Einträge haben noch keine ID, der feste Status hängt direkt daran */
type Draft = StatusComponentSetting & { key: string; override: Override; open: boolean };

const SOURCE_LABEL: Record<StatusSource, string> = {
  manual: 'Manuell – kein automatischer Check',
  service: 'FreeHosting gesamt (API, Panel, Hintergrund-Jobs)',
  website: 'Website',
  api: 'API & Datenbank',
  panel: 'Pterodactyl Panel',
  nodes: 'Alle Nodes zusammen',
  node: 'Ein bestimmter Node',
  http: 'Eigene Adresse (HTTP-Check)',
};

const SOURCE_HINT: Record<StatusSource, string> = {
  manual: 'Zeigt „Betriebsbereit“, bis du unten einen festen Status wählst oder eine Meldung anlegst. Passend für Dinge, die sich nicht messen lassen (z. B. DDoS-Schutz, Uplink).',
  service: 'Prüft Datenbank, Panel und ob die Hintergrund-Jobs in den letzten 10 Minuten liefen.',
  website: 'Prüft, ob die Website antwortet.',
  api: 'Prüft die Datenbank hinter der API (über 500 ms gilt als eingeschränkt).',
  panel: 'Prüft, ob das Pterodactyl Panel über die API erreichbar ist.',
  nodes: 'Alle Nodes aus dem Panel: Wartungsmodus und – wenn eingeschaltet – direkter Ping auf Wings.',
  node: 'Ein einzelner Node aus dem Panel: Wartungsmodus und – wenn eingeschaltet – direkter Ping auf Wings.',
  http: 'Ruft die Adresse alle 5 Minuten ab. Keine Antwort oder ein Serverfehler (5xx) gilt als Ausfall.',
};

const ICON_LABEL: Record<StatusIcon, string> = {
  network: 'Netzwerk',
  server: 'Server',
  cpu: 'Prozessor',
  globe: 'Weltkugel',
  database: 'Datenbank',
  shield: 'Schutzschild',
  bot: 'Bot',
  gamepad: 'Gamepad',
  cloud: 'Cloud',
  activity: 'Puls',
  mail: 'E-Mail',
  lock: 'Schloss',
  zap: 'Blitz',
  box: 'Paket',
};

const OVERRIDES: [Override, string][] = [
  ['auto', 'Automatisch (Prüfung)'],
  ['operational', 'Betriebsbereit'],
  ['degraded', 'Eingeschränkt'],
  ['partial_outage', 'Teilausfall'],
  ['major_outage', 'Ausfall'],
  ['maintenance', 'Wartung'],
];

const CATEGORY_NAME: Record<StatusDayState, string> = {
  operational: 'Betriebsbereit',
  degraded: 'Eingeschränkt',
  maintenance: 'Geplante Wartung',
  outage: 'Ausfall',
  none: 'Keine Messdaten',
};

let keyCounter = 0;
const newKey = () => `k${++keyCounter}`;
const emptyText = (): Localized => ({ de: '', en: '' });

function toDrafts(status: Status): Draft[] {
  return status.components.map((c) => ({ ...c, key: newKey(), override: status.overrides[c.id] ?? 'auto', open: false }));
}

/** Formular → Einstellungen. Neue Komponenten bekommen eine ID aus ihrem Namen. */
function buildStatus(page: StatusPageSettings, groups: StatusGroupSetting[], drafts: Draft[], pingNodes: boolean, history: Status['history'], ranges: StatusRangeSetting[]): Status {
  const used = new Set(drafts.map((d) => d.id).filter(Boolean));
  const overrides: Status['overrides'] = {};
  const components = drafts
    .filter((d) => d.name.de.trim() || d.name.en.trim())
    .map(({ key: _key, override, open: _open, ...c }): StatusComponentSetting => {
      let id = c.id;
      if (!id) {
        const base = statusIdFromName(c.name.de || c.name.en, 'komponente');
        id = base === 'overall' ? 'overall-1' : base;
        for (let n = 2; used.has(id); n++) id = `${base.slice(0, 28)}-${n}`;
        used.add(id);
      }
      if (override !== 'auto') overrides[id] = override;
      return { ...c, id };
    });
  return { overrides, page, groups: groups.filter((g) => g.name.de.trim() || g.name.en.trim()), components, pingNodes, history, ranges };
}

function move<T>(list: T[], index: number, by: number): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

function Text({ value, onChange, placeholder, maxLength = 120 }: { value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number }) {
  return <input type="text" className="input" value={value} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

/** Zwei Felder nebeneinander: Deutsch und Englisch (bleibt Englisch leer, gilt der deutsche Text) */
function TwoLang({ label, value, onChange, placeholder, maxLength, hint }: { label: string; value: Localized; onChange: (v: Localized) => void; placeholder?: Localized; maxLength?: number; hint?: string }) {
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Labeled label={`${label} (Deutsch)`}>
          <Text value={value.de} placeholder={placeholder?.de} maxLength={maxLength} onChange={(de) => onChange({ ...value, de })} />
        </Labeled>
        <Labeled label={`${label} (Englisch)`}>
          <Text value={value.en} placeholder={placeholder?.en || value.de} maxLength={maxLength} onChange={(en) => onChange({ ...value, en })} />
        </Labeled>
      </div>
      {hint && <p className="mt-1.5 text-[13px] text-subtle">{hint}</p>}
    </div>
  );
}

function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md border border-line text-muted transition-colors hover:text-white disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-4',
        danger && 'hover:border-red-400/40 hover:text-red-300',
      )}
    >
      {children}
    </button>
  );
}

export function StatusPageEditor({ settings, live, statusPath }: { settings: SiteSettings; live: Record<string, string>; statusPath: string }) {
  const router = useRouter();
  const initial = settings.status;
  const [page, setPage] = useState<StatusPageSettings>(initial.page);
  const [groups, setGroups] = useState<StatusGroupSetting[]>(initial.groups);
  const [drafts, setDrafts] = useState<Draft[]>(() => toDrafts(initial));
  const [pingNodes, setPingNodes] = useState(initial.pingNodes);
  const [history, setHistory] = useState<Status['history']>(initial.history);
  const [ranges, setRanges] = useState<StatusRangeSetting[]>(initial.ranges);
  // Vergleichsstand für „ungespeicherte Änderungen“
  const [baseline, setBaseline] = useState(() => JSON.stringify(buildStatus(initial.page, initial.groups, toDrafts(initial), initial.pingNodes, initial.history, initial.ranges)));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [nodes, setNodes] = useState<{ id: number; name: string }[] | null>(null);

  const setP = (patch: Partial<StatusPageSettings>) => setPage((p) => ({ ...p, ...patch }));
  const setDraft = (key: string, patch: Partial<Draft>) => setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const defaults = useMemo(() => defaultStatusPage(), []);

  // Nodes aus dem Panel nur laden, wenn eine Komponente einen einzelnen Node prüft
  const wantsNodes = drafts.some((d) => d.source === 'node');
  useEffect(() => {
    if (!wantsNodes || nodes) return;
    let cancelled = false;
    api<{ panel: AdminPanelDTO }>('/admin/panel')
      .then((res) => !cancelled && setNodes(res.panel.nodes.map((n) => ({ id: n.id, name: n.name }))))
      .catch(() => !cancelled && setNodes([]));
    return () => {
      cancelled = true;
    };
  }, [wantsNodes, nodes]);

  const build = () => buildStatus(page, groups, drafts, pingNodes, history, ranges);
  const dirty = JSON.stringify(build()) !== baseline;

  async function onSave() {
    setPending(true);
    setMessage(null);
    try {
      // Aktuellen Stand holen, damit Änderungen aus anderen Reitern nicht überschrieben werden
      const current = (await api<{ settings: SiteSettings }>('/admin/settings')).settings;
      const saved = (await api<{ settings: SiteSettings }>('/admin/settings', { body: { ...current, status: build() } })).settings.status;
      setPage(saved.page);
      setGroups(saved.groups);
      setDrafts(toDrafts(saved));
      setPingNodes(saved.pingNodes);
      setHistory(saved.history);
      setRanges(saved.ranges);
      setBaseline(JSON.stringify(buildStatus(saved.page, saved.groups, toDrafts(saved), saved.pingNodes, saved.history, saved.ranges)));
      setMessage({ ok: true, text: 'Gespeichert. Die Statusseite zeigt die Änderungen sofort.' });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiClientError ? err.message : 'Speichern fehlgeschlagen.' });
    } finally {
      setPending(false);
    }
  }

  function addGroup() {
    const used = new Set(groups.map((g) => g.id));
    let n = groups.length + 1;
    while (used.has(`gruppe-${n}`)) n++;
    setGroups((list) => [...list, { id: `gruppe-${n}`, name: emptyText(), icon: 'server' }]);
  }

  function removeGroup(id: string) {
    const rest = groups.filter((g) => g.id !== id);
    if (rest.length === 0) return;
    setGroups(rest);
    // Komponenten der gelöschten Gruppe wandern in die erste verbleibende
    setDrafts((list) => list.map((d) => (d.group === id ? { ...d, group: rest[0]!.id } : d)));
  }

  function addComponent() {
    setDrafts((list) => [
      ...list,
      { key: newKey(), id: '', group: groups[0]?.id ?? '', name: emptyText(), subtitle: emptyText(), source: 'manual', target: '', operationalLabel: emptyText(), visible: true, override: 'auto', open: true },
    ]);
  }

  return (
    <div className="space-y-5">
      <Section
        title="Darstellung"
        description="Was Besucher auf der Statusseite sehen. Leere Textfelder verwenden den Standardtext. Die Adresse des Links unter der Seite steht unter Einstellungen → Links."
      >
        <TwoLang label="Überschrift" value={page.title} maxLength={80} placeholder={{ de: 'CraftingHosting Network Status', en: 'CraftingHosting Network Status' }} onChange={(title) => setP({ title })} />
        <TwoLang
          label="Einleitung"
          value={page.intro}
          maxLength={300}
          placeholder={{ de: 'Aktueller Zustand aller Systeme hinter CraftingHosting.free.', en: 'Current state of all systems behind CraftingHosting.free.' }}
          onChange={(intro) => setP({ intro })}
        />
        <div>
          <p className="mb-1.5 text-sm font-medium text-gray-200">Ein Balken im Verlauf steht für</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['hour', 'eine Stunde', 'Der Verlauf rückt jede Stunde weiter.'],
                ['day', 'einen Tag', 'Der Verlauf rückt jeden Tag weiter.'],
              ] as const
            ).map(([unit, label, hint]) => (
              <button
                key={unit}
                type="button"
                onClick={() => setP({ unit })}
                aria-pressed={page.unit === unit}
                className={cn('rounded-lg border px-3.5 py-2 text-left text-sm transition-colors', page.unit === unit ? 'border-blue-400/60 bg-blue-500/10 text-white' : 'border-line-strong text-muted hover:text-white')}
              >
                <span className="block font-medium">{label}</span>
                <span className="block text-[12px] text-subtle">{hint}</span>
              </button>
            ))}
          </div>
        </div>
        {page.unit === 'hour' ? (
          <Labeled
            label="Zeitraum des Verlaufs (Stunden)"
            hint={`${statusLimits.minHours}–${statusLimits.maxHours} Stunden. So viele Balken zeigt jede Komponente – bei 90 also die letzten 90 Stunden. Die Prozentzahl wird über genau diesen Zeitraum berechnet. Gemessen wird weiter alle 5 Minuten; der laufende Balken zeigt eine Störung sofort.`}
            className="max-w-md"
          >
            <NumberInput value={page.hours} min={statusLimits.minHours} max={statusLimits.maxHours} onChange={(hours) => setP({ hours })} />
          </Labeled>
        ) : (
          <Labeled label="Zeitraum des Verlaufs (Tage)" hint={`${statusLimits.minDays}–${statusLimits.maxDays} Tage. So viele Balken zeigt jede Komponente; die Prozentzahl gilt für denselben Zeitraum.`} className="max-w-md">
            <NumberInput value={page.days} min={statusLimits.minDays} max={statusLimits.maxDays} onChange={(days) => setP({ days })} />
          </Labeled>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Toggle checked={page.showBanner} onChange={(showBanner) => setP({ showBanner })} label="Banner mit Gesamtzustand" hint="Die farbige Zeile ganz oben, z. B. „Alle Systeme laufen normal“." />
          <Toggle checked={page.showBars} onChange={(showBars) => setP({ showBars })} label="Verlaufsbalken" hint="Ein Balken pro Stunde bzw. Tag und Komponente." />
          <Toggle checked={page.showUptime} onChange={(showUptime) => setP({ showUptime })} label="Verfügbarkeit in Prozent" hint="Die Zahl unter den Balken, z. B. 99,97 %." />
          <Toggle checked={page.showLegend} onChange={(showLegend) => setP({ showLegend })} label="Legende" hint="Erklärt die Farben unter den Gruppen." />
          <Toggle checked={page.showLatency} onChange={(showLatency) => setP({ showLatency })} label="Antwortzeit" hint="Zeigt die gemessene Antwortzeit in Millisekunden neben dem Status." />
          <Toggle checked={page.showPast} onChange={(showPast) => setP({ showPast })} label="Vergangene Meldungen" hint="Meldungen der letzten 14 Tage unter der Seite." />
          <Toggle checked={page.showExternalLink} onChange={(showExternalLink) => setP({ showExternalLink })} label="Link zur Statusseite des Hauptanbieters" hint="„Status aller CraftingHosting-Dienste“ unter der Seite." />
          <Toggle checked={pingNodes} onChange={setPingNodes} label="Nodes direkt anpingen" hint="Fragt Wings auf jedem Node direkt ab. Ausschalten, wenn die Nodes von diesem Server aus nicht erreichbar sind." />
        </div>
      </Section>

      <Section title="Zustände: Texte und Farben" description="Die vier Zustände der Legende. Der Text steht neben jeder Komponente und in der Legende, der Banner-Text ganz oben auf der Seite.">
        <div className="space-y-4">
          {statusCategories.map((c: StatusCategory) => (
            <div key={c} className="rounded-lg border border-line p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-white">
                  <span className="size-3 rounded-[3px]" style={{ backgroundColor: page.colors[c] }} aria-hidden />
                  {CATEGORY_NAME[c]}
                </p>
                <label className="flex items-center gap-2 text-[13px] text-subtle">
                  Farbe
                  <input
                    type="color"
                    className="h-8 w-12 cursor-pointer rounded border border-line bg-transparent p-0.5"
                    value={page.colors[c]}
                    onChange={(e) => setP({ colors: { ...page.colors, [c]: e.target.value } })}
                  />
                </label>
              </div>
              <div className="mt-3 space-y-3">
                <TwoLang label="Text" value={page.labels[c]} maxLength={40} placeholder={defaults.labels[c]} onChange={(v) => setP({ labels: { ...page.labels, [c]: v } })} />
                <TwoLang label="Banner" value={page.banners[c]} maxLength={120} placeholder={defaults.banners[c]} onChange={(v) => setP({ banners: { ...page.banners, [c]: v } })} />
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-200">
              Farbe für Tage ohne Messdaten
              <input
                type="color"
                className="h-8 w-12 cursor-pointer rounded border border-line bg-transparent p-0.5"
                value={page.colors.none}
                onChange={(e) => setP({ colors: { ...page.colors, none: e.target.value } })}
              />
            </label>
            <Button variant="ghost" size="sm" icon={<RotateCcw />} onClick={() => setP({ labels: defaults.labels, banners: defaults.banners, colors: defaults.colors })}>
              Texte und Farben zurücksetzen
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Gruppen" description="Jede Gruppe ist eine Karte auf der Statusseite, z. B. „Netzwerk“ oder „Game-Nodes“. Gruppen ohne sichtbare Komponente werden nicht angezeigt.">
        <ul className="space-y-3">
          {groups.map((g, i) => {
            const Icon = STATUS_ICONS[g.icon];
            return (
              <li key={g.id} className="grid gap-3 rounded-lg border border-line p-4 sm:grid-cols-[1fr_1fr_170px_auto] sm:items-end">
                <Labeled label="Name (Deutsch)">
                  <Text value={g.name.de} maxLength={60} placeholder="z. B. Netzwerk" onChange={(de) => setGroups((l) => l.map((x) => (x.id === g.id ? { ...x, name: { ...x.name, de } } : x)))} />
                </Labeled>
                <Labeled label="Name (Englisch)">
                  <Text value={g.name.en} maxLength={60} placeholder={g.name.de || 'e.g. Network'} onChange={(en) => setGroups((l) => l.map((x) => (x.id === g.id ? { ...x, name: { ...x.name, en } } : x)))} />
                </Labeled>
                <Labeled label="Symbol">
                  <span className="flex items-center gap-2">
                    <Icon className="size-5 shrink-0 text-muted" aria-hidden />
                    <select className="input" value={g.icon} onChange={(e) => setGroups((l) => l.map((x) => (x.id === g.id ? { ...x, icon: e.target.value as StatusIcon } : x)))}>
                      {statusIcons.map((icon) => (
                        <option key={icon} value={icon}>
                          {ICON_LABEL[icon]}
                        </option>
                      ))}
                    </select>
                  </span>
                </Labeled>
                <div className="flex gap-1.5 pb-1.5">
                  <IconButton label="Nach oben" disabled={i === 0} onClick={() => setGroups((l) => move(l, i, -1))}>
                    <ArrowUp />
                  </IconButton>
                  <IconButton label="Nach unten" disabled={i === groups.length - 1} onClick={() => setGroups((l) => move(l, i, 1))}>
                    <ArrowDown />
                  </IconButton>
                  <IconButton label="Gruppe löschen" danger disabled={groups.length <= 1} onClick={() => removeGroup(g.id)}>
                    <Trash2 />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ul>
        <Button variant="secondary" size="sm" icon={<Plus />} disabled={groups.length >= statusLimits.groups} onClick={addGroup}>
          Gruppe hinzufügen
        </Button>
      </Section>

      <Section
        title="Komponenten"
        description="Jede Komponente ist eine Zeile mit Name, Unterzeile, Status und Verlauf. Die Prüfung legt fest, woher der Status kommt. Ein fester Status hat immer Vorrang und gilt, bis du ihn wieder auf „Automatisch“ stellst."
      >
        <ul className="space-y-3">
          {drafts.map((d, i) => {
            const title = d.name.de || d.name.en || 'Neue Komponente';
            const group = groups.find((g) => g.id === d.group);
            return (
              <li key={d.key} className="rounded-lg border border-line">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDraft(d.key, { open: !d.open })} aria-expanded={d.open}>
                    <span className="flex flex-wrap items-baseline gap-x-2.5">
                      <span className={cn('text-sm font-semibold', d.visible ? 'text-white' : 'text-subtle line-through')}>{title}</span>
                      {d.subtitle.de && <span className="text-[12px] text-subtle">{d.subtitle.de}</span>}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-subtle">
                      {group?.name.de || 'Ohne Gruppe'} · {SOURCE_LABEL[d.source].split(' – ')[0]}
                      {d.override !== 'auto' && <span className="text-amber-300"> · fest: {OVERRIDES.find(([v]) => v === d.override)?.[1]}</span>}
                      {d.id && live[d.id] && <> · aktuell angezeigt: {live[d.id]}</>}
                      {!d.visible && ' · ausgeblendet'}
                    </span>
                  </button>
                  <div className="flex gap-1.5">
                    <IconButton label="Nach oben" disabled={i === 0} onClick={() => setDrafts((l) => move(l, i, -1))}>
                      <ArrowUp />
                    </IconButton>
                    <IconButton label="Nach unten" disabled={i === drafts.length - 1} onClick={() => setDrafts((l) => move(l, i, 1))}>
                      <ArrowDown />
                    </IconButton>
                    <IconButton label="Komponente löschen" danger onClick={() => setDrafts((l) => l.filter((x) => x.key !== d.key))}>
                      <Trash2 />
                    </IconButton>
                    <Button variant="secondary" size="sm" onClick={() => setDraft(d.key, { open: !d.open })}>
                      {d.open ? 'Schließen' : 'Bearbeiten'}
                    </Button>
                  </div>
                </div>
                {d.open && (
                  <div className="space-y-4 border-t border-line px-4 py-4">
                    <TwoLang label="Name" value={d.name} maxLength={60} placeholder={{ de: 'z. B. Xeon Gold Node', en: '' }} onChange={(name) => setDraft(d.key, { name })} />
                    <TwoLang
                      label="Unterzeile"
                      value={d.subtitle}
                      maxLength={120}
                      placeholder={{ de: 'z. B. DE-XEON-01 · Dual Intel Xeon Gold 6230', en: '' }}
                      hint="Kleine graue Zeile neben dem Namen. Kann leer bleiben."
                      onChange={(subtitle) => setDraft(d.key, { subtitle })}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Labeled label="Gruppe">
                        <select className="input" value={d.group} onChange={(e) => setDraft(d.key, { group: e.target.value })}>
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name.de || g.name.en || 'Neue Gruppe'}
                            </option>
                          ))}
                        </select>
                      </Labeled>
                      <Labeled label="Prüfung">
                        <select className="input" value={d.source} onChange={(e) => setDraft(d.key, { source: e.target.value as StatusSource, target: '' })}>
                          {statusSources.map((s) => (
                            <option key={s} value={s}>
                              {SOURCE_LABEL[s]}
                            </option>
                          ))}
                        </select>
                      </Labeled>
                    </div>
                    <p className="-mt-1 text-[13px] text-subtle">{SOURCE_HINT[d.source]}</p>
                    {d.source === 'node' && (
                      <Labeled label="Node" hint={nodes && nodes.length === 0 ? 'Die Nodes konnten nicht aus dem Panel geladen werden – bitte die Node-ID eintragen.' : undefined} className="max-w-md">
                        {nodes && nodes.length > 0 ? (
                          <select className="input" value={d.target} onChange={(e) => setDraft(d.key, { target: e.target.value })}>
                            <option value="">Bitte wählen …</option>
                            {nodes.map((n) => (
                              <option key={n.id} value={String(n.id)}>
                                {n.name} (ID {n.id})
                              </option>
                            ))}
                            {d.target && !nodes.some((n) => String(n.id) === d.target) && <option value={d.target}>Node-ID {d.target} (nicht im Panel gefunden)</option>}
                          </select>
                        ) : (
                          <input type="text" inputMode="numeric" className="input" value={d.target} placeholder={nodes ? 'Node-ID, z. B. 1' : 'Nodes werden geladen …'} onChange={(e) => setDraft(d.key, { target: e.target.value.replace(/\D/g, '') })} />
                        )}
                      </Labeled>
                    )}
                    {d.source === 'http' && (
                      <Labeled label="Adresse" hint="Vollständige Adresse mit https://">
                        <input type="url" className="input" value={d.target} maxLength={300} placeholder="https://example.com/health" onChange={(e) => setDraft(d.key, { target: e.target.value })} />
                      </Labeled>
                    )}
                    <TwoLang
                      label="Eigener Text für „Betriebsbereit“"
                      value={d.operationalLabel}
                      maxLength={40}
                      placeholder={{ de: 'z. B. Aktiv', en: 'e.g. Active' }}
                      hint="Leer = der allgemeine Text aus „Zustände“."
                      onChange={(operationalLabel) => setDraft(d.key, { operationalLabel })}
                    />
                    <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
                      <Labeled label="Status" hint="„Automatisch“ nutzt die Prüfung und laufende Meldungen.">
                        <select className="input" value={d.override} onChange={(e) => setDraft(d.key, { override: e.target.value as Override })}>
                          {OVERRIDES.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </Labeled>
                      <div className="sm:pt-8">
                        <Toggle checked={d.visible} onChange={(visible) => setDraft(d.key, { visible })} label="Auf der Statusseite anzeigen" hint="Ausgeblendete Komponenten werden weiter geprüft und aufgezeichnet." />
                      </div>
                    </div>
                    {d.id && <p className="text-[12px] text-subtle">Interne ID: {d.id}</p>}
                  </div>
                )}
              </li>
            );
          })}
          {drafts.length === 0 && <li className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">Noch keine Komponenten.</li>}
        </ul>
        <Button variant="secondary" size="sm" icon={<Plus />} disabled={drafts.length >= statusLimits.components} onClick={addComponent}>
          Komponente hinzufügen
        </Button>
      </Section>

      <HistoryRanges drafts={drafts} days={page.unit === 'hour' ? Math.ceil(page.hours / 24) + 1 : page.days} colors={page.colors} ranges={ranges} onChange={setRanges} />

      <HistoryCorrections drafts={drafts} days={page.unit === 'hour' ? Math.ceil(page.hours / 24) + 1 : page.days} colors={page.colors} history={history} onChange={setHistory} />

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-line-strong bg-[#0d1017]/95 px-4 py-3 shadow-xl backdrop-blur">
        <Button onClick={onSave} loading={pending} disabled={!dirty} icon={<Save />}>
          Statusseite speichern
        </Button>
        <a href={statusPath} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300">
          Statusseite ansehen <ExternalLink className="size-3.5" aria-hidden />
        </a>
        {message ? (
          <span className={cn('text-sm', message.ok ? 'text-emerald-300' : 'text-red-300')}>{message.text}</span>
        ) : (
          dirty && <span className="text-sm text-amber-300">Ungespeicherte Änderungen</span>
        )}
      </div>
    </div>
  );
}

const germanDay = (day: string) => day.split('-').reverse().join('.');

/** Einen ganzen Zeitraum nachtragen, z. B. die Zeit vor Beginn der Messung („von – bis war alles betriebsbereit“) */
function HistoryRanges({
  drafts,
  days,
  colors,
  ranges,
  onChange,
}: {
  drafts: Draft[];
  days: number;
  colors: StatusPageSettings['colors'];
  ranges: StatusRangeSetting[];
  onChange: (r: StatusRangeSetting[]) => void;
}) {
  const saved = drafts.filter((d) => d.id);
  const today = new Date().toISOString().slice(0, 10);
  const oldest = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const [component, setComponent] = useState('*');
  const [from, setFrom] = useState(oldest);
  const [to, setTo] = useState(today);
  const [state, setState] = useState<StatusCategory>('operational');
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const names: Record<string, string> = { '*': 'Alle Komponenten', ...Object.fromEntries(saved.map((d) => [d.id, d.name.de || d.name.en])) };
  const selected = names[component] ? component : '*';
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);

  function add() {
    if (!valid || ranges.length >= statusLimits.ranges) return;
    const [a, b] = from <= to ? [from, to] : [to, from];
    onChange([...ranges, { component: selected, from: a, to: b, state, onlyEmpty }]);
  }

  return (
    <Section
      title="Verlauf nachtragen: Zeitraum"
      description="Trage einen ganzen Zeitraum auf einmal nach – zum Beispiel die Zeit, bevor die Messung begonnen hat und alle Dienste online waren. So entstehen keine grauen Lücken ohne Messdaten. Mit „Nur Tage ohne Messdaten“ bleiben gemessene Tage unverändert; ohne den Schalter überschreibt der Zeitraum auch gemessene Tage. Spätere Einträge haben Vorrang vor früheren."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_160px_160px_1fr]">
        <Labeled label="Komponente">
          <select className="input" value={selected} onChange={(e) => setComponent(e.target.value)}>
            <option value="*">Alle Komponenten</option>
            {saved.map((d) => (
              <option key={d.id} value={d.id}>
                {names[d.id]}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Von">
          <input type="date" className="input" value={from} min={oldest} max={today} onChange={(e) => setFrom(e.target.value)} />
        </Labeled>
        <Labeled label="Bis">
          <input type="date" className="input" value={to} min={oldest} max={today} onChange={(e) => setTo(e.target.value)} />
        </Labeled>
        <Labeled label="Zustand in diesem Zeitraum">
          <select className="input" value={state} onChange={(e) => setState(e.target.value as StatusCategory)}>
            {statusCategories.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_NAME[c]}
              </option>
            ))}
          </select>
        </Labeled>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Toggle checked={onlyEmpty} onChange={setOnlyEmpty} label="Nur Tage ohne Messdaten" hint="Empfohlen: Gemessene Tage (auch Ausfälle) bleiben, wie sie sind." />
        <Button variant="secondary" icon={<Plus />} disabled={!valid || ranges.length >= statusLimits.ranges} onClick={add}>
          Zeitraum eintragen
        </Button>
      </div>
      <p className="text-[13px] text-subtle">Der Verlauf reicht {days} Tage zurück (bis {germanDay(oldest)}). Wirksam wird der Eintrag erst mit „Statusseite speichern“.</p>
      {ranges.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {ranges.map((r, i) => (
            <li key={`${r.component}:${r.from}:${r.to}:${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="text-gray-200 tabular-nums">
                  {germanDay(r.from)} – {germanDay(r.to)}
                </span>
                <span className="text-white">{names[r.component] ?? r.component}</span>
                <span className="flex items-center gap-1.5 text-muted">
                  <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: colors[r.state] }} aria-hidden />
                  {CATEGORY_NAME[r.state]}
                </span>
                <span className="text-[12px] text-subtle">{r.onlyEmpty ? 'nur Tage ohne Messdaten' : 'überschreibt auch gemessene Tage'}</span>
              </span>
              <IconButton label="Zeitraum entfernen" danger onClick={() => onChange(ranges.filter((_, j) => j !== i))}>
                <Trash2 />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Einzelne Tage im Verlauf nachträglich festlegen (Fehlalarm ausbessern, Ausfall nachtragen) */
function HistoryCorrections({
  drafts,
  days,
  colors,
  history,
  onChange,
}: {
  drafts: Draft[];
  days: number;
  colors: StatusPageSettings['colors'];
  history: Status['history'];
  onChange: (h: Status['history']) => void;
}) {
  const saved = drafts.filter((d) => d.id);
  const today = new Date().toISOString().slice(0, 10);
  const oldest = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const [component, setComponent] = useState(saved[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [state, setState] = useState<StatusCategory>('operational');
  const selected = saved.some((d) => d.id === component) ? component : (saved[0]?.id ?? '');
  const names = Object.fromEntries(saved.map((d) => [d.id, d.name.de || d.name.en]));
  const entries = Object.entries(history)
    .flatMap(([id, byDay]) => Object.entries(byDay).map(([day, s]) => ({ id, day, state: s })))
    .filter((e) => names[e.id])
    .sort((a, b) => b.day.localeCompare(a.day) || a.id.localeCompare(b.id));

  function add() {
    if (!selected || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    onChange({ ...history, [selected]: { ...(history[selected] ?? {}), [date]: state } });
  }

  function remove(id: string, day: string) {
    const { [day]: _removed, ...rest } = history[id] ?? {};
    const next = { ...history };
    if (Object.keys(rest).length) next[id] = rest;
    else delete next[id];
    onChange(next);
  }

  return (
    <Section
      title="Verlauf korrigieren: einzelner Tag"
      description="Der Verlauf entsteht automatisch: alle 5 Minuten wird der Status jeder Komponente gespeichert. Hier legst du einzelne Tage von Hand fest – etwa um einen Fehlalarm auszubessern oder einen Ausfall nachzutragen. Ein einzelner Tag hat Vorrang vor einem nachgetragenen Zeitraum. „Ausfall“ färbt den Tag rot, die Prozentzahl folgt dabei weiter den Messungen; jeder andere Zustand zählt den Tag als voll verfügbar."
    >
      {saved.length === 0 ? (
        <p className="text-sm text-muted">Speichere zuerst mindestens eine Komponente.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_170px_1fr_auto] sm:items-end">
          <Labeled label="Komponente">
            <select className="input" value={selected} onChange={(e) => setComponent(e.target.value)}>
              {saved.map((d) => (
                <option key={d.id} value={d.id}>
                  {names[d.id]}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="Tag">
            <input type="date" className="input" value={date} min={oldest} max={today} onChange={(e) => setDate(e.target.value)} />
          </Labeled>
          <Labeled label="Zustand an diesem Tag">
            <select className="input" value={state} onChange={(e) => setState(e.target.value as StatusCategory)}>
              {statusCategories.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_NAME[c]}
                </option>
              ))}
            </select>
          </Labeled>
          <div className="pb-0.5">
            <Button variant="secondary" icon={<Plus />} onClick={add}>
              Eintragen
            </Button>
          </div>
        </div>
      )}
      {entries.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {entries.map((e) => (
            <li key={`${e.id}:${e.day}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="text-gray-200 tabular-nums">{e.day.split('-').reverse().join('.')}</span>
                <span className="text-white">{names[e.id]}</span>
                <span className="flex items-center gap-1.5 text-muted">
                  <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: colors[e.state] }} aria-hidden />
                  {CATEGORY_NAME[e.state]}
                </span>
              </span>
              <IconButton label="Korrektur entfernen" danger onClick={() => remove(e.id, e.day)}>
                <Trash2 />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
