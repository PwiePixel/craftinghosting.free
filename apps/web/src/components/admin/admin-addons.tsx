'use client';

/**
 * Admin → Extras: kostenpflichtige Add-ons für kostenlose Server.
 *  – Übersicht: laufende Buchungen, offene Zahlungen, Aufgaben fürs Team, Einnahmen
 *  – Buchungen: Zahlung bestätigen, einrichten, verlängern, beenden, kostenlos vergeben
 *  – Katalog: Extras anlegen und bepreisen, Hinweise zum Preis und zur Bezahlung
 * Preise und Wirkung prüft immer die API; hier wird nur bearbeitet und angezeigt.
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, Plus, Save, Search, Trash2, XCircle } from 'lucide-react';
import { ADDON_ICONS, ADDON_ID_RE, MAX_ADDONS, MIN_SUBSCRIPTION_DAYS, formatAddonPeriod, formatAddonPrice, productKinds, type AddonEffect, type AddonIcon, type AddonSetting, type AddonSettings, type AdminAddonRowDTO, type AdminAddonsDTO, type Localized, type ProductKind, type SiteSettings } from '@chfree/shared';
import { Labeled, NumberInput, Section, Toggle } from '@/components/admin/admin-settings';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Message = { ok: boolean; text: string } | null;
const errorText = (err: unknown) => (err instanceof ApiClientError ? err.message : 'Das hat nicht geklappt.');
const eur = (cents: number) => formatAddonPrice(cents, 'de');
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');

const ICON_LABEL: Record<AddonIcon, string> = { clock: 'Uhr (24/7)', ip: 'Netzwerk (IP)', cpu: 'Prozessor', memory: 'Arbeitsspeicher', disk: 'Festplatte', backup: 'Backup', star: 'Stern', plus: 'Plus' };
const KIND_LABEL: Record<ProductKind, string> = { minecraft: 'Minecraft-Server', discord: 'Discord-Bots' };
const FILTERS = [
  { id: '', label: 'Alle' },
  { id: 'tasks', label: 'Aufgaben' },
  { id: 'pending', label: 'Zahlung offen' },
  { id: 'active', label: 'Aktiv' },
  { id: 'subscriptions', label: 'Abos' },
  { id: 'ended', label: 'Beendet' },
] as const;
const END_REASON: Record<string, string> = { expired: 'abgelaufen', unpaid: 'nicht bezahlt', canceled: 'storniert', admin: 'vom Team beendet', refunded: 'erstattet', server_deleted: 'Server gelöscht' };

function Note({ message }: { message: Message }) {
  return message ? <span className={cn('text-sm', message.ok ? 'text-emerald-300' : 'text-red-300')}>{message.text}</span> : null;
}

function Bilingual({ label, value, onChange, area, maxLength, hint }: { label: string; value: Localized; onChange: (v: Localized) => void; area?: boolean; maxLength: number; hint?: string }) {
  const field = (lang: 'de' | 'en') =>
    area ? (
      <textarea className="input min-h-[80px] py-2.5 leading-relaxed" rows={3} value={value[lang]} maxLength={maxLength} onChange={(e) => onChange({ ...value, [lang]: e.target.value })} />
    ) : (
      <input type="text" className="input" value={value[lang]} maxLength={maxLength} onChange={(e) => onChange({ ...value, [lang]: e.target.value })} />
    );
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Labeled label={`${label} (Deutsch)`}>{field('de')}</Labeled>
        <Labeled label={`${label} (Englisch)`}>{field('en')}</Labeled>
      </div>
      {hint && <p className="mt-1.5 text-[13px] text-subtle">{hint}</p>}
    </div>
  );
}

/** Preis als Euro-Betrag tippen („2,50“) – gespeichert wird in Cent */
function PriceInput({ cents, onChange }: { cents: number; onChange: (cents: number) => void }) {
  const [text, setText] = useState(() => (cents / 100).toFixed(2).replace('.', ','));
  return (
    <div className="relative max-w-[200px]">
      <input
        type="text"
        inputMode="decimal"
        className="input pr-8"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value.replace(',', '.'));
          if (Number.isFinite(n) && n >= 0) onChange(Math.round(n * 100));
        }}
        onBlur={() => setText((cents / 100).toFixed(2).replace('.', ','))}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-subtle">€</span>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'amber' | 'emerald' }) {
  return (
    <div className="surface p-4">
      <p className="text-[13px] text-muted">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold', tone === 'amber' ? 'text-amber-300' : tone === 'emerald' ? 'text-emerald-300' : 'text-white')}>{value}</p>
      {hint && <p className="mt-1 text-[12px] text-subtle">{hint}</p>}
    </div>
  );
}

