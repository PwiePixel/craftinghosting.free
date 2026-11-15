'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, RefreshCw } from 'lucide-react';
import { formatDateTime, formatTime, freeHostingConfig, intlLocale, type ComponentStatus, type StatusDTO, type StatusIncidentDTO } from '@chfree/shared';
import { useDict, useLang } from '@/i18n/client';
import { cn } from '@/lib/utils';

const statusStyle: Record<ComponentStatus, { dot: string; text: string; border: string }> = {
  operational: { dot: 'bg-emerald-400', text: 'text-emerald-300', border: 'border-l-emerald-400' },
  degraded: { dot: 'bg-amber-400', text: 'text-amber-300', border: 'border-l-amber-400' },
  partial_outage: { dot: 'bg-amber-500', text: 'text-amber-300', border: 'border-l-amber-500' },
  major_outage: { dot: 'bg-red-500', text: 'text-red-300', border: 'border-l-red-500' },
  maintenance: { dot: 'bg-blue-400', text: 'text-blue-300', border: 'border-l-blue-400' },
  unknown: { dot: 'bg-gray-500', text: 'text-gray-300', border: 'border-l-gray-500' },
};

function useFormat() {
  const lang = useLang();
  return (iso: string) => formatDateTime(iso, freeHostingConfig.fairUse.timezone, lang);
}

function IncidentCard({ i, muted = false }: { i: StatusIncidentDTO; muted?: boolean }) {
  const lang = useLang();
  const t = useDict().status;
  const fmt = useFormat();
  const style = statusStyle[i.impact];
  const title = i.title[lang] || i.title.en;
  const message = i.message[lang] || i.message.en;
  const names = i.components.map((c) => t.components[c]?.name ?? c);
  const when =
    i.state === 'resolved'
      ? t.resolved(fmt(i.resolvedAt ?? i.endsAt ?? i.startsAt))
      : i.state === 'scheduled'
        ? `${t.from(fmt(i.startsAt))}${i.endsAt ? ` ${t.until(fmt(i.endsAt))}` : ''}`
        : `${t.since(fmt(i.startsAt))}${i.endsAt ? ` · ${t.until(fmt(i.endsAt))}` : ''}`;
  return (
    <article className={cn('rounded-xl border border-line border-l-4 bg-surface p-5', muted ? 'border-l-line-strong' : style.border)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={cn('text-[12px] font-medium tracking-wide uppercase', muted ? 'text-subtle' : style.text)}>{t.kinds[i.kind]}</span>
        <span className="text-[12px] text-subtle">{when}</span>
      </div>
      <h3 className="mt-1.5 font-semibold text-white">{title}</h3>
      {message && <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-line text-muted">{message}</p>}
      {names.length > 0 && (
        <p className="mt-3 text-[12px] text-subtle">
          {t.affects}: {names.join(', ')}
        </p>
      )}
    </article>
  );
}

export function StatusBoard({ initial }: { initial: StatusDTO | null }) {
  const lang = useLang();
  const t = useDict().status;
  const [status, setStatus] = useState<StatusDTO | null>(initial);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/status', { cache: 'no-store' });
      if (res.ok) setStatus((await res.json()).status);
    } catch {
      /* Anzeige bleibt beim letzten Stand */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overall = status?.overall ?? 'unknown';
  const meta = { ...statusStyle[overall], ...t.states[overall] };
  const incidents = status?.incidents ?? [];
  const active = incidents.filter((i) => i.state === 'active');
  const scheduled = incidents.filter((i) => i.state === 'scheduled').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = incidents.filter((i) => i.state === 'resolved');
  const pct = (v: number) => v.toLocaleString(intlLocale(lang), { maximumFractionDigits: 2 });

  return (
    <div className="mx-auto max-w-3xl">
      <div
        className={cn(
          'flex flex-col gap-3 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between',
          overall === 'operational'
            ? 'border-emerald-500/30 bg-emerald-500/10'
            : overall === 'unknown'
              ? 'border-line bg-surface'
              : overall === 'maintenance'
                ? 'border-blue-500/30 bg-blue-500/10'
                : overall === 'major_outage'
                  ? 'border-red-500/30 bg-red-500/10'
                  : 'border-amber-500/30 bg-amber-500/10',
        )}
      >
        <div className="flex items-center gap-3">
          <span className="relative flex size-3">
            {overall === 'operational' && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />}
            <span className={cn('relative inline-flex size-3 rounded-full', meta.dot)} />
          </span>
          <p className="text-lg font-semibold text-white">{meta.banner}</p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-2 self-start text-sm text-gray-300 hover:text-white sm:self-auto"
          disabled={loading}
        >
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} aria-hidden />
          {status ? t.updatedAt(formatTime(status.updatedAt, freeHostingConfig.fairUse.timezone, lang)) : t.refresh}
        </button>
      </div>

      {active.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-white">{t.activeTitle}</h2>
          <div className="mt-3 space-y-3">
            {active.map((i) => (
              <IncidentCard key={i.id} i={i} />
            ))}
          </div>
        </section>
      )}

      {scheduled.length > 0 && (
        <section className="mt-8">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <CalendarClock className="size-4 text-blue-400" aria-hidden /> {t.scheduledTitle}
          </h2>
          <div className="mt-3 space-y-3">
            {scheduled.map((i) => (
              <IncidentCard key={i.id} i={i} />
            ))}
          </div>
        </section>
      )}

      <ul className="mt-8 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {(status?.components ?? []).map((c) => {
          const m = { ...statusStyle[c.status], ...t.states[c.status] };
          const info = t.components[c.id] ?? { name: c.name, description: c.description };
          return (
            <li key={c.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="font-medium text-white">{info.name}</p>
                <p className="text-sm text-muted">{info.description}</p>
                <p className="mt-1 text-[12px] text-subtle" title={t.uptimeHint}>
                  {c.uptime30d !== null ? t.uptime(pct(c.uptime30d)) : t.uptimeNone}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-sm">
                {c.latencyMs !== null && <span className="hidden text-xs text-subtle sm:inline">{c.latencyMs} ms</span>}
                <span className={cn('size-2 rounded-full', m.dot)} aria-hidden />
                <span className={cn('font-medium', m.text)}>{m.label}</span>
              </div>
            </li>
          );
        })}
        {!status && <li className="px-5 py-8 text-center text-sm text-muted">{t.loadError}</li>}
      </ul>

      {status && (
        <section className="mt-10">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-sm font-semibold text-white">{t.pastTitle}</h2>
            <span className="text-[12px] text-subtle">{t.pastHint}</span>
          </div>
          <div className="mt-3 space-y-3">
            {past.length === 0 ? (
              <p className="rounded-xl border border-line px-5 py-4 text-sm text-muted">{t.noPast}</p>
            ) : (
              past.map((i) => <IncidentCard key={i.id} i={i} muted />)
            )}
          </div>
        </section>
      )}
    </div>
  );
}
