'use client';

/**
 * Extras (kostenpflichtige Add-ons) eines Servers: gebuchte Extras mit Stand und Zahlungsweg, buchbare Extras mit
 * Bestellformular. Bezahlt wird im Voraus für eine Laufzeit – ohne Abo, ohne automatische Verlängerung.
 * Preise und Wirkung kommen immer von der API; hier wird nur angezeigt und bestellt.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Check, Copy, Sparkles } from 'lucide-react';
import { formatAddonPeriod, formatAddonPrice, formatDateTime, freeHostingConfig, localePath, type AddonOfferDTO, type ServerAddonDTO, type ServerAddonsDTO } from '@chfree/shared';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/primitives';
import { useDict, useLang } from '@/i18n/client';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { addonIcons } from './addon-icons';

type Result = { addons: ServerAddonsDTO; checkoutUrl?: string | null };

function CopyValue({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-line-strong px-2 py-1 font-mono text-[13px] text-white hover:bg-white/5"
    >
      {value}
      {done ? <Check className="size-3.5 text-emerald-300" aria-hidden /> : <Copy className="size-3.5 text-subtle" aria-hidden />}
    </button>
  );
}

/** Die drei Bestätigungen vor dem Kauf (Bedingungen + Widerruf, sofortiger Beginn, Volljährigkeit) */
function Consents({ adult, value, onChange, errors }: { adult: boolean; value: { terms: boolean; early: boolean; adult: boolean }; onChange: (v: { terms: boolean; early: boolean; adult: boolean }) => void; errors: Record<string, string> }) {
  const t = useDict().extras;
  const lang = useLang();
  const box = 'mt-1 size-4 shrink-0 accent-blue-600';
  const label = 'flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-muted';
  const link = 'text-gray-200 underline underline-offset-4 hover:text-white';
  const terms = localePath(lang, 'extrasTerms');
  return (
    <div className="space-y-3">
      <label className={label}>
        <input type="checkbox" className={box} checked={value.terms} onChange={(e) => onChange({ ...value, terms: e.target.checked })} />
        <span>
          {t.acceptBefore}
          <Link href={terms} target="_blank" className={link}>
            {t.acceptTerms}
          </Link>
          {t.acceptMid}
          <Link href={`${terms}#widerruf`} target="_blank" className={link}>
            {t.acceptWithdrawal}
          </Link>
          {t.acceptAfter}
        </span>
      </label>
      {errors.acceptTerms && <p className="text-sm text-red-400">{errors.acceptTerms}</p>}
      <label className={label}>
        <input type="checkbox" className={box} checked={value.early} onChange={(e) => onChange({ ...value, early: e.target.checked })} />
        <span>{t.acceptEarly}</span>
      </label>
      {errors.acceptEarlyStart && <p className="text-sm text-red-400">{errors.acceptEarlyStart}</p>}
      {adult && (
        <>
          <label className={label}>
            <input type="checkbox" className={box} checked={value.adult} onChange={(e) => onChange({ ...value, adult: e.target.checked })} />
            <span>{t.acceptAdult}</span>
          </label>
          {errors.adult && <p className="text-sm text-red-400">{errors.adult}</p>}
        </>
      )}
    </div>
  );
}