function statusBadge(r: AdminAddonRowDTO): { label: string; cls: string } {
  if (r.fulfilment === 'todo') return { label: 'Einrichten', cls: 'bg-amber-400/15 text-amber-200' };
  if (r.fulfilment === 'revoke') return { label: 'Zurücknehmen', cls: 'bg-amber-400/15 text-amber-200' };
  if (r.status === 'pending') return { label: 'Zahlung offen', cls: 'bg-blue-500/15 text-blue-200' };
  if (r.status === 'active' && r.renewalRequested) return { label: 'Verlängerung offen', cls: 'bg-blue-500/15 text-blue-200' };
  if (r.status === 'active') return { label: r.autoRenew ? 'Aktiv · Abo' : 'Aktiv', cls: 'bg-emerald-500/15 text-emerald-300' };
  return { label: `Beendet${r.endReason ? ` (${END_REASON[r.endReason] ?? r.endReason})` : ''}`, cls: 'bg-white/[0.06] text-muted' };
}

function Bookings({ catalog, onChanged }: { catalog: AddonSetting[]; onChanged: () => void }) {
  const [data, setData] = useState<AdminAddonsDTO | null>(null);
  const [status, setStatus] = useState<string>('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [grant, setGrant] = useState({ serverId: '', addonId: catalog[0]?.id ?? '', days: 30, unlimited: false });

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (status) p.set('status', status);
      if (query) p.set('q', query);
      if (page > 1) p.set('page', String(page));
      setData(await api<AdminAddonsDTO>(`/admin/addons${p.size ? `?${p}` : ''}`));
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    }
  }, [status, query, page]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, path: string, body: unknown, done: string) {
    setBusy(id);
    setMessage(null);
    try {
      await api(path, { body });
      setMessage({ ok: true, text: done });
      await load();
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  function confirmPayment(r: AdminAddonRowDTO) {
    const answer = window.prompt(`Zahlung für „${r.name}“ (${r.ref}) bestätigen?\n\nErhaltener Betrag in Euro – das Extra wird sofort ${r.status === 'active' ? 'verlängert' : 'freigeschaltet'}:`, (r.priceCents / 100).toFixed(2).replace('.', ','));
    if (answer === null) return;
    const n = Number(answer.trim().replace(',', '.'));
    if (answer.trim() === '' || !Number.isFinite(n) || n < 0) return setMessage({ ok: false, text: 'Bitte einen Betrag wie 2,50 eingeben.' });
    void act(r.id, `/admin/addons/${r.id}/confirm`, { amountCents: Math.round(n * 100) }, 'Zahlung bestätigt – das Extra ist aktiv.');
  }
  function extend(r: AdminAddonRowDTO) {
    const answer = window.prompt(`Laufzeit von „${r.name}“ (${r.ref}) ändern.\n\nTage dazu (z. B. 7) oder abziehen (z. B. -3):`, '7');
    if (answer === null) return;
    const days = Math.round(Number(answer));
    if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 366) return setMessage({ ok: false, text: 'Bitte eine Zahl zwischen -366 und 366 eingeben (nicht 0).' });
    void act(r.id, `/admin/addons/${r.id}/extend`, { days }, 'Laufzeit angepasst.');
  }
  function end(r: AdminAddonRowDTO, refunded: boolean) {
    let refundCents = 0;
    if (refunded && !data?.payment.online) {
      // Ohne Online-Zahlung weiß das System nichts von der Erstattung – den Betrag für die Buchhaltung festhalten
      const amount = window.prompt(`„${r.name}“ (${r.ref}) beenden und als erstattet vermerken.\n\nWie viel hast du erstattet (in Euro)? Die Erstattung selbst machst du über deinen Zahlungsweg.`, (r.paidCents / 100).toFixed(2).replace('.', ','));
      if (amount === null) return;
      const n = Number(amount.trim().replace(',', '.'));
      if (amount.trim() === '' || !Number.isFinite(n) || n < 0) return setMessage({ ok: false, text: 'Bitte einen Betrag wie 2,50 eingeben.' });
      refundCents = Math.round(n * 100);
    }
    const note = window.prompt(
      refunded
        ? data?.payment.online
          ? `„${r.name}“ (${r.ref}) beenden und als erstattet vermerken?\n\nDie Erstattung löst du im Mollie-Konto aus – sie wird hier automatisch verbucht. Notiz (optional):`
          : 'Notiz zur Erstattung (optional):'
        : `„${r.name}“ (${r.ref}) jetzt beenden?${r.autoRenew ? ' Das Abo endet damit, es wird nichts mehr abgebucht.' : ''}\n\nNotiz (optional):`,
      '',
    );
    if (note === null) return;
    void act(r.id, `/admin/addons/${r.id}/end`, { refunded, note: note.slice(0, 500), refundCents }, refunded ? 'Beendet und als erstattet vermerkt.' : 'Beendet.');
  }
  function editNote(r: AdminAddonRowDTO) {
    const note = window.prompt('Interne Notiz (nur für das Team sichtbar):', r.adminNote ?? '');
    if (note === null) return;
    void act(r.id, `/admin/addons/${r.id}/note`, { note: note.slice(0, 500) }, 'Notiz gespeichert.');
  }

  const s = data?.stats;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Aktive Extras" value={s ? String(s.active) : '–'} hint={s ? `davon ${s.subscriptions} im Abo` : undefined} tone="emerald" />
        <Stat label="Zahlung offen" value={s ? String(s.awaitingPayment) : '–'} hint="bestellt, noch nicht bezahlt" />
        <Stat label="Aufgaben" value={s ? String(s.tasks) : '–'} hint="einrichten oder zurücknehmen" tone={s && s.tasks > 0 ? 'amber' : undefined} />
        <Stat label="Einnahmen (30 Tage)" value={s ? eur(s.revenue30dCents) : '–'} hint="Erstattungen abgezogen, vor Gebühren" />
        <Stat label="Laufend pro Monat" value={s ? eur(s.monthlyRunRateCents) : '–'} hint="aktive Buchungen auf 30 Tage gerechnet" />
      </div>

      <Section
        title="Bezahlung"
        description={
          data?.payment.online
            ? 'Mollie ist eingerichtet: Kunden bezahlen online, das Extra wird automatisch freigeschaltet. Jede Zahlung wird direkt bei Mollie geprüft. Abos bucht das System kurz vor dem Ende der Laufzeit selbst ab; wird eine Zahlung von der Bank zurückgeholt, endet das Extra.'
            : 'Mollie ist noch nicht eingerichtet. Bis dahin sehen Kunden nach der Bestellung den Zahlungslink des Extras samt Verwendungszweck, und du bestätigst jede Zahlung hier von Hand. Abos gibt es nur mit Mollie.'
        }
      >
        <div className="flex items-start gap-2 text-sm">
          {data?.payment.online ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />}
          <div className="space-y-1.5 text-muted">
            {data?.payment.online ? (
              <p>
                Automatische Freischaltung aktiv.{' '}
                {data.payment.testMode && <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[12px] text-amber-200">Testmodus – es fließt kein echtes Geld (Schlüssel beginnt mit test_)</span>}
              </p>
            ) : (
              <p>
                Für die Online-Zahlung in der Datei .env auf dem Server eintragen und neu starten: <code className="font-mono text-[13px] text-gray-200">MOLLIE_API_KEY</code> (Mollie → Entwickler → API-Schlüssel; zum Ausprobieren der Test-Schlüssel).
              </p>
            )}
            {data && (
              <p>
                Rückmeldung von Mollie geht an: <code className="font-mono text-[13px] break-all text-gray-200">{data.payment.webhookUrl}</code> – die Adresse muss aus dem Internet erreichbar sein. Fällt eine Rückmeldung aus, fragt das System
                offene Zahlungen von selbst nach.
              </p>
            )}
            {data?.payment.online && <p>Für Abos müssen im Mollie-Konto Kreditkarte und/oder SEPA-Lastschrift eingeschaltet sein. Welche Zahlungsarten Kunden sehen, legst du im Mollie-Konto fest.</p>}
          </div>
        </div>
      </Section>

      <Section title="Buchungen" description="Oben steht, was etwas von dir braucht: Extras, die eingerichtet oder zurückgenommen werden müssen, und offene Zahlungen.">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setStatus(f.id);
                setPage(1);
              }}
              className={cn('rounded-full border px-3 py-1 text-[13px] transition-colors', status === f.id ? 'border-blue-500 bg-blue-500/15 text-white' : 'border-line text-muted hover:text-white')}
            >
              {f.label}
            </button>
          ))}
          <form
            className="relative ml-auto"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(q.trim());
              setPage(1);
            }}
          >
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <input type="search" className="input w-64 pl-9" placeholder="Verwendungszweck, E-Mail, Server …" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} />
          </form>
        </div>
        <Note message={message} />
        {!data ? (
          <p className="text-sm text-muted">Lädt …</p>
        ) : data.rows.length === 0 ? (
          <p className="text-sm text-muted">Keine Buchungen{status || query ? ' für diese Auswahl' : ' – sobald jemand ein Extra bestellt, erscheint es hier'}.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {data.rows.map((r) => {
              const badge = statusBadge(r);
              const open = r.status === 'pending' || (r.status === 'active' && r.renewalRequested);
              return (
                <li key={r.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-white">
                        {r.name}
                        <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', badge.cls)}>{badge.label}</span>
                        {r.checkoutPending && <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-muted">Online-Zahlung läuft</span>}
                      </p>
                      <p className="mt-1 text-[13px] text-muted">
                        <span className="font-mono text-gray-200">{r.ref}</span> · {r.serverName || '(Server gelöscht)'} <span className="font-mono text-[11px] text-subtle">{r.serverId.slice(0, 8)}</span> · {r.userEmail || '(Konto gelöscht)'}
                      </p>
                      <p className="mt-1 text-[13px] text-subtle">
                        {eur(r.priceCents)} {r.periodDays > 0 ? `für ${formatAddonPeriod(r.periodDays, 'de')}` : 'einmalig'} · bestellt {date(r.createdAt)}
                        {r.status === 'active' && <> · {r.paidUntil ? `läuft bis ${date(r.paidUntil)}` : 'ohne Enddatum'}</>}
                        {r.status === 'active' && r.autoRenew && r.nextChargeAt && <> · nächste Abbuchung {date(r.nextChargeAt)}</>}
                        {r.status === 'active' && !r.autoRenew && r.subscriptionCanceledAt && <> · Abo gekündigt {date(r.subscriptionCanceledAt)}</>}
                        {r.status === 'ended' && <> · beendet {date(r.endedAt)}</>} · bezahlt: {eur(r.paidCents)} ({r.payments}×)
                      </p>
                      {r.fulfilment === 'todo' && <p className="mt-1 text-[13px] text-amber-200">Bezahlt – bitte einrichten und danach „Eingerichtet“ klicken. Der Kunde bekommt dann eine Nachricht.</p>}
                      {r.fulfilment === 'revoke' && <p className="mt-1 text-[13px] text-amber-200">Das Extra ist beendet – bitte die Leistung zurücknehmen (z. B. IP entfernen) und danach bestätigen.</p>}
                      {r.adminNote && <p className="mt-1 text-[13px] text-gray-300">Notiz: {r.adminNote}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {open && (
                        <Button size="sm" loading={busy === r.id} onClick={() => confirmPayment(r)}>
                          Zahlung bestätigen
                        </Button>
                      )}
                      {(r.fulfilment === 'todo' || r.fulfilment === 'revoke') && (
                        <Button size="sm" loading={busy === r.id} onClick={() => void act(r.id, `/admin/addons/${r.id}/fulfil`, {}, r.fulfilment === 'todo' ? 'Als eingerichtet vermerkt – der Kunde wurde benachrichtigt.' : 'Als zurückgenommen vermerkt.')}>
                          {r.fulfilment === 'todo' ? 'Eingerichtet' : 'Zurückgenommen'}
                        </Button>
                      )}
                      {r.status === 'active' && r.paidUntil && (
                        <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => extend(r)}>
                          Laufzeit ändern
                        </Button>
                      )}
                      {r.status !== 'ended' && (
                        <>
                          <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => end(r, false)}>
                            Beenden
                          </Button>
                          {r.paidCents > 0 && (
                            <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => end(r, true)}>
                              Beenden (erstattet)
                            </Button>
                          )}
                        </>
                      )}
                      <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => editNote(r)}>
                        Notiz
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {data && data.pages > 1 && (
          <div className="flex items-center gap-3 text-sm text-muted">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Zurück
            </Button>
            Seite {data.page} von {data.pages} ({data.total} Buchungen)
            <Button size="sm" variant="secondary" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
              Weiter
            </Button>
          </div>
        )}
      </Section>

      <Section title="Extra kostenlos vergeben" description="Zum Beispiel als Dankeschön, für Gewinnspiele oder als Ausgleich nach einer Störung. Es wird sofort aktiv – ohne Zahlung.">
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
          <Labeled label="Server-ID" hint="Steht im Reiter „Server“ unter dem Namen (die ersten 8 Zeichen reichen).">
            <input type="text" className="input font-mono" value={grant.serverId} maxLength={36} placeholder="z. B. 3f2a9c1e" onChange={(e) => setGrant((g) => ({ ...g, serverId: e.target.value.trim() }))} />
          </Labeled>
          <Labeled label="Extra">
            <select className="input" value={grant.addonId} onChange={(e) => setGrant((g) => ({ ...g, addonId: e.target.value }))}>
              {catalog.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name.de}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="Tage">
            <NumberInput value={grant.days} min={1} max={3660} className="max-w-[120px]" onChange={(v) => setGrant((g) => ({ ...g, days: v }))} />
          </Labeled>
        </div>
        <Toggle checked={grant.unlimited} onChange={(v) => setGrant((g) => ({ ...g, unlimited: v }))} label="Ohne Enddatum" hint="Gilt, solange es den Server gibt." />
        <Button
          variant="secondary"
          loading={busy === 'grant'}
          disabled={grant.serverId.length < 8 || !grant.addonId}
          onClick={() => void act('grant', '/admin/addons/grant', { serverId: grant.serverId, addonId: grant.addonId, days: grant.unlimited ? null : Math.max(1, Math.round(grant.days) || 1) }, 'Extra vergeben – der Kunde wurde benachrichtigt.')}
        >
          Kostenlos vergeben
        </Button>
      </Section>
    </>
  );
}

function AddonEditor({ a, plans, onChange, onRemove }: { a: AddonSetting; plans: { id: string; name: string; kind: ProductKind }[]; onChange: (patch: Partial<AddonSetting>) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(!a.name.de);
  const fits = plans.filter((p) => a.kinds.includes(p.kind));
  return (
    <li className="rounded-xl border border-line">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <ChevronDown className={cn('size-4 shrink-0 text-subtle transition-transform', open && 'rotate-180')} aria-hidden />
          <span className="truncate text-sm font-medium text-white">{a.name.de || 'Neues Extra'}</span>
          <span className="shrink-0 text-[13px] text-muted">
            {eur(a.priceCents)} {a.periodDays > 0 ? `/ ${formatAddonPeriod(a.periodDays, 'de')}` : 'einmalig'}
          </span>
          {a.effect === 'always_on' && <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-300">automatisch</span>}
          {a.enabled && a.priceCents === 0 && <span className="shrink-0 rounded bg-amber-400/15 px-1.5 py-0.5 text-[11px] text-amber-200">ohne Preis – nicht buchbar</span>}
        </button>
        <Toggle checked={a.enabled} onChange={(v) => onChange({ enabled: v })} label="Buchbar" />
      </div>
      {open && (
        <div className="space-y-5 border-t border-line p-4">
          <Bilingual label="Name" value={a.name} maxLength={60} onChange={(name) => onChange({ name })} />
          <Bilingual label="Beschreibung" value={a.description} area maxLength={400} onChange={(description) => onChange({ description })} hint="Was bekommt der Kunde genau? Diese Beschreibung ist Teil des Vertrags – nichts versprechen, was nicht sicher geliefert wird." />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Labeled label="Preis" hint="Je Laufzeit, Endpreis in Euro.">
              <PriceInput cents={a.priceCents} onChange={(priceCents) => onChange({ priceCents })} />
            </Labeled>
            <Labeled label="Laufzeit in Tagen" hint="0 = einmalig (gilt, solange es den Server gibt).">
              <NumberInput value={a.periodDays} min={0} max={366} onChange={(periodDays) => onChange({ periodDays })} />
            </Labeled>
            <Labeled label="Wirkung" hint={a.effect === 'always_on' ? 'Das System hebt Pausen und den 30-Tage-Zyklus selbst auf.' : 'Nach der Zahlung erscheint oben eine Aufgabe für das Team.'}>
              <select className="input" value={a.effect} onChange={(e) => onChange({ effect: e.target.value as AddonEffect })}>
                <option value="always_on">24/7 – automatisch</option>
                <option value="manual">Team richtet es ein</option>
              </select>
            </Labeled>
            <Labeled label="Symbol">
              <select className="input" value={a.icon} onChange={(e) => onChange({ icon: e.target.value as AddonIcon })}>
                {ADDON_ICONS.map((i) => (
                  <option key={i} value={i}>
                    {ICON_LABEL[i]}
                  </option>
                ))}
              </select>
            </Labeled>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-sm font-medium text-gray-200">Für</p>
              <div className="flex flex-wrap gap-4">
                {productKinds.map((k) => (
                  <label key={k} className="flex items-center gap-2 text-sm text-gray-200">
                    <input
                      type="checkbox"
                      checked={a.kinds.includes(k)}
                      onChange={(e) => {
                        const kinds = e.target.checked ? [...new Set([...a.kinds, k])] : a.kinds.filter((x) => x !== k);
                        // Pakete eines abgewählten Angebots mit entfernen – sonst bliebe eine unsichtbare Einschränkung zurück
                        if (kinds.length) onChange({ kinds, planIds: a.planIds.filter((id) => plans.some((p) => p.id === id && kinds.includes(p.kind))) });
                      }}
                    />
                    {KIND_LABEL[k]}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-gray-200">Nur für diese Pakete</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {fits.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm text-gray-200">
                    <input type="checkbox" checked={a.planIds.includes(p.id)} onChange={(e) => onChange({ planIds: e.target.checked ? [...a.planIds, p.id] : a.planIds.filter((x) => x !== p.id) })} />
                    {p.name}
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-[13px] text-subtle">Nichts angehakt = alle Pakete. Tipp: 24/7 je Paketgröße einzeln anlegen – ein großer Server kostet dich im Dauerbetrieb mehr als ein kleiner.</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Labeled label="Höchstens gleichzeitig aktiv" hint="Leer = unbegrenzt. Zum Beispiel so viele freie IPv4-Adressen oder Plätze auf der schnellen Hardware du hast – danach steht „Ausgebucht“.">
              <input type="number" className="input max-w-[200px]" min={0} max={100000} value={a.maxActive ?? ''} onChange={(e) => onChange({ maxActive: e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value)) || 0) })} />
            </Labeled>
            <Labeled label="Eigener Zahlungslink" hint="Nur ohne Mollie: z. B. ein Zahlungslink mit genau diesem Betrag (https://…). Du bestätigst den Eingang dann von Hand.">
              <input type="url" className="input" value={a.paymentUrl} maxLength={300} placeholder="https://" onChange={(e) => onChange({ paymentUrl: e.target.value })} />
            </Labeled>
          </div>
          <Toggle
            checked={a.subscription && a.periodDays >= MIN_SUBSCRIPTION_DAYS}
            onChange={(v) => onChange({ subscription: v })}
            label="Auch als Abo anbieten"
            hint={
              a.periodDays < MIN_SUBSCRIPTION_DAYS
                ? `Abos gibt es erst ab ${MIN_SUBSCRIPTION_DAYS} Tagen Laufzeit.`
                : 'Kunden wählen beim Bestellen: einmalig oder Abo. Ein Abo verlängert sich automatisch um eine Laufzeit, bis der Kunde kündigt – nur mit Mollie. Bestehende Abos laufen zu dem Preis weiter, zu dem sie abgeschlossen wurden.'
            }
          />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Toggle checked={a.highlighted} onChange={(v) => onChange({ highlighted: v })} label="Hervorheben („Beliebt“)" />
            <div className="flex items-center gap-3">
              <span className="font-mono text-[12px] text-subtle">Kurzname: {a.id}</span>
              <Button size="sm" variant="ghost" onClick={onRemove}>
                <Trash2 aria-hidden /> Entfernen
              </Button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

export function AddonsAdmin({ settings }: { settings: SiteSettings }) {
  const router = useRouter();
  const [c, setC] = useState<AddonSettings>(settings.addons);
  const [baseline, setBaseline] = useState(() => JSON.stringify(settings.addons));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [newId, setNewId] = useState('');
  const plans = productKinds.flatMap((k) => settings.products[k].plans.map((p) => ({ id: p.id, name: p.name, kind: k })));

  const set = (patch: Partial<AddonSettings>) => setC((v) => ({ ...v, ...patch }));
  const setItem = (id: string, patch: Partial<AddonSetting>) => setC((v) => ({ ...v, items: v.items.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  const dirty = JSON.stringify(c) !== baseline;
  const idOk = ADDON_ID_RE.test(newId) && !c.items.some((a) => a.id === newId);
  const noPrice = c.enabled && !c.items.some((a) => a.enabled && a.priceCents > 0);

  function add() {
    if (!idOk || c.items.length >= MAX_ADDONS) return;
    set({ items: [...c.items, { id: newId, enabled: false, name: { de: '', en: '' }, description: { de: '', en: '' }, icon: 'plus', effect: 'manual', priceCents: 0, periodDays: 30, kinds: ['minecraft'], planIds: [], maxActive: null, paymentUrl: '', highlighted: false, subscription: false }] });
    setNewId('');
  }

  async function save() {
    const unnamed = c.items.find((a) => !a.name.de.trim() && !a.name.en.trim());
    if (unnamed) return setMessage({ ok: false, text: `Das Extra „${unnamed.id}“ hat noch keinen Namen – bitte ausfüllen oder entfernen.` });
    setPending(true);
    setMessage(null);
    try {
      // Eigene Adresse nur für die Extras: Andere Reiter können den Katalog nicht überschreiben – und dieser nichts anderes
      const saved = (await api<{ addons: AddonSettings }>('/admin/addons/settings', { body: { addons: c } })).addons;
      setC(saved);
      setBaseline(JSON.stringify(saved));
      setMessage({ ok: true, text: 'Gespeichert. Die Website übernimmt Änderungen innerhalb von etwa einer Minute.' });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <Bookings catalog={settings.addons.items} onChanged={() => router.refresh()} />

      <Section
        title="Extras anbieten"
        description="Kostenpflichtige Extras für kostenlose Server. Kunden buchen je Server und zahlen für eine Laufzeit im Voraus – einmalig oder, wo du es anbietest, als Abo. Ausschalten stoppt neue Bestellungen und die Verlängerung von Abos; bezahlte Laufzeiten laufen bis zum Ende weiter."
      >
        <Toggle checked={c.enabled} onChange={(enabled) => set({ enabled })} label="Extras auf der Website anbieten" hint="Zeigt die Seite „Extras“, den Reiter „Extras“ beim Server und die Bedingungen im Footer." />
        {noPrice && <p className="text-sm text-amber-200">Noch ist kein Extra buchbar: Schalte unten mindestens ein Extra ein und gib ihm einen Preis.</p>}
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/[0.06] p-3 text-[13px] leading-relaxed text-amber-100">
          Vor dem Einschalten: Mit bezahlten Extras verkaufst du Leistungen an Verbraucher. Lass die „Bedingungen für Extras“ samt Widerrufsbelehrung, die Preisangabe (Umsatzsteuer) und das Impressum bitte einmal anwaltlich bzw. steuerlich
          prüfen. Die Texte auf der Website sind eine sorgfältige Vorlage, aber keine Rechtsberatung.
        </p>
        <Bilingual
          label="Hinweis zum Preis"
          value={c.priceNote}
          maxLength={200}
          onChange={(priceNote) => set({ priceNote })}
          hint="Steht unter jedem Preis und in den Bedingungen – z. B. „inkl. MwSt.“ oder „Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.“ Frag dazu deine Steuerberatung."
        />
        <Toggle checked={c.requireAdultConfirm} onChange={(requireAdultConfirm) => set({ requireAdultConfirm })} label="Volljährigkeit bestätigen lassen" hint="Vor dem Kauf: „Ich bin volljährig – oder meine Erziehungsberechtigten haben zugestimmt.“ Empfohlen, weil viele Nutzer minderjährig sind." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Labeled label="Unbezahlte Bestellungen verwerfen nach (Tagen)">
            <NumberInput value={c.pendingDays} min={1} max={30} onChange={(pendingDays) => set({ pendingDays })} />
          </Labeled>
          <Labeled label="An Verlängerung erinnern (Tage vor Ablauf)" hint="0 = keine Erinnerung. Abos werden unabhängig davon vor jeder Abbuchung angekündigt.">
            <NumberInput value={c.remindDaysBefore} min={0} max={14} onChange={(remindDaysBefore) => set({ remindDaysBefore })} />
          </Labeled>
        </div>
        <Bilingual label="So wird ohne Automatik bezahlt" value={c.paymentNote} area maxLength={600} onChange={(paymentNote) => set({ paymentNote })} hint="Erscheint nach der Bestellung zusammen mit Betrag und Verwendungszweck – nur solange Mollie nicht eingerichtet ist." />
      </Section>

      <Section title="Katalog" description="Jedes Extra hat einen Preis und eine Laufzeit. Der Preis gilt für neue Bestellungen und Verlängerungen; laufende Buchungen bleiben, wie sie bezahlt wurden.">
        <ul className="space-y-3">
          {c.items.map((a) => (
            <AddonEditor key={a.id} a={a} plans={plans} onChange={(patch) => setItem(a.id, patch)} onRemove={() => window.confirm(`„${a.name.de || a.id}“ aus dem Katalog entfernen? Laufende Buchungen bleiben bis zum Ende aktiv, lassen sich aber nicht mehr verlängern.`) && set({ items: c.items.filter((x) => x.id !== a.id) })} />
          ))}
        </ul>
        {c.items.length < MAX_ADDONS && (
          <div className="flex flex-wrap items-end gap-3">
            <Labeled label="Neues Extra – Kurzname" hint="Kleinbuchstaben, Zahlen, Bindestrich (z. B. ram-plus-2gb). Bleibt fest und ist für Kunden nicht sichtbar.">
              <input type="text" className="input max-w-[260px] font-mono" value={newId} maxLength={32} placeholder="z. B. ddr5-epyc" onChange={(e) => setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
            </Labeled>
            <Button variant="secondary" disabled={!idOk} onClick={add} className="mb-[26px]">
              <Plus aria-hidden /> Hinzufügen
            </Button>
          </div>
        )}
      </Section>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface-2/95 p-4 backdrop-blur">
        <Button onClick={() => void save()} loading={pending} disabled={!dirty}>
          <Save aria-hidden /> Speichern
        </Button>
        <Note message={message} />
        {dirty && !message && <span className="text-sm text-amber-200">Ungespeicherte Änderungen</span>}
      </div>
    </div>
  );
}
