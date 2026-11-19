'use client';

/**
 * Tab „Pterodactyl“ im Admin-Bereich: Verbindung zum Panel, erkannte Nodes und Eggs.
 * Hier wird festgelegt, auf welchen Nodes Minecraft-Server bzw. Discord-Bots erstellt werden und
 * welches Egg zu welchem Servertyp gehört – und welche Nodes privat sind (nie für kostenlose Server).
 * Gespeichert wird in den Einstellungen (products.*.nodeIds / eggs, privateNodeIds).
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw, Save, Sparkles } from 'lucide-react';
import {
  productKinds,
  serverTypesOf,
  type AdminPanelDTO,
  type AdminPanelEggDTO,
  type EggRef,
  type ProductKind,
  type SiteSettings,
} from '@chfree/shared';
import { PRODUCT_LABEL, formatMb } from '@/components/admin/admin-labels';
import { Section } from '@/components/admin/admin-settings';
import { PanelLoginSection } from '@/components/admin/admin-panel-login';
import { Button } from '@/components/ui/button';
import { Alert, StatusDot } from '@/components/ui/primitives';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Selection = Record<ProductKind, { nodeIds: number[]; eggs: Record<string, EggRef> }>;

const pick = (s: SiteSettings): Selection => ({
  minecraft: { nodeIds: [...s.products.minecraft.nodeIds], eggs: { ...s.products.minecraft.eggs } },
  discord: { nodeIds: [...s.products.discord.nodeIds], eggs: { ...s.products.discord.eggs } },
});

/** Vergleichbar machen: Reihenfolge der Nodes und der Schlüssel spielt keine Rolle */
const canonical = (sel: Selection) =>
  JSON.stringify(
    productKinds.map((kind) => [
      [...sel[kind].nodeIds].sort((a, b) => a - b),
      Object.keys(sel[kind].eggs)
        .sort()
        .map((k) => [k, sel[kind].eggs[k]!.nestId, sel[kind].eggs[k]!.eggId]),
    ]),
  );

const eggValue = (e: { nestId: number; eggId: number } | undefined) => (e ? `${e.nestId}:${e.eggId}` : '');
const errorText = (err: unknown, fallback: string) => (err instanceof ApiClientError ? err.message : fallback);