export function ServerAddons({ id, serverName }: { id: string; serverName: string }) {
  const t = useDict().extras;
  const lang = useLang();
  const tz = freeHostingConfig.fairUse.timezone;
  const [data, setData] = useState<ServerAddonsDTO | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /** Offenes Bestellformular: neues Extra (Katalog-ID) oder Verlängerung (Buchung) */
  const [form, setForm] = useState<{ kind: 'order'; addonId: string } | { kind: 'renew'; rowId: string } | null>(null);
  const [consent, setConsent] = useState({ terms: false, early: false, adult: false });
  const [paid, setPaid] = useState<'checking' | 'done' | 'open' | null>(null);

  const load = useCallback(async () => {
    try {
      setData((await api<{ addons: ServerAddonsDTO }>(`/servers/${id}/addons`)).addons);
    } catch {
      setData((cur) => cur ?? null);
    }
  }, [id]);

  useEffect(() => {
    let off = false;
    // Rückkehr von der Bezahlseite (?paid=1): Stand der Zahlung gleich prüfen
    const returned = new URLSearchParams(window.location.search).get('paid') === '1';
    if (returned) {
      setPaid('checking');
      api<{ addons: ServerAddonsDTO }>(`/servers/${id}/addons/check`, { body: {} })
        .then((d) => {
          if (off) return;
          setData(d.addons);
          setPaid(d.addons.booked.some((b) => b.status === 'pending' || b.renewalRequested) ? 'open' : 'done');
        })
        .catch(() => !off && void load());
      const url = new URL(window.location.href);
      url.searchParams.delete('paid');
      window.history.replaceState(null, '', url.toString());
    } else void load();
    return () => {
      off = true;
    };
  }, [id, load]);

  // Solange eine Zahlung offen ist, regelmäßig nachsehen (Freischaltung erscheint dann von selbst)
  const waiting = !!data?.booked.some((b) => b.status === 'pending' || b.renewalRequested);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 15_000);
    return () => clearInterval(timer);
  }, [waiting, load]);
  useEffect(() => {
    if (paid === 'open' && data && !waiting) setPaid('done');
  }, [paid, data, waiting]);

  async function run(key: string, path: string, body: unknown): Promise<Result | null> {
    setBusy(key);
    setError(null);
    setFieldErrors({});
    try {
      const res = await api<Result>(path, { body });
      setData(res.addons);
      return res;
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) setFieldErrors(err.fields);
      setError(err instanceof ApiClientError ? err.message : String(err));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (!form) return;
    const body = { acceptTerms: consent.terms, acceptEarlyStart: consent.early, adult: consent.adult };
    const res = form.kind === 'order' ? await run('submit', `/servers/${id}/addons`, { addonId: form.addonId, ...body }) : await run('submit', `/servers/${id}/addons/${form.rowId}/renew`, body);
    if (!res) return;
    setForm(null);
    setConsent({ terms: false, early: false, adult: false });
    if (res.checkoutUrl) window.location.assign(res.checkoutUrl);
  }

  async function pay(row: ServerAddonDTO) {
    const res = await run(`pay:${row.id}`, `/servers/${id}/addons/${row.id}/pay`, {});
    if (res?.checkoutUrl) window.location.assign(res.checkoutUrl);
  }

  if (data === undefined) return <section className="surface p-5 text-sm text-subtle">…</section>;
  // Ausgeschaltet: laufende Buchungen bleiben sichtbar, neue gibt es nicht
  if (data === null || (!data.enabled && data.booked.length === 0)) return <section className="surface p-5 text-sm text-muted">{t.closed}</section>;

  const price = (cents: number, days: number) => (
    <span className="whitespace-nowrap">
      <span className="text-lg font-semibold text-white tabular-nums">{formatAddonPrice(cents, lang)}</span>
      <span className="ml-1.5 text-[13px] text-subtle">{days > 0 ? t.perPeriod(formatAddonPeriod(days, lang)) : t.once}</span>
    </span>
  );
  const open = data.booked.filter((b) => b.status !== 'ended');
  const ended = data.booked.filter((b) => b.status === 'ended');
  const formOffer = form?.kind === 'order' ? data.offers.find((o) => o.id === form.addonId) : null;
  const formRow = form?.kind === 'renew' ? data.booked.find((b) => b.id === form.rowId) : null;

  const checkout = (title: string, cents: number, days: number) => (
    <div className="mt-4 rounded-xl border border-blue-400/30 bg-blue-400/[0.05] p-4">
      <p className="text-[12px] font-semibold tracking-[0.08em] text-subtle uppercase">{t.summary}</p>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-gray-100">
          <span className="font-medium text-white">{title}</span> {t.forServer(serverName)}
        </p>
        {price(cents, days)}
      </div>
      {data.priceNote && <p className="mt-1 text-[12px] text-subtle">{data.priceNote}</p>}
      <div className="mt-4">
        <Consents adult={data.requireAdultConfirm} value={consent} onChange={setConsent} errors={fieldErrors} />
      </div>
      {error && (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button loading={busy === 'submit'} onClick={() => void submit()}>
          {t.orderNow}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setForm(null);
            setError(null);
            setFieldErrors({});
          }}
        >
          {t.back}
        </Button>
      </div>
    </div>
  );

  const offerCard = (o: AddonOfferDTO) => (
    <li key={o.id} className={cn('flex flex-col rounded-xl border bg-surface p-5', o.highlighted ? 'border-blue-500/50' : 'border-line')}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-blue-500/15 text-blue-300">{addonIcons[o.icon]}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium text-white">
            {o.name[lang] || o.name.de}
            {o.highlighted && <span className="rounded bg-blue-500 px-1.5 py-0.5 text-[11px] tracking-[0.06em] text-white uppercase">{t.popular}</span>}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted">{o.description[lang] || o.description.de}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
        <div>
          {price(o.priceCents, o.periodDays)}
          {data.priceNote && <p className="text-[12px] text-subtle">{data.priceNote}</p>}
        </div>
        {o.available ? (
          <Button
            size="sm"
            variant={form?.kind === 'order' && form.addonId === o.id ? 'secondary' : 'primary'}
            onClick={() => {
              setError(null);
              setFieldErrors({});
              setForm({ kind: 'order', addonId: o.id });
            }}
          >
            {t.book}
          </Button>
        ) : (
          <span className="text-[13px] text-subtle">{o.unavailable === 'booked' ? t.booked : o.unavailable === 'sold_out' ? t.soldOut : t.notEligible}</span>
        )}
      </div>
      {formOffer?.id === o.id && checkout(o.name[lang] || o.name.de, o.priceCents, o.periodDays)}
    </li>
  );

  const bookedRow = (b: ServerAddonDTO) => {
    const due = b.status === 'pending' || b.renewalRequested;
    return (
      <li key={b.id} className="px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', b.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-subtle')}>{addonIcons[b.icon]}</span>
            <div className="min-w-0">
              <p className="font-medium text-white">{b.name}</p>
              <p className="mt-0.5 text-[13px] text-muted">
                {b.status === 'active' ? (
                  <>
                    <span className="text-emerald-300">{t.statusActive}</span> · {b.paidUntil ? t.activeUntil(formatDateTime(b.paidUntil, tz, lang)) : t.unlimited}
                  </>
                ) : b.status === 'pending' ? (
                  <span className="text-amber-300">{t.statusPending}</span>
                ) : (
                  <>
                    {t.statusEnded}
                    {b.endReason ? ` · ${t.endedReasons[b.endReason] ?? b.endReason}` : ''}
                  </>
                )}
              </p>
              {b.status === 'active' && b.fulfilment === 'todo' && <p className="mt-1 text-[13px] text-amber-200">{t.setupTodo}</p>}
              {b.status === 'active' && b.fulfilment === 'done' && <p className="mt-1 text-[13px] text-subtle">{t.setupDone}</p>}
              {b.status === 'active' && b.renewalRequested && <p className="mt-1 text-[13px] text-amber-200">{t.renewalOpen}</p>}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {b.status === 'active' && b.canRenew && !b.renewalRequested && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setError(null);
                  setFieldErrors({});
                  setForm({ kind: 'renew', rowId: b.id });
                }}
              >
                {t.renew}
              </Button>
            )}
            {due && b.payment?.mode === 'checkout' && (
              <Button size="sm" loading={busy === `pay:${b.id}`} onClick={() => void pay(b)}>
                {t.payNow}
              </Button>
            )}
            {due && (
              <Button
                size="sm"
                variant="ghost"
                loading={busy === `cancel:${b.id}`}
                onClick={() => {
                  if (b.status === 'pending' && !window.confirm(t.cancelConfirm)) return;
                  void run(`cancel:${b.id}`, `/servers/${id}/addons/${b.id}/cancel`, {});
                }}
              >
                {b.status === 'pending' ? t.cancel : t.cancelRenewal}
              </Button>
            )}
          </div>
        </div>
        {due && b.payment && (
          <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/[0.05] p-4 text-sm">
            <p className="font-medium text-white">{t.payTitle}</p>
            {b.payment.mode === 'checkout' ? (
              <p className="mt-1 leading-relaxed text-muted">{t.checkoutNote}</p>
            ) : (
              <>
                {b.payment.note && <p className="mt-1 leading-relaxed whitespace-pre-line text-muted">{b.payment.note}</p>}
                <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
                  <dt className="text-subtle">{t.amount}</dt>
                  <dd className="font-semibold text-white tabular-nums">{formatAddonPrice(b.payment.amountCents, lang)}</dd>
                  <dt className="text-subtle">{t.reference}</dt>
                  <dd>
                    <CopyValue value={b.payment.reference} />
                  </dd>
                </dl>
                <p className="mt-2 text-[13px] text-subtle">{t.referenceHint}</p>
                {b.payment.url ? (
                  <div className="mt-3">
                    <ButtonLink href={b.payment.url} external size="sm">
                      {t.payLink} <ArrowUpRight aria-hidden />
                    </ButtonLink>
                  </div>
                ) : (
                  <p className="mt-2 text-[13px] text-amber-200">{t.noLink}</p>
                )}
              </>
            )}
          </div>
        )}
        {formRow?.id === b.id && checkout(b.name, data.offers.find((o) => o.id === b.addonId)?.priceCents ?? b.priceCents, data.offers.find((o) => o.id === b.addonId)?.periodDays ?? b.periodDays)}
      </li>
    );
  };

  return (
    <div className="space-y-5">
      {paid === 'checking' && <Alert>{t.paidChecking}</Alert>}
      {paid === 'done' && <Alert tone="success">{t.paidDone}</Alert>}
      {paid === 'open' && <Alert tone="warning">{t.paidOpen}</Alert>}
      {error && !form && <Alert tone="error">{error}</Alert>}

      {open.length > 0 && (
        <section className="surface overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-semibold text-white">{t.yours}</h2>
          </div>
          <ul className="divide-y divide-line">{open.map(bookedRow)}</ul>
        </section>
      )}

      <section>
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 size-5 shrink-0 text-blue-300" aria-hidden />
          <div>
            <h2 className="font-semibold text-white">{t.available}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">{t.tabIntro}</p>
          </div>
        </div>
        {!data.enabled ? <p className="mt-4 text-sm text-subtle">{t.closed}</p> : data.offers.length === 0 ? <p className="mt-4 text-sm text-subtle">{t.none}</p> : <ul className="mt-4 grid gap-4 xl:grid-cols-2">{data.offers.map(offerCard)}</ul>}
        <p className="mt-4 text-[13px] text-subtle">
          <Link href={localePath(lang, 'extrasTerms')} className="underline underline-offset-4 hover:text-white">
            {t.termsLink}
          </Link>
        </p>
      </section>

      {ended.length > 0 && (
        <section className="surface overflow-hidden opacity-80">
          <ul className="divide-y divide-line">{ended.map(bookedRow)}</ul>
        </section>
      )}
    </div>
  );
}
