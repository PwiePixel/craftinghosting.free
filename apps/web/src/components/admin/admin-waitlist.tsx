'use client';

/**
 * Warteliste (Early Access) im Admin-Bereich: Plätze der Reihe nach oder gezielt freischalten.
 * Freigeschaltete Nutzer mit Panel-Zugang bekommen ihren Server sofort, alle anderen eine E-Mail.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Minus, Plus, Unlock, UserPlus } from 'lucide-react';
import { formatDateTime, freeHostingConfig, type AdminWaitlistBlockDTO, type AdminWaitlistDTO, type SiteSettings } from '@chfree/shared';
import { ActionButton } from '@/components/admin/admin-actions';
import { Labeled, Toggle } from '@/components/admin/admin-settings';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const fmt = (iso: string) => formatDateTime(iso, freeHostingConfig.fairUse.timezone, 'de');

type Row = { kind: 'entry'; e: AdminWaitlistDTO } | { kind: 'block'; b: AdminWaitlistBlockDTO };

/** Einträge und Vormerkungs-Blöcke in der Reihenfolge der Warteschlange */
function queueRows(entries: AdminWaitlistDTO[], blocks: AdminWaitlistBlockDTO[]): Row[] {
  const sorted = [...blocks].sort((a, b) => a.fromRank - b.fromRank);
  const rows: Row[] = [];
  let bi = 0;
  for (const e of entries) {
    while (bi < sorted.length && (e.position === null || sorted[bi]!.after < e.position)) rows.push({ kind: 'block', b: sorted[bi++]! });
    rows.push({ kind: 'entry', e });
  }
  while (bi < sorted.length) rows.push({ kind: 'block', b: sorted[bi++]! });
  return rows;
}

