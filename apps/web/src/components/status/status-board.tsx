'use client';

/**
 * Statusseite: je Gruppe eine Karte, je Komponente Name, Status und ein Balken pro Tag.
 * Gruppen, Komponenten, Texte, Farben und Zeitraum kommen aus dem Admin-Bereich (StatusDTO.page).
 */
import { useEffect, useState, type CSSProperties } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  Box,
  CalendarClock,
  CheckCircle2,
  Cloud,
  Cpu,
  Database,
  Gamepad2,
  Globe,
  HelpCircle,
  Lock,
  Mail,
  Network,
  RefreshCw,
  Server,
  ShieldCheck,
  Wrench,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  formatDateTime,
  formatTime,
  freeHostingConfig,
  intlLocale,
  statusCategories,
  statusCategory,
  type ComponentStatus,
  type StatusComponentDTO,
  type StatusDTO,
  type StatusDayState,
  type StatusIcon,
  type StatusIncidentDTO,
  type StatusPageSettings,
} from '@chfree/shared';
import { useDict, useLang } from '@/i18n/client';
import { cn } from '@/lib/utils';

export const STATUS_ICONS: Record<StatusIcon, LucideIcon> = {
  network: Network,
  server: Server,
  cpu: Cpu,
  globe: Globe,
  database: Database,
  shield: ShieldCheck,
  bot: Bot,
  gamepad: Gamepad2,
  cloud: Cloud,
  activity: Activity,
  mail: Mail,
  lock: Lock,
  zap: Zap,
  box: Box,
};

const STATE_ICON: Record<StatusDayState, LucideIcon> = {
  operational: CheckCircle2,
  degraded: AlertTriangle,
  maintenance: Wrench,
  outage: XCircle,
  none: HelpCircle,
};

/** Farbe mit Deckkraft (Hex mit Alpha-Anteil) */
const alpha = (hex: string, a: string) => `${hex}${a}`;

function useFormat() {
  const lang = useLang();
  return (iso: string) => formatDateTime(iso, freeHostingConfig.fairUse.timezone, lang);
}

function usePercent() {
  const lang = useLang();
  return (v: number) => v.toLocaleString(intlLocale(lang), { maximumFractionDigits: 2 });
}

/** Text zum Status einer Komponente: eigene Bezeichnungen aus dem Admin, sonst Standard */
function useStatusLabel(page: StatusPageSettings | undefined) {
  const lang = useLang();
  const t = useDict().status;
  return (status: ComponentStatus, own?: string) => {
    const category = statusCategory(status);
    if (status === 'operational' && own) return own;
    if (status === 'partial_outage' || category === 'none' || !page) return t.states[status].label;
    return page.labels[category][lang] || t.states[status].label;
  };
}

