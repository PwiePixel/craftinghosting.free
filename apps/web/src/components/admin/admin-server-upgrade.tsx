'use client';

/**
 * Admin → Server → „Upgrade / Umzug“: Paket eines Kunden-Servers ändern und ihn auf eine bestimmte Node
 * umziehen (auch auf eine private). Auf Wunsch wird der Server beim Kunden als Upgrade gekennzeichnet
 * und der Kunde benachrichtigt.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowUpCircle, X } from 'lucide-react';
import type { AdminServerDTO, AdminUpgradeOptionsDTO, AdminUpgradeResultDTO } from '@chfree/shared';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const errorText = (err: unknown) => (err instanceof ApiClientError ? err.message : 'Das hat nicht geklappt.');
const gb = (mb: number) => (mb < 1024 ? `${mb} MB` : `${mb % 1024 === 0 ? mb / 1024 : (mb / 1024).toFixed(1)} GB`);
const dateTime = (iso: string) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function ServerUpgradeButton({ server }: { server: AdminServerDTO }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-emerald-400/40 px-2 py-1 text-xs whitespace-nowrap text-emerald-200 transition-colors hover:border-emerald-300/70 hover:bg-emerald-400/10"
      >
        <ArrowUpCircle className="size-3.5" aria-hidden /> Upgrade / Umzug
      </button>
      {open && <UpgradeDialog server={server} close={() => setOpen(false)} />}
    </>
  );
}

function UpgradeDialog({ server, close }: { server: AdminServerDTO; close: () => void }) {
  const router = useRouter();
  const [options, setOptions] = useState<AdminUpgradeOptionsDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [planId, setPlanId] = useState(server.planId);
  const [nodeId, setNodeId] = useState<number | null>(null);
  const [keepPorts, setKeepPorts] = useState(true);
  const [mark, setMark] = useState(true);
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);
  const [pending, setPending] = useState<'save' | 'check' | 'cancel' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    try {
      const { options: o } = await api<{ options: AdminUpgradeOptionsDTO }>(`/admin/servers/${server.id}/upgrade`);
      setOptions(o);
      setPlanId(o.server.planId);
      setNodeId(o.server.transfer?.nodeId ?? o.server.nodeId);
      setNote(o.server.upgrade?.note ?? '');
    } catch (err) {
      setLoadError(errorText(err));
    }
  }
  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = options?.server;
  const transfer = current?.transfer ?? null;
  const nodeName = (id: number | null) => (id === null ? 'unbekannt' : (options?.nodes.find((n) => n.id === id)?.name ?? `Node ${id}`));
  const planChanged = !!current && planId !== current.planId;
  const nodeChanged = !!current && nodeId !== null && nodeId !== current.nodeId && nodeId !== transfer?.nodeId;
  const target = options?.nodes.find((n) => n.id === nodeId);

  async function save() {
    if (!current) return;
    setPending('save');
    setResult(null);
    try {
      const { result: r } = await api<{ result: AdminUpgradeResultDTO }>(`/admin/servers/${server.id}/upgrade`, {
        body: { planId: planChanged ? planId : null, nodeId: nodeChanged ? nodeId : null, keepPorts, markUpgrade: mark, note, notify },
      });
      setResult({ ok: !r.transferError, text: r.message });
      await load();
      router.refresh();
    } catch (err) {
      setResult({ ok: false, text: errorText(err) });
    } finally {
      setPending(null);
    }
  }

  async function transferAction(action: 'check' | 'cancel') {
    setPending(action);
    setResult(null);
    try {
      if (action === 'check') {
        const { result: r } = await api<{ result: { finished: number } }>(`/admin/servers/${server.id}/transfer-check`, { body: {} });
        setResult(r.finished ? { ok: true, text: 'Der Server liegt auf der neuen Node. Adresse übernommen, der Kunde wurde informiert.' } : { ok: false, text: 'Der Server liegt laut Panel noch auf der alten Node.' });
      } else {
        const { result: r } = await api<{ result: { panelCancelled: boolean } }>(`/admin/servers/${server.id}/transfer-cancel`, { body: {} });
        setResult({ ok: true, text: r.panelCancelled ? 'Umzug abgebrochen.' : 'Vormerkung entfernt. Falls im Panel schon ein Umzug läuft, brich ihn bitte dort ab.' });
      }
      await load();
      router.refresh();
    } catch (err) {
      setResult({ ok: false, text: errorText(err) });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={`Upgrade oder Umzug für ${server.name}`} onClick={close}>
      <div className="surface w-full max-w-xl p-6 text-left whitespace-normal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-white">Upgrade / Umzug</h3>
            <p className="mt-0.5 truncate text-sm text-muted">
              {server.name} · {server.ownerEmail}
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Schließen" className="rounded-md p-1.5 text-subtle hover:bg-white/5 hover:text-white">
            <X className="size-4" />
          </button>
        </div>

        {loadError && <p className="mt-5 text-sm text-red-300">{loadError}</p>}
        {!options && !loadError && <p className="mt-5 text-sm text-subtle">Lade Pakete und Nodes …</p>}

        {options && current && (
          <div className="mt-5 space-y-5">
            {transfer && (
              <div className="rounded-lg border border-amber-400/40 bg-amber-400/[0.07] p-4 text-sm leading-relaxed text-amber-100">
                <p className="font-medium">
                  Umzug auf „{nodeName(transfer.nodeId)}“ {transfer.mode === 'api' ? 'läuft' : 'vorgemerkt'} seit {dateTime(transfer.startedAt)}
                </p>
                <p className="mt-1 text-amber-100/85">
                  {transfer.mode === 'api'
                    ? 'Das Panel verschiebt den Server im Hintergrund. Sobald er angekommen ist, wird die neue Adresse übernommen und der Kunde informiert.'
                    : 'Der Umzug konnte nicht automatisch gestartet werden (kein Panel-Zugang unter Admin → Pterodactyl → „Automatischer Umzug“). Verschiebe den Server im Panel (Admin → Servers → Server öffnen → Manage → Transfer Server). Danach wird die neue Adresse automatisch übernommen und der Kunde informiert.'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {server.panelAdminUrl && (
                    <a href={server.panelAdminUrl} target="_blank" rel="noopener" className="rounded-md border border-amber-300/40 px-2.5 py-1 text-xs hover:bg-amber-300/10">
                      Im Panel öffnen
                    </a>
                  )}
                  <button type="button" disabled={pending !== null} onClick={() => transferAction('check')} className="rounded-md border border-amber-300/40 px-2.5 py-1 text-xs hover:bg-amber-300/10 disabled:opacity-50">
                    {pending === 'check' ? '…' : 'Jetzt abgleichen'}
                  </button>
                  <button type="button" disabled={pending !== null} onClick={() => transferAction('cancel')} className="rounded-md border border-amber-300/40 px-2.5 py-1 text-xs hover:bg-amber-300/10 disabled:opacity-50">
                    {pending === 'cancel' ? '…' : 'Umzug abbrechen'}
                  </button>
                </div>
              </div>
            )}

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-200">Paket</span>
              <select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                {!options.plans.some((p) => p.id === current.planId) && <option value={current.planId}>{current.planId} (aktuell, nicht mehr vorhanden)</option>}
                {options.plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} – {gb(p.memoryMb)} RAM, {p.cpuPercent} % CPU, {gb(p.diskMb)} Speicher
                    {p.id === current.planId ? ' (aktuell)' : ''}
                    {!p.enabled ? ' · nicht öffentlich' : ''}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-[13px] leading-relaxed text-subtle">
                Ressourcen und Slots werden sofort im Panel gesetzt; Daten und Port bleiben. Auch nicht öffentliche Pakete lassen sich vergeben – so kannst du unter „Pakete“ ein eigenes Upgrade-Paket
                anlegen, das niemand selbst wählen kann.
              </span>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-200">Node</span>
              <select className="input" value={nodeId ?? ''} disabled={!!transfer} onChange={(e) => setNodeId(e.target.value ? Number(e.target.value) : null)}>
                {current.nodeId === null && <option value="">unbekannt – nicht ändern</option>}
                {options.nodes.map((n) => (
                  <option key={n.id} value={n.id} disabled={n.id !== current.nodeId && n.freePorts === 0}>
                    {n.name}
                    {n.id === current.nodeId ? ' (aktuell)' : ''}
                    {n.private ? ' · privat' : n.use === 'discord' ? ' · Discord-Bots' : n.use === 'minecraft' ? ' · Minecraft' : ''}
                    {n.maintenance ? ' · Wartung' : ''}
                    {n.freePorts !== null ? ` · ${n.freePorts} freie Ports` : ''}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-[13px] leading-relaxed text-subtle">
                {transfer
                  ? 'Solange ein Umzug läuft, lässt sich keine andere Node wählen.'
                  : nodeChanged && target
                    ? `Der Umzug startet sofort: Der Server zieht mit allen Daten auf „${target.name}“ um${target.private ? ' (private Node)' : ''}. Währenddessen ist er nicht erreichbar, die Adresse kann sich ändern.`
                    : 'Private Nodes werden für neue kostenlose Server nie verwendet – hierhin kommen Server nur, wenn du sie von Hand verschiebst.'}
              </span>
              {nodeChanged && !options.webLogin && (
                <span className="mt-1.5 block text-[13px] leading-relaxed text-amber-200">
                  Hinweis: Es ist kein Panel-Zugang für den automatischen Umzug hinterlegt (Admin → Pterodactyl → „Automatischer Umzug“). Bei Pelican startet der Umzug trotzdem sofort; beim klassischen
                  Pterodactyl müsstest du den Server dann im Panel selbst verschieben.
                </span>
              )}
            </label>

            {nodeChanged && (
              <label className="flex items-start gap-3 rounded-lg border border-line p-4 text-sm text-gray-200">
                <input type="checkbox" className="mt-0.5 size-4 accent-emerald-500" checked={keepPorts} onChange={(e) => setKeepPorts(e.target.checked)} />
                <span>
                  Alle Ports mitnehmen
                  <span className="block text-[13px] leading-relaxed text-subtle">
                    {current.ports.length ? `Der Server hat ${current.ports.length === 1 ? 'den Port' : 'die Ports'} ${current.ports.join(', ')}. ` : ''}
                    Portnummern, die auf der Ziel-Node frei sind, bleiben gleich. Für belegte bekommt der Server gleich viele andere freie Ports. Ohne Haken bekommt er nur einen neuen Hauptport – zusätzliche
                    Ports entfallen.
                  </span>
                </span>
              </label>
            )}

            <div className="space-y-3 rounded-lg border border-line p-4">
              <label className="flex items-start gap-3 text-sm text-gray-200">
                <input type="checkbox" className="mt-0.5 size-4 accent-emerald-500" checked={mark} onChange={(e) => setMark(e.target.checked)} />
                <span>
                  Als Upgrade kennzeichnen
                  <span className="block text-[13px] text-subtle">Der Server bekommt unter „Meine Server“ die Kennzeichnung „Upgrade“.{current.upgrade ? ` Gekennzeichnet seit ${dateTime(current.upgrade.at)}.` : ''}</span>
                </span>
              </label>
              <label className="flex items-start gap-3 text-sm text-gray-200">
                <input type="checkbox" className="mt-0.5 size-4 accent-emerald-500" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                <span>
                  Kunden benachrichtigen
                  <span className="block text-[13px] text-subtle">Per E-Mail und – wenn Discord verknüpft ist – als Direktnachricht vom Bot. Ist ein Umzug fertig, folgt eine zweite Nachricht mit der neuen Adresse.</span>
                </span>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[13px] text-subtle">Hinweis für den Kunden (optional)</span>
                <input className="input" value={note} maxLength={300} placeholder="z. B. Danke für deine Unterstützung!" onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>

            {result && <p className={cn('text-sm leading-relaxed', result.ok ? 'text-emerald-300' : 'text-red-300')}>{result.text}</p>}

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>
                Schließen
              </Button>
              <Button type="button" loading={pending === 'save'} disabled={pending !== null} onClick={save}>
                {planChanged && nodeChanged ? 'Paket ändern und umziehen' : nodeChanged ? 'Umziehen' : planChanged ? 'Paket ändern' : 'Speichern'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