export function WaitlistManager({ entries, blocks = [] }: { entries: AdminWaitlistDTO[]; blocks?: AdminWaitlistBlockDTO[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [count, setCount] = useState(10);
  const [pending, setPending] = useState<'selected' | 'next' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const confirmed = entries.filter((e) => e.position !== null);

  async function release(kind: 'selected' | 'next') {
    setPending(kind);
    setMessage(null);
    try {
      const res = await api<{ released: number; created: number; skippedFull: number }>('/admin/waitlist/release', {
        body: kind === 'selected' ? { ids: [...selected] } : { count },
      });
      setSelected(new Set());
      setMessage({
        ok: true,
        text:
          (res.released === 0
            ? 'Keine Plätze freigeschaltet.'
            : `${res.released} ${res.released === 1 ? 'Platz' : 'Plätze'} freigeschaltet – ${res.created} Server sofort erstellt, die übrigen Nutzer bekommen eine E-Mail zum Einrichten des Panel-Zugangs.`) +
          (res.skippedFull > 0 ? ` ${res.skippedFull} nicht freigeschaltet, weil das Paket ausgebucht ist (Einstellungen → Pakete & Kapazität).` : ''),
      });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiClientError ? err.message : 'Freischalten fehlgeschlagen.' });
    } finally {
      setPending(null);
    }
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Die nächsten</span>
          <input
            type="number"
            min={1}
            max={500}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
            className="input h-9 w-20"
            aria-label="Anzahl"
          />
          <Button size="sm" icon={<Unlock />} loading={pending === 'next'} disabled={confirmed.length === 0} onClick={() => release('next')}>
            freischalten
          </Button>
        </div>
        <Button size="sm" variant="secondary" loading={pending === 'selected'} disabled={selected.size === 0} onClick={() => release('selected')}>
          Ausgewählte freischalten ({selected.size})
        </Button>
      </div>
      {message && <p className={cn('text-sm', message.ok ? 'text-emerald-300' : 'text-red-300')}>{message.text}</p>}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[860px] text-left text-[13px]">
          <thead className="bg-surface-2 text-gray-300">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label="Alle auf dieser Seite auswählen"
                  title="Alle auf dieser Seite auswählen"
                  className="size-4 accent-blue-600"
                  checked={confirmed.length > 0 && selected.size === confirmed.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(confirmed.map((c) => c.id)) : new Set())}
                />
              </th>
              {['Platz', 'Hardware', 'Server', 'E-Mail', 'Panel-Konto', 'Eingetragen', ''].map((h) => (
                <th key={h} className="px-3 py-2.5 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-surface align-top">
            {queueRows(entries, blocks).map((row) =>
              row.kind === 'block' ? (
                <tr key={`block-${row.b.fromRank}`} className="bg-blue-500/[0.05]">
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 font-semibold whitespace-nowrap text-blue-200">
                    #{row.b.fromRank}
                    {row.b.count > 1 ? ` – #${row.b.toRank}` : ''}
                  </td>
                  <td colSpan={6} className="px-3 py-2.5 text-gray-200">
                    {row.b.count.toLocaleString('de-DE')} {row.b.count === 1 ? 'Vormerkung' : 'Vormerkungen'} außerhalb der Website
                    <span className="text-subtle">{row.b.at ? ` · hinzugefügt ${fmt(row.b.at)}` : ''} · Freischalten außerhalb (z. B. altes System)</span>
                  </td>
                </tr>
              ) : (
                (({ e }) => (
              <tr key={e.id} className={e.position === null ? 'opacity-60' : undefined}>
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="size-4 accent-blue-600"
                    disabled={e.position === null}
                    checked={selected.has(e.id)}
                    onChange={() => toggle(e.id)}
                    aria-label={`${e.name} auswählen`}
                  />
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {e.rank !== null ? <span className="font-semibold text-white">#{e.rank}</span> : <span className="text-amber-300">E-Mail unbestätigt</span>}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {e.tier ? <span className={e.tier === 'epyc' ? 'text-blue-300' : 'text-gray-200'}>{e.tier === 'epyc' ? 'AMD EPYC' : 'Intel Xeon'}</span> : '–'}
                </td>
                <td className="px-3 py-2.5">
                  <p className="font-medium text-white">{e.name}</p>
                  <p className="text-[11px] text-subtle">
                    {e.planId} · {e.serverType} {e.version}
                  </p>
                </td>
                <td className="px-3 py-2.5">
                  <p className="text-gray-200">{e.email}</p>
                  <p className="text-[11px] text-subtle uppercase">{e.locale}</p>
                </td>
                <td className="px-3 py-2.5 text-muted">{e.panelLinked ? 'ja – Server sofort' : 'nein – E-Mail'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-muted">{fmt(e.joinedAt ?? e.createdAt)}</td>
                <td className="px-3 py-2.5 text-right">
                  <ActionButton
                    label="Entfernen"
                    confirm="Wirklich entfernen?"
                    danger
                    run={async () => {
                      await api(`/admin/waitlist/${e.id}/remove`, { body: {} });
                      router.refresh();
                    }}
                  />
                </td>
              </tr>
                ))(row)
              ),
            )}
            {entries.length === 0 && blocks.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted">
                  Niemand auf der Warteliste.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Personen hinzufügen */

type AddResult = { added: { email: string; position: number }[]; skipped: { email: string; reason: string }[] };

/** Eine Zeile pro Person: „mail@example.com“ oder „mail@example.com, Servername“ */
function parseLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [email, ...rest] = line.split(/[,;\t]/);
      const name = rest.join(' ').trim();
      return { email: (email ?? '').trim(), ...(name ? { name } : {}) };
    });
}

export function WaitlistAddForm() {
  const router = useRouter();
  const { plans, serverTypes } = freeHostingConfig;
  const [text, setText] = useState('');
  const [planId, setPlanId] = useState((plans.find((p) => p.highlighted) ?? plans[0]!).id);
  const [typeId, setTypeId] = useState((serverTypes.find((t) => t.recommended) ?? serverTypes[0]!).id);
  const [locale, setLocale] = useState<'de' | 'en'>('de');
  const [priority, setPriority] = useState(true);
  const [notify, setNotify] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AddResult | null>(null);
  const entries = parseLines(text);
  const type = serverTypes.find((t) => t.id === typeId)!;

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        setResult(null);
        try {
          const res = await api<AddResult>('/admin/waitlist/add', {
            body: { entries, planId, serverType: typeId, version: type.defaultVersion, locale, priority, notify },
          });
          setResult(res);
          if (res.added.length) setText('');
          router.refresh();
        } catch (err) {
          setError(err instanceof ApiClientError ? (Object.values(err.fields ?? {})[0] ?? err.message) : 'Hinzufügen fehlgeschlagen.');
        } finally {
          setPending(false);
        }
      }}
    >
      <Labeled label="E-Mail-Adressen" hint="Eine Person pro Zeile, optional mit Servername: „mail@example.com, Survival“. Doppelte Adressen und Personen mit Server/Platz werden übersprungen.">
        <textarea
          className="input h-32 py-2.5 font-mono text-[13px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'steve@example.com\nalex@example.com, Alex Survival'}
        />
      </Labeled>
      <div className="grid gap-4 sm:grid-cols-3">
        <Labeled label="Paket">
          <select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Servertyp" hint="Version: neueste – im Panel änderbar">
          <select className="input" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {serverTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Sprache der E-Mails" hint="Nur für neu angelegte Konten">
          <select className="input" value={locale} onChange={(e) => setLocale(e.target.value as 'de' | 'en')}>
            <option value="de">Deutsch</option>
            <option value="en">Englisch</option>
          </select>
        </Labeled>
      </div>
      <div className="space-y-3">
        <Toggle checked={priority} onChange={setPriority} label="Vor allen bisherigen Einträgen einreihen" hint="Für Vormerkungen, die älter sind als die Anmeldungen über die Website – sie bekommen die vorderen Plätze (EPYC zuerst)." />
        <Toggle checked={notify} onChange={setNotify} label="Per E-Mail über den reservierten Platz informieren" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" icon={<UserPlus />} loading={pending} disabled={entries.length === 0}>
          {entries.length > 0 ? `${entries.length} ${entries.length === 1 ? 'Person' : 'Personen'} hinzufügen` : 'Hinzufügen'}
        </Button>
        {error && <span className="text-sm text-red-300">{error}</span>}
      </div>
      {result && (
        <div className="space-y-1 text-sm">
          <p className="text-emerald-300">
            {result.added.length} hinzugefügt{result.added.length > 0 ? `: ${result.added.map((a) => `${a.email} (#${a.position})`).join(', ')}` : ''}
          </p>
          {result.skipped.map((s) => (
            <p key={s.email} className="text-amber-300">
              Übersprungen: {s.email} – {s.reason}
            </p>
          ))}
        </div>
      )}
    </form>
  );
}

/**
 * Vormerkungen außerhalb der Website (nur als Anzahl): „+“ hängt einen Block hinten an die Warteschlange –
 * er belegt echte Plätze, wer sich danach einträgt, kommt dahinter. „−“ nimmt zuletzt hinzugefügte Plätze zurück.
 */
export function ExternalSpotsForm({ settings }: { settings: SiteSettings }) {
  const router = useRouter();
  const [amount, setAmount] = useState(10);
  const [pending, setPending] = useState<'plus' | 'minus' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const total = settings.waitlist.externalCount;

  async function change(sign: 1 | -1) {
    setPending(sign > 0 ? 'plus' : 'minus');
    setMessage(null);
    try {
      const res = await api<{ settings: SiteSettings }>('/admin/waitlist/external', { body: { delta: sign * amount } });
      setMessage({
        ok: true,
        text:
          sign > 0
            ? `${amount} Plätze hinten angehängt – jetzt ${res.settings.waitlist.externalCount} Vormerkungen außerhalb der Website.`
            : `Zurückgenommen – jetzt ${res.settings.waitlist.externalCount} Vormerkungen außerhalb der Website.`,
      });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiClientError ? (Object.values(err.fields ?? {})[0] ?? err.message) : 'Ändern fehlgeschlagen.' });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-200">
        Aktuell: <span className="font-semibold text-white">{total.toLocaleString('de-DE')}</span> Vormerkungen außerhalb der Website
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Labeled label="Anzahl" className="sm:w-40">
          <input
            type="number"
            min={1}
            className="input"
            value={amount}
            onChange={(e) => setAmount(Math.max(1, Math.round(Number(e.target.value) || 1)))}
          />
        </Labeled>
        <Button icon={<Plus />} loading={pending === 'plus'} onClick={() => change(1)}>
          {amount} Plätze hinzufügen
        </Button>
        <Button variant="secondary" icon={<Minus />} loading={pending === 'minus'} disabled={total === 0} onClick={() => change(-1)}>
          {Math.min(amount, total)} zurücknehmen
        </Button>
      </div>
      {message && <p className={cn('text-sm', message.ok ? 'text-emerald-300' : 'text-red-300')}>{message.text}</p>}
    </div>
  );
}