function IncidentCard({ i, names, color, muted = false }: { i: StatusIncidentDTO; names: Record<string, string>; color: string; muted?: boolean }) {
  const lang = useLang();
  const t = useDict().status;
  const fmt = useFormat();
  const title = i.title[lang] || i.title.en;
  const message = i.message[lang] || i.message.en;
  const affected = i.components.map((c) => names[c]).filter(Boolean);
  const when =
    i.state === 'resolved'
      ? t.resolved(fmt(i.resolvedAt ?? i.endsAt ?? i.startsAt))
      : i.state === 'scheduled'
        ? `${t.from(fmt(i.startsAt))}${i.endsAt ? ` ${t.until(fmt(i.endsAt))}` : ''}`
        : `${t.since(fmt(i.startsAt))}${i.endsAt ? ` · ${t.until(fmt(i.endsAt))}` : ''}`;
  return (
    <article className={cn('rounded-xl border border-line border-l-4 bg-surface p-5', muted && 'border-l-line-strong')} style={muted ? undefined : { borderLeftColor: color }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={cn('text-[12px] font-medium tracking-wide uppercase', muted && 'text-subtle')} style={muted ? undefined : { color }}>
          {t.kinds[i.kind]}
        </span>
        <span className="text-[12px] text-subtle">{when}</span>
      </div>
      <h3 className="mt-1.5 font-semibold text-white">{title}</h3>
      {message && <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-line text-muted">{message}</p>}
      {affected.length > 0 && (
        <p className="mt-3 text-[12px] text-subtle">
          {t.affects}: {affected.join(', ')}
        </p>
      )}
    </article>
  );
}

/** Ein Balken pro Tag; beim Überfahren/Antippen erscheinen Datum, Zustand und Verfügbarkeit des Tages. */
function DayBars({ c, page }: { c: StatusComponentDTO; page: StatusPageSettings }) {
  const lang = useLang();
  const t = useDict().status;
  const pct = usePercent();
  const [hover, setHover] = useState<number | null>(null);
  const day = hover !== null ? c.days[hover] : undefined;
  const count = c.days.length;

  const stateLabel = (state: StatusDayState) => (state === 'none' ? t.noData : page.labels[state][lang]);
  const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(intlLocale(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="relative mt-4" onMouseLeave={() => setHover(null)}>
      {day && hover !== null && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2 rounded-lg border border-line-strong bg-[#0d1017] px-3 py-2 text-[12px] whitespace-nowrap shadow-xl"
          style={{ left: `clamp(72px, ${((hover + 0.5) / count) * 100}%, calc(100% - 72px))` }}
        >
          <p className="font-medium text-white">{dateLabel(day.date)}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-muted">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: page.colors[day.state] }} aria-hidden />
            {stateLabel(day.state)}
          </p>
          {day.uptime !== null && page.showUptime && <p className="mt-0.5 text-subtle">{t.dayUptime(pct(day.uptime))}</p>}
        </div>
      )}
      <div className="flex h-9 items-stretch gap-px sm:gap-[3px]" role="img" aria-label={`${t.historyLabel(count)}${c.uptime !== null ? ` – ${pct(c.uptime)} %` : ''}`}>
        {c.days.map((d, i) => (
          <span
            key={d.date}
            className={cn('min-w-0 flex-1 rounded-full transition-[opacity,transform] duration-150', hover !== null && hover !== i && 'opacity-45', hover === i && 'scale-y-110')}
            style={{ backgroundColor: page.colors[d.state] }}
            onMouseEnter={() => setHover(i)}
            onTouchStart={() => setHover((h) => (h === i ? null : i))}
          />
        ))}
      </div>
    </div>
  );
}

function ComponentRow({ c, page }: { c: StatusComponentDTO; page: StatusPageSettings }) {
  const lang = useLang();
  const t = useDict().status;
  const pct = usePercent();
  const label = useStatusLabel(page);
  const category = statusCategory(c.status);
  const Icon = STATE_ICON[category];
  const color = category === 'none' ? undefined : page.colors[category];
  const subtitle = c.subtitle[lang];
  const showHistory = page.showBars && c.days.length > 0;

  return (
    <li className="px-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="font-semibold text-white">{c.name[lang]}</span>
          {subtitle && <span className="text-[13px] text-subtle">{subtitle}</span>}
        </p>
        <p className={cn('flex shrink-0 items-center gap-1.5 text-sm font-medium', !color && 'text-gray-300')} style={color ? { color } : undefined}>
          {page.showLatency && c.latencyMs !== null && <span className="mr-1.5 text-xs font-normal text-subtle">{c.latencyMs} ms</span>}
          <Icon className="size-4" aria-hidden />
          {label(c.status, c.operationalLabel[lang])}
        </p>
      </div>
      {showHistory && <DayBars c={c} page={page} />}
      {(showHistory || page.showUptime) && (
        <div className="mt-2.5 grid grid-cols-3 items-center text-[13px] text-subtle">
          <span>{showHistory ? t.daysAgo(c.days.length) : ''}</span>
          <span className="text-center font-semibold text-gray-200" title={t.uptimeHint(page.days)}>
            {page.showUptime ? (c.uptime !== null ? `${pct(c.uptime)} %` : <span className="font-normal text-subtle">{t.uptimeNone}</span>) : ''}
          </span>
          <span className="text-right">{showHistory ? t.today : ''}</span>
        </div>
      )}
    </li>
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

  if (!status) return <p className="rounded-2xl border border-line bg-surface px-5 py-8 text-center text-sm text-muted">{t.loadError}</p>;

  const page = status.page;
  const overall = statusCategory(status.overall);
  const overallColor = overall === 'none' ? undefined : page.colors[overall];
  const banner = overall === 'none' || status.overall === 'partial_outage' ? t.states[status.overall].banner : page.banners[overall][lang];
  const names = Object.fromEntries(status.components.map((c) => [c.id, c.name[lang]]));
  const impactColor = (i: StatusIncidentDTO) => {
    const category = statusCategory(i.impact);
    return page.colors[category === 'none' || (category === 'operational' && i.kind !== 'notice') ? 'maintenance' : category];
  };
  const active = status.incidents.filter((i) => i.state === 'active');
  const scheduled = status.incidents.filter((i) => i.state === 'scheduled').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = status.incidents.filter((i) => i.state === 'resolved');
  const updated = (
    <button type="button" onClick={refresh} className="inline-flex items-center gap-2 self-start text-sm text-gray-300 hover:text-white sm:self-auto" disabled={loading}>
      <RefreshCw className={cn('size-4', loading && 'animate-spin')} aria-hidden />
      {t.updatedAt(formatTime(status.updatedAt, freeHostingConfig.fairUse.timezone, lang))}
    </button>
  );

  return (
    <div>
      {page.showBanner ? (
        <div
          className={cn('flex flex-col gap-3 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between', !overallColor && 'border-line bg-surface')}
          style={overallColor ? ({ borderColor: alpha(overallColor, '4d'), backgroundColor: alpha(overallColor, '1a') } as CSSProperties) : undefined}
        >
          <div className="flex items-center gap-3">
            <span className="relative flex size-3">
              {overall === 'operational' && <span className="absolute inline-flex size-full animate-ping rounded-full opacity-50" style={{ backgroundColor: overallColor }} />}
              <span className={cn('relative inline-flex size-3 rounded-full', !overallColor && 'bg-gray-500')} style={overallColor ? { backgroundColor: overallColor } : undefined} />
            </span>
            <p className="text-lg font-semibold text-white">{banner}</p>
          </div>
          {updated}
        </div>
      ) : (
        <div className="flex justify-end">{updated}</div>
      )}

      {active.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-white">{t.activeTitle}</h2>
          <div className="mt-3 space-y-3">
            {active.map((i) => (
              <IncidentCard key={i.id} i={i} names={names} color={impactColor(i)} />
            ))}
          </div>
        </section>
      )}

      {scheduled.length > 0 && (
        <section className="mt-8">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <CalendarClock className="size-4" style={{ color: page.colors.maintenance }} aria-hidden /> {t.scheduledTitle}
          </h2>
          <div className="mt-3 space-y-3">
            {scheduled.map((i) => (
              <IncidentCard key={i.id} i={i} names={names} color={page.colors.maintenance} />
            ))}
          </div>
        </section>
      )}

      <div className="mt-8 space-y-5">
        {status.groups.map((g) => {
          const Icon = STATUS_ICONS[g.icon] ?? Server;
          const items = status.components.filter((c) => c.group === g.id);
          return (
            <section key={g.id} className="overflow-hidden rounded-2xl border border-line bg-surface">
              <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
                <h2 className="flex items-center gap-2.5 font-semibold text-white">
                  <Icon className="size-[18px] text-muted" aria-hidden />
                  {g.name[lang]}
                </h2>
                {page.showBars && <span className="text-sm text-subtle">{t.days(page.days)}</span>}
              </header>
              <ul className="divide-y divide-line">
                {items.map((c) => (
                  <ComponentRow key={c.id} c={c} page={page} />
                ))}
              </ul>
            </section>
          );
        })}
        {status.components.length === 0 && <p className="rounded-2xl border border-line bg-surface px-5 py-8 text-center text-sm text-muted">{t.empty}</p>}
      </div>

      {page.showLegend && page.showBars && status.components.length > 0 && (
        <ul className="mt-6 flex flex-wrap items-center gap-x-7 gap-y-2 border-t border-line pt-5 text-sm text-muted">
          {statusCategories.map((c) => (
            <li key={c} className="flex items-center gap-2">
              <span className="size-3 rounded-[3px]" style={{ backgroundColor: page.colors[c] }} aria-hidden />
              {page.labels[c][lang]}
            </li>
          ))}
        </ul>
      )}

      {page.showPast && (
        <section className="mt-10">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-sm font-semibold text-white">{t.pastTitle}</h2>
            <span className="text-[12px] text-subtle">{t.pastHint}</span>
          </div>
          <div className="mt-3 space-y-3">
            {past.length === 0 ? (
              <p className="rounded-xl border border-line px-5 py-4 text-sm text-muted">{t.noPast}</p>
            ) : (
              past.map((i) => <IncidentCard key={i.id} i={i} names={names} color={impactColor(i)} muted />)
            )}
          </div>
        </section>
      )}
    </div>
  );
}
