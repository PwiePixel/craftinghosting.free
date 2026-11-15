'use client';

/**
 * Statusseite im Admin-Bereich: Vorfälle, Wartungen und Hinweise anlegen, bearbeiten, beenden, löschen.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus, Save } from 'lucide-react';
import { formatDateTime, freeHostingConfig, type AdminIncidentInput, type IncidentImpact, type IncidentKind, type StatusIncidentDTO } from '@chfree/shared';
import { ActionButton } from '@/components/admin/admin-actions';
import { fromLocalInput, Labeled, toLocalInput } from '@/components/admin/admin-settings';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export type ComponentOption = { id: string; name: string };

const KINDS: [IncidentKind, string][] = [
  ['incident', 'Störung'],
  ['maintenance', 'Wartung'],
  ['notice', 'Hinweis'],
];

const IMPACTS: [IncidentImpact, string][] = [
  ['major_outage', 'Down / Störung'],
  ['partial_outage', 'Teilausfall'],
  ['degraded', 'Beeinträchtigt'],
  ['maintenance', 'Wartung'],
  ['operational', 'Keine Auswirkung (nur Hinweis)'],
];

const STATE_LABEL: Record<StatusIncidentDTO['state'], { label: string; cls: string }> = {
  active: { label: 'aktiv', cls: 'bg-amber-400/15 text-amber-300' },
  scheduled: { label: 'geplant', cls: 'bg-blue-500/15 text-blue-300' },
  resolved: { label: 'beendet', cls: 'bg-white/5 text-gray-300' },
};

function emptyInput(): AdminIncidentInput {
  return {
    kind: 'incident',
    impact: 'major_outage',
    components: [],
    title: { en: '', de: '' },
    message: { en: '', de: '' },
    startsAt: null,
    endsAt: null,
  };
}

function toInput(i: StatusIncidentDTO): AdminIncidentInput {
  return { kind: i.kind, impact: i.impact, components: i.components, title: i.title, message: i.message, startsAt: i.startsAt, endsAt: i.endsAt };
}

export function IncidentForm({ components, incident, onDone }: { components: ComponentOption[]; incident?: StatusIncidentDTO; onDone?: () => void }) {
  const router = useRouter();
  const [v, setV] = useState<AdminIncidentInput>(incident ? toInput(incident) : emptyInput());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const set = (patch: Partial<AdminIncidentInput>) => {
    setOk(false);
    setV((prev) => ({ ...prev, ...patch }));
  };

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        try {
          await api(incident ? `/admin/incidents/${incident.id}` : '/admin/incidents', { body: v });
          if (!incident) setV(emptyInput());
          setOk(true);
          router.refresh();
          onDone?.();
        } catch (err) {
          setError(err instanceof ApiClientError ? (Object.values(err.fields ?? {})[0] ?? err.message) : 'Speichern fehlgeschlagen.');
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Labeled label="Art">
          <select
            className="input"
            value={v.kind}
            onChange={(e) => {
              const kind = e.target.value as IncidentKind;
              set({ kind, impact: kind === 'maintenance' ? 'maintenance' : kind === 'notice' ? 'operational' : v.impact === 'maintenance' || v.impact === 'operational' ? 'major_outage' : v.impact });
            }}
          >
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Status der betroffenen Dienste" hint="Solange die Meldung aktiv ist, wird dieser Status angezeigt.">
          <select className="input" value={v.impact} onChange={(e) => set({ impact: e.target.value as IncidentImpact })}>
            {IMPACTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Labeled>
      </div>

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-gray-200">Betroffene Dienste</legend>
        <div className="flex flex-wrap gap-2">
          {components.map((c) => {
            const on = v.components.includes(c.id);
            return (
              <label
                key={c.id}
                className={cn('cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors', on ? 'border-blue-500 bg-blue-500/10 text-white' : 'border-line-strong text-gray-300 hover:border-white/25')}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={() => set({ components: on ? v.components.filter((x) => x !== c.id) : [...v.components, c.id] })}
                />
                {c.name}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        <Labeled label="Titel (Englisch)">
          <input className="input" maxLength={160} value={v.title.en} onChange={(e) => set({ title: { ...v.title, en: e.target.value } })} />
        </Labeled>
        <Labeled label="Titel (Deutsch)">
          <input className="input" maxLength={160} value={v.title.de} onChange={(e) => set({ title: { ...v.title, de: e.target.value } })} />
        </Labeled>
        <Labeled label="Text (Englisch)">
          <textarea className="input h-24 py-2.5" maxLength={5000} value={v.message.en} onChange={(e) => set({ message: { ...v.message, en: e.target.value } })} />
        </Labeled>
        <Labeled label="Text (Deutsch)">
          <textarea className="input h-24 py-2.5" maxLength={5000} value={v.message.de} onChange={(e) => set({ message: { ...v.message, de: e.target.value } })} />
        </Labeled>
      </div>
      <p className="-mt-2 text-[12px] text-subtle">Ist eine Sprache leer, wird die andere angezeigt.</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Labeled label="Beginn" hint="Leer = jetzt. In der Zukunft = geplante Wartung.">
          <input type="datetime-local" className="input" value={toLocalInput(v.startsAt)} onChange={(e) => set({ startsAt: fromLocalInput(e.target.value) })} />
        </Labeled>
        <Labeled label="Ende (optional)" hint="Danach gilt die Meldung automatisch als beendet.">
          <input type="datetime-local" className="input" value={toLocalInput(v.endsAt)} onChange={(e) => set({ endsAt: fromLocalInput(e.target.value) })} />
        </Labeled>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending} icon={incident ? <Save /> : <Plus />} disabled={!v.title.en.trim() && !v.title.de.trim()}>
          {incident ? 'Änderungen speichern' : 'Meldung veröffentlichen'}
        </Button>
        {error && <span className="text-sm text-red-300">{error}</span>}
        {ok && !error && <span className="text-sm text-emerald-300">{incident ? 'Gespeichert.' : 'Veröffentlicht.'}</span>}
      </div>
    </form>
  );
}

const fmt = (iso: string) => formatDateTime(iso, freeHostingConfig.fairUse.timezone, 'de');

export function IncidentList({ incidents, components }: { incidents: StatusIncidentDTO[]; components: ComponentOption[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const names = Object.fromEntries(components.map((c) => [c.id, c.name]));
  const act = (id: string, action: 'resolve' | 'delete') => async () => {
    await api(`/admin/incidents/${id}/${action}`, { body: {} });
    router.refresh();
  };

  if (incidents.length === 0) return <p className="rounded-lg border border-line px-4 py-6 text-center text-sm text-muted">Noch keine Meldungen.</p>;

  return (
    <ul className="space-y-3">
      {incidents.map((i) => {
        const st = STATE_LABEL[i.state];
        return (
          <li key={i.id} className="rounded-lg border border-line bg-background/40 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('rounded px-1.5 py-0.5 text-[11px]', st.cls)}>{st.label}</span>
                  <span className="text-[12px] text-subtle">{KINDS.find(([k]) => k === i.kind)?.[1]}</span>
                  <span className="text-[12px] text-subtle">· {IMPACTS.find(([k]) => k === i.impact)?.[1]}</span>
                </div>
                <p className="mt-1 font-medium text-white">{i.title.de || i.title.en}</p>
                {i.title.en && i.title.de && i.title.en !== i.title.de && <p className="text-[13px] text-subtle">EN: {i.title.en}</p>}
                <p className="mt-1 text-[12px] text-subtle">
                  {fmt(i.startsAt)}
                  {i.endsAt ? ` – ${fmt(i.endsAt)}` : ''}
                  {i.resolvedAt ? ` · beendet ${fmt(i.resolvedAt)}` : ''}
                  {i.components.length > 0 ? ` · ${i.components.map((c) => names[c] ?? c).join(', ')}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                <ActionButton label={editing === i.id ? 'Schließen' : 'Bearbeiten'} run={async () => setEditing(editing === i.id ? null : i.id)} />
                {i.state !== 'resolved' && <ActionButton label="Beenden" confirm="Als beendet markieren?" run={act(i.id, 'resolve')} />}
                <ActionButton label="Löschen" confirm="Endgültig löschen?" danger run={act(i.id, 'delete')} />
              </div>
            </div>
            {editing === i.id && (
              <div className="mt-4 border-t border-line pt-4">
                <IncidentForm components={components} incident={i} onDone={() => setEditing(null)} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