export function PanelManager() {
  const router = useRouter();
  const [panel, setPanel] = useState<AdminPanelDTO | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Gespeicherter Stand (Vergleich für „ungespeicherte Änderungen“) */
  const [saved, setSaved] = useState<Selection | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  /** Private Nodes: nie für kostenlose Server – auch nicht, wenn alle anderen voll sind */
  /** Software-Katalog aus den Einstellungen: Hier stehen ALLE Einträge (auch abgeschaltete und eigene) zur Zuordnung */
  const [software, setSoftware] = useState<{ id: string; name: string; directory: string; eggOnly: boolean }[]>([]);
  const typesOf = (kind: ProductKind): { id: string; name: string; directory?: string | null; eggOnly?: boolean }[] => (kind === 'minecraft' && software.length ? software : serverTypesOf(kind));
  const [priv, setPriv] = useState<number[]>([]);
  const [savedPriv, setSavedPriv] = useState<number[]>([]);
  const [discordEnabled, setDiscordEnabled] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const loadPanel = useCallback(async () => {
    setLoading(true);
    setPanelError(null);
    try {
      const res = await api<{ panel: AdminPanelDTO }>('/admin/panel');
      setPanel(res.panel);
    } catch (err) {
      setPanelError(errorText(err, 'Das Panel konnte nicht eingelesen werden.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    setSettingsError(null);
    try {
      const res = await api<{ settings: SiteSettings }>('/admin/settings');
      setSaved(pick(res.settings));
      setSel(pick(res.settings));
      setSoftware(res.settings.software.map((x) => ({ id: x.id, name: x.name, directory: x.directory, eggOnly: x.eggOnly })));
      setPriv(res.settings.privateNodeIds);
      setSavedPriv(res.settings.privateNodeIds);
      setDiscordEnabled(res.settings.products.discord.enabled);
    } catch (err) {
      setSettingsError(errorText(err, 'Die Einstellungen konnten nicht geladen werden.'));
    }
  }, []);

  useEffect(() => {
    void loadPanel();
    void loadSettings();
  }, [loadPanel, loadSettings]);

  const sameIds = (a: number[], b: number[]) => a.length === b.length && a.every((id) => b.includes(id));
  const dirty = !!sel && !!saved && (canonical(sel) !== canonical(saved) || !sameIds(priv, savedPriv));
  const nodes = panel?.nodes ?? [];
  const eggs = panel?.eggs ?? [];
  /** Nur wenn das Panel eingelesen wurde, lässt sich sagen, ob eine Node / ein Egg noch existiert */
  const panelKnown = !!panel?.connected;

  function patchKind(kind: ProductKind, value: Partial<Selection[ProductKind]>) {
    setMessage(null);
    setSel((prev) => (prev ? { ...prev, [kind]: { ...prev[kind], ...value } } : prev));
  }

  function toggleNode(kind: ProductKind, id: number, on: boolean) {
    if (!sel) return;
    const ids = sel[kind].nodeIds.filter((n) => n !== id);
    patchKind(kind, { nodeIds: on ? [...ids, id] : ids });
    // Eine Node ist entweder einem Angebot zugewiesen oder privat
    if (on) setPriv((prev) => prev.filter((n) => n !== id));
  }

  /** Privat = nie für kostenlose Server. Die Node wird dabei aus beiden Angeboten herausgenommen. */
  function togglePrivate(id: number, on: boolean) {
    setMessage(null);
    setPriv((prev) => (on ? [...prev.filter((n) => n !== id), id] : prev.filter((n) => n !== id)));
    if (on) setSel((prev) => (prev ? { minecraft: { ...prev.minecraft, nodeIds: prev.minecraft.nodeIds.filter((n) => n !== id) }, discord: { ...prev.discord, nodeIds: prev.discord.nodeIds.filter((n) => n !== id) } } : prev));
  }

  function setEgg(kind: ProductKind, typeId: string, egg: AdminPanelEggDTO | EggRef | null) {
    if (!sel) return;
    const next = { ...sel[kind].eggs };
    if (egg) next[typeId] = { nestId: egg.nestId, eggId: egg.eggId, name: egg.name };
    else delete next[typeId];
    patchKind(kind, { eggs: next });
  }

  /** Vorschläge der automatischen Erkennung, die von der aktuellen Auswahl abweichen */
  const openSuggestions = sel
    ? productKinds.flatMap((kind) =>
        typesOf(kind)
          .map((t) => ({ kind, typeId: t.id, egg: panel?.suggestedEggs[t.id] }))
          .filter((x): x is { kind: ProductKind; typeId: string; egg: EggRef } => !!x.egg && eggValue(x.egg) !== eggValue(sel[x.kind].eggs[x.typeId])),
      )
    : [];

  function applySuggestions() {
    if (!sel) return;
    setMessage(null);
    const next: Selection = { minecraft: { ...sel.minecraft, eggs: { ...sel.minecraft.eggs } }, discord: { ...sel.discord, eggs: { ...sel.discord.eggs } } };
    for (const s of openSuggestions) next[s.kind].eggs[s.typeId] = { nestId: s.egg.nestId, eggId: s.egg.eggId, name: s.egg.name };
    setSel(next);
  }

  async function onSave() {
    if (!sel) return;
    setPending(true);
    setMessage(null);
    try {
      // Aktuellen Stand holen, damit keine andere Einstellung überschrieben wird
      const current = (await api<{ settings: SiteSettings }>('/admin/settings')).settings;
      const next: SiteSettings = {
        ...current,
        products: {
          minecraft: { ...current.products.minecraft, nodeIds: sel.minecraft.nodeIds, eggs: sel.minecraft.eggs },
          discord: { ...current.products.discord, nodeIds: sel.discord.nodeIds, eggs: sel.discord.eggs },
        },
        privateNodeIds: priv,
      };
      const res = await api<{ settings: SiteSettings }>('/admin/settings', { body: next });
      setSaved(pick(res.settings));
      setSel(pick(res.settings));
      setPriv(res.settings.privateNodeIds);
      setSavedPriv(res.settings.privateNodeIds);
      setDiscordEnabled(res.settings.products.discord.enabled);
      setMessage({ ok: true, text: 'Gespeichert – neue Server werden ab sofort mit dieser Auswahl erstellt.' });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: errorText(err, 'Speichern fehlgeschlagen.') });
    } finally {
      setPending(false);
    }
  }

  /* ------------------------------------------------------------ Hinweise */

  const warnings: string[] = [];
  if (sel && panelKnown) {
    for (const kind of productKinds) {
      for (const id of sel[kind].nodeIds) {
        const node = nodes.find((n) => n.id === id);
        if (!node) warnings.push(`${PRODUCT_LABEL[kind]}: Die ausgewählte Node #${id} gibt es im Panel nicht mehr – bitte abwählen (siehe unten) und speichern.`);
        else if (node.freeAllocations === 0) warnings.push(`${PRODUCT_LABEL[kind]}: Node „${node.name}“ hat keine freien Ports – dort kann kein Server erstellt werden.`);
        else if (node.maintenance) warnings.push(`${PRODUCT_LABEL[kind]}: Node „${node.name}“ ist im Wartungsmodus.`);
      }
      for (const [typeId, egg] of Object.entries(sel[kind].eggs)) {
        if (!eggs.some((e) => eggValue(e) === eggValue(egg))) warnings.push(`${PRODUCT_LABEL[kind]}: Das Egg „${egg.name || eggValue(egg)}“ für ${typeId} gibt es im Panel nicht mehr.`);
      }
    }
  }
  // Ohne feste Minecraft-Nodes verteilt das System automatisch – dafür muss mindestens eine Node übrig sein
  if (sel && panelKnown && nodes.length > 0 && sel.minecraft.nodeIds.length === 0 && nodes.every((n) => priv.includes(n.id) || sel.discord.nodeIds.includes(n.id))) {
    warnings.push('Minecraft: Alle Nodes sind privat oder für Discord-Bots reserviert – es kann kein Minecraft-Server mehr erstellt werden.');
  }
  const missingNodes = (kind: ProductKind) => (sel && panelKnown ? sel[kind].nodeIds.filter((id) => !nodes.some((n) => n.id === id)) : []);

  /** Eggs nach Nest gruppiert (für <optgroup>) */
  const nests = [...new Map(eggs.map((e) => [e.nestId, e.nestName])).entries()].map(([nestId, nestName]) => ({
    nestId,
    nestName,
    eggs: eggs.filter((e) => e.nestId === nestId),
  }));

  return (
    <div className="space-y-5">
      <Section title="Verbindung" description="Nodes und Eggs werden direkt aus dem Pterodactyl-Panel eingelesen. Das Einlesen kann ein paar Sekunden dauern.">
        {panel ? (
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Modus</dt>
              <dd className={panel.mode === 'mock' ? 'text-amber-300' : 'text-emerald-300'}>{panel.mode === 'mock' ? 'Mock (simuliert)' : 'Live'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Panel-URL</dt>
              <dd>
                <a href={`${panel.url}/admin`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300">
                  {panel.url.replace(/^https?:\/\//, '')} <ArrowUpRight className="size-3.5" aria-hidden />
                </a>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Verbunden</dt>
              <dd className="inline-flex items-center gap-1.5 text-gray-200">
                <StatusDot tone={panel.connected ? (panel.error ? 'amber' : 'green') : 'red'} /> {panel.connected ? 'ja' : 'nein'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Erkannt</dt>
              <dd className="text-right text-gray-200">
                {nodes.length} {nodes.length === 1 ? 'Node' : 'Nodes'} · {eggs.length} {eggs.length === 1 ? 'Egg' : 'Eggs'}
              </dd>
            </div>
          </dl>
        ) : (
          !panelError && <p className="text-sm text-muted">Panel wird eingelesen …</p>
        )}
        {panel?.mode === 'mock' && (
          <Alert tone="warning" title="Mock-Modus aktiv">
            Das Panel wird nur simuliert – Nodes und Eggs sind Beispieldaten. Für den Betrieb PTERODACTYL_MODE=live setzen.
          </Alert>
        )}
        {panel?.error && (
          <Alert tone={panel.connected ? 'warning' : 'error'} title={panel.connected ? 'Verbindung steht, aber mit Fehler' : 'Keine Verbindung zum Panel'}>
            <span className="break-words">{panel.error}</span>
          </Alert>
        )}
        {panelError && (
          <Alert tone="error" title="Das Panel konnte nicht eingelesen werden">
            <span className="break-words">{panelError}</span>
          </Alert>
        )}
        {settingsError && (
          <Alert tone="error" title="Die Einstellungen konnten nicht geladen werden">
            <span className="break-words">{settingsError}</span>
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw />}
            loading={loading}
            onClick={() => {
              void loadPanel();
              if (!sel) void loadSettings();
            }}
          >
            Neu einlesen
          </Button>
          {loading && panel && <span className="text-[13px] text-muted">Panel wird eingelesen …</span>}
        </div>
      </Section>

      <PanelLoginSection />

      {sel && (
        <>
          {warnings.length > 0 && (
            <Alert tone="warning" title="Bitte prüfen">
              <ul className="space-y-0.5">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}

          <Section
            title="Nodes"
            description="Auf welchen Nodes neue Server erstellt werden. Bestehende Server bleiben, wo sie sind. Auf jeder ausgewählten Node müssen freie Ports (Allokationen) vorhanden sein. Eine Node mit „Privat“ wird nie für kostenlose Server verwendet."
          >
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[940px] text-left text-[13px]">
                <thead className="bg-surface-2 text-gray-300">
                  <tr>
                    {['Name', 'FQDN', 'Location', 'RAM', 'Disk', 'Freie Ports', 'Wartung', 'Minecraft', 'Discord-Bots', 'Privat'].map((h) => (
                      <th key={h} className="px-3 py-2.5 font-medium whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-surface align-top">
                  {nodes.map((n) => {
                    const selected = productKinds.some((kind) => sel[kind].nodeIds.includes(n.id));
                    const isPrivate = priv.includes(n.id);
                    return (
                      <tr key={n.id} className={isPrivate ? 'bg-white/[0.02]' : undefined}>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-white">
                            {n.name}
                            {isPrivate && <span className="ml-2 rounded bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-normal text-amber-200">privat</span>}
                          </p>
                          <p className="font-mono text-[11px] text-subtle">#{n.id}</p>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[12px] text-muted">{n.fqdn}</td>
                        <td className="px-3 py-2.5 text-muted">
                          {n.locationName ?? '–'} <span className="text-[11px] text-subtle">#{n.locationId}</span>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-muted">{formatMb(n.memoryMb)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-muted">{formatMb(n.diskMb)}</td>
                        <td className={cn('px-3 py-2.5 whitespace-nowrap', n.freeAllocations === 0 ? (selected ? 'font-medium text-red-300' : 'text-amber-300') : 'text-muted')}>
                          {n.freeAllocations === null ? 'unbekannt' : n.freeAllocations.toLocaleString('de-DE')}
                          {n.freeAllocations === 0 && selected && <span className="block text-[11px] font-normal">keine freien Ports!</span>}
                        </td>
                        <td className="px-3 py-2.5">{n.maintenance ? <span className="text-amber-300">ja</span> : <span className="text-muted">nein</span>}</td>
                        {productKinds.map((kind) => (
                          <td key={kind} className="px-3 py-2.5">
                            <input
                              type="checkbox"
                              className="size-4 accent-blue-600"
                              aria-label={`${n.name} für ${PRODUCT_LABEL[kind]} verwenden`}
                              checked={sel[kind].nodeIds.includes(n.id)}
                              onChange={(e) => toggleNode(kind, n.id, e.target.checked)}
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            className="size-4 accent-amber-500"
                            aria-label={`${n.name} als privat markieren – nie für kostenlose Server verwenden`}
                            checked={isPrivate}
                            onChange={(e) => togglePrivate(n.id, e.target.checked)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {nodes.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-3 py-8 text-center text-muted">
                        {loading ? 'Nodes werden eingelesen …' : 'Keine Nodes gefunden.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {productKinds.map((kind) => {
              const missing = missingNodes(kind);
              const unknown = !panelKnown && sel[kind].nodeIds.length > 0;
              if (missing.length === 0 && !unknown) return null;
              return (
                <div key={kind} className="flex flex-wrap items-center gap-2 text-[13px] text-amber-300">
                  <span>
                    {PRODUCT_LABEL[kind]} – {unknown ? 'gespeicherte Nodes (Panel nicht eingelesen)' : 'gespeichert, aber nicht mehr im Panel'}:
                  </span>
                  {(unknown ? sel[kind].nodeIds : missing).map((id) => (
                    <button
                      key={id}
                      type="button"
                      title="Aus der Auswahl entfernen"
                      onClick={() => toggleNode(kind, id, false)}
                      className="rounded-md border border-amber-400/40 px-2 py-0.5 font-mono text-[12px] text-amber-200 hover:bg-amber-400/10"
                    >
                      #{id} ✕
                    </button>
                  ))}
                </div>
              );
            })}

            {priv.some((id) => panelKnown && !nodes.some((n) => n.id === id)) || (!panelKnown && priv.length > 0) ? (
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-amber-300">
                <span>Privat – {panelKnown ? 'gespeichert, aber nicht mehr im Panel' : 'gespeicherte Nodes (Panel nicht eingelesen)'}:</span>
                {priv
                  .filter((id) => !panelKnown || !nodes.some((n) => n.id === id))
                  .map((id) => (
                    <button
                      key={id}
                      type="button"
                      title="Aus der Auswahl entfernen"
                      onClick={() => togglePrivate(id, false)}
                      className="rounded-md border border-amber-400/40 px-2 py-0.5 font-mono text-[12px] text-amber-200 hover:bg-amber-400/10"
                    >
                      #{id} ✕
                    </button>
                  ))}
              </div>
            ) : null}

            <ul className="space-y-1.5 text-[13px] leading-relaxed text-muted">
              <li>
                <span className="text-gray-200">Privat:</span> Auf dieser Node wird nie ein kostenloser Server erstellt – weder Minecraft noch Discord-Bot, auch nicht ersatzweise.
                Sind die übrigen Nodes voll, schlägt die Erstellung fehl (sichtbar unter „Server“), statt auf eine private Node auszuweichen. Bestehende Server auf der Node
                bleiben unberührt. Im Sammelstatus „Server-Nodes“ der Statusseite zählen private Nodes nicht mit.
                {priv.length > 0 && <span className="text-amber-200"> Aktuell privat: {priv.length}.</span>}
              </li>
              <li>
                <span className="text-gray-200">Minecraft:</span> keine Node ausgewählt = automatische Verteilung über die Locations aus der .env{priv.length > 0 ? ' – private Nodes und die Nodes für Discord-Bots ausgenommen' : ''}.
                {sel.minecraft.nodeIds.length === 0 && <span className="text-subtle"> (aktuell aktiv)</span>}
              </li>
              <li className={sel.discord.nodeIds.length === 0 && discordEnabled ? 'text-amber-300' : undefined}>
                <span className={sel.discord.nodeIds.length === 0 && discordEnabled ? 'font-medium' : 'text-gray-200'}>Discord-Bots</span> werden NUR auf den hier
                ausgewählten Nodes erstellt – ohne Auswahl sind Discord-Bots auf der Website nicht bestellbar.
                {sel.discord.nodeIds.length === 0 && <span> Aktuell ist keine Node ausgewählt.</span>}
              </li>
            </ul>
          </Section>

          <Section
            title="Eggs je Servertyp"
            description="Welches Egg im Panel zu welchem Servertyp gehört. „Automatisch / .env“ nutzt die Egg-IDs aus der .env bzw. die automatische Erkennung."
          >
            {openSuggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" size="sm" icon={<Sparkles />} onClick={applySuggestions}>
                  Alle Vorschläge übernehmen ({openSuggestions.length})
                </Button>
                <span className="text-[13px] text-subtle">Die automatische Erkennung hat passende Eggs gefunden.</span>
              </div>
            )}
            {productKinds.map((kind) => (
              <div key={kind}>
                <p className="mb-2 text-sm font-medium text-gray-200">{PRODUCT_LABEL[kind]}</p>
                <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                  {typesOf(kind).map((t) => {
                    const current = sel[kind].eggs[t.id];
                    const value = eggValue(current);
                    const known = !current || eggs.some((e) => eggValue(e) === value);
                    const suggestion = panel?.suggestedEggs[t.id];
                    const differs = !!suggestion && eggValue(suggestion) !== value;
                    return (
                      <li key={t.id} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white">
                            {t.name} <span className="font-mono text-[11px] font-normal text-subtle">{t.id}</span>
                          </p>
                          {differs && suggestion && (
                            <p className="mt-0.5 text-[12px] text-subtle">
                              Vorschlag: <span className="text-gray-300">{suggestion.name}</span>{' '}
                              <button type="button" className="text-blue-400 hover:text-blue-300" onClick={() => setEgg(kind, t.id, suggestion)}>
                                übernehmen
                              </button>
                            </p>
                          )}
                          {!known && panelKnown && <p className="mt-0.5 text-[12px] text-amber-300">Das gespeicherte Egg gibt es im Panel nicht mehr.</p>}
                          {kind === 'minecraft' && t.id !== 'paper' && !!t.directory && !t.eggOnly && !current && <p className="mt-0.5 text-[12px] text-subtle">Kein Egg nötig – wird über MCJars eingerichtet (Grundlage: siehe Einstellungen → Server-Software).</p>}
                          {kind === 'minecraft' && t.eggOnly && !current && <p className="mt-0.5 text-[12px] text-subtle">Läuft nur über ein eigenes Egg – ohne Zuordnung wird diese Software nicht angeboten.</p>}
                        </div>
                        <select
                          className="input md:max-w-[360px]"
                          aria-label={`Egg für ${t.name}`}
                          value={value}
                          onChange={(e) => {
                            const egg = eggs.find((x) => eggValue(x) === e.target.value);
                            // Ein gespeichertes, nicht mehr vorhandenes Egg bleibt beim erneuten Auswählen erhalten
                            setEgg(kind, t.id, egg ?? (e.target.value === value && current ? current : null));
                          }}
                        >
                          <option value="">– automatisch / .env –</option>
                          {!known && current && (
                            <option value={value}>
                              {current.name || 'Unbekanntes Egg'} (#{value}
                              {panelKnown ? ' – nicht mehr im Panel' : ''})
                            </option>
                          )}
                          {nests.map((nest) => (
                            <optgroup key={nest.nestId} label={nest.nestName}>
                              {nest.eggs.map((e) => (
                                <option key={e.eggId} value={eggValue(e)}>
                                  {e.name}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {eggs.length === 0 && !loading && <p className="text-[13px] text-amber-300">Es wurden keine Eggs eingelesen – die Auswahl lässt sich erst ändern, wenn das Panel erreichbar ist.</p>}
          </Section>

          <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-xl border border-line-strong bg-surface-2/95 p-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <p className={cn('text-sm', message ? (message.ok ? 'text-emerald-300' : 'text-red-300') : 'text-muted')}>
              {message?.text ?? (dirty ? 'Ungespeicherte Änderungen' : 'Alles gespeichert')}
            </p>
            <Button onClick={onSave} loading={pending} icon={<Save />} disabled={!dirty}>
              Speichern
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
