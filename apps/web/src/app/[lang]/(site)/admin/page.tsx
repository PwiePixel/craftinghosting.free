import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  freeHostingConfig,
  localePath,
  type AdminAuditDTO,
  type AdminMailDTO,
  type AdminOverviewDTO,
  type AdminServerDTO,
  type AdminUserDTO,
  type AdminWaitlistBlockDTO,
  type AdminWaitlistDTO,
  type PageInfo,
  type PublicSiteDTO,
  type SiteSettings,
  type StatusDTO,
  type StatusIncidentDTO,
  type UserDTO,
} from '@chfree/shared';
import { MailTestForm, RunJobButton, ServerActions } from '@/components/admin/admin-actions';
import { MaintenanceQuickToggle, SettingsForm, StatusOverrides } from '@/components/admin/admin-settings';
import { IncidentForm, IncidentList } from '@/components/admin/admin-status';
import { UsersTable } from '@/components/admin/admin-users';
import { ExternalSpotsForm, WaitlistAddForm, WaitlistManager } from '@/components/admin/admin-waitlist';
import { Alert, StatusDot } from '@/components/ui/primitives';
import { formatters, getDict, resolveLang } from '@/i18n';
import { adminPath } from '@/lib/admin-path';
import { apiServer } from '@/lib/api/server';
import { cn } from '@/lib/utils';

/**
 * Admin-Bereich (intern, nur Deutsch) unter dem geheimen Pfad ADMIN_PATH – nirgends verlinkt,
 * nicht indexierbar. Zugriff: role = admin oder E-Mail in ADMIN_EMAILS.
 * Für alle anderen (auch nicht angemeldete Besucher) existiert die Seite nicht (404).
 */
type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | undefined>> };

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  alternates: { canonical: null, languages: {} },
  openGraph: null,
};
export const dynamic = 'force-dynamic';

const TABS = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'settings', label: 'Einstellungen' },
  { id: 'waitlist', label: 'Warteliste' },
  { id: 'status', label: 'Statusseite' },
  { id: 'servers', label: 'Server' },
  { id: 'users', label: 'Nutzer' },
  { id: 'logs', label: 'Protokoll' },
  { id: 'mails', label: 'E-Mails' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const STATUS_LABEL: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'blue' | 'gray' }> = {
  waitlist: { label: 'Warteliste', tone: 'blue' },
  pending: { label: 'Wartet (Panel-Zugang)', tone: 'gray' },
  provisioning: { label: 'Wird eingerichtet', tone: 'blue' },
  provisioning_failed: { label: 'Einrichtung fehlgeschlagen', tone: 'red' },
  active: { label: 'Aktiv', tone: 'green' },
  expiring: { label: 'Läuft ab', tone: 'amber' },
  suspended: { label: 'Suspendiert', tone: 'red' },
  deleted: { label: 'Gelöscht', tone: 'gray' },
};

const MODE_LABEL: Record<SiteSettings['registration']['mode'], string> = {
  open: 'Offen',
  preregistration: 'Vorregistrierung (Early Access)',
  closed: 'Geschlossen',
};

/** Komponenten der Statusseite (Namen wie auf der Website) */
const STATUS_COMPONENTS = Object.entries(getDict('de').status.components).map(([id, c]) => ({ id, name: c.name }));

/** Seitenzahlen mit Auslassungen: 1 … 4 5 [6] 7 8 … 20 */
function pageNumbers(page: number, pages: number): (number | '…')[] {
  const set = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter((n) => n >= 1 && n <= pages));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1]! > 1) out.push('…');
    out.push(n);
  });
  return out;
}

/** Blättern: immer 50 Einträge pro Seite, Pfeile und Seitenzahlen oben und unten */
function Pager({ info, href, label }: { info: PageInfo; href: (page: number) => string; label: string }) {
  if (info.total === 0) return null;
  const from = (info.page - 1) * info.pageSize + 1;
  const to = Math.min(info.total, info.page * info.pageSize);
  const btn = 'inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-[13px] transition-colors';
  return (
    <nav aria-label="Seiten" className="my-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[13px] text-subtle">
        {from.toLocaleString('de-DE')}–{to.toLocaleString('de-DE')} von {info.total.toLocaleString('de-DE')} {label}
        {info.pages > 1 ? ` · Seite ${info.page} von ${info.pages}` : ''}
      </p>
      {info.pages > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          {info.page > 1 ? (
            <Link href={href(info.page - 1)} aria-label="Vorherige Seite" className={cn(btn, 'border-line-strong text-gray-200 hover:bg-white/5')}>
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
          ) : (
            <span className={cn(btn, 'border-line text-subtle opacity-50')} aria-hidden>
              <ChevronLeft className="size-4" />
            </span>
          )}
          {pageNumbers(info.page, info.pages).map((n, i) =>
            n === '…' ? (
              <span key={`gap-${i}`} className="px-1 text-subtle">
                …
              </span>
            ) : (
              <Link
                key={n}
                href={href(n)}
                aria-current={n === info.page ? 'page' : undefined}
                className={cn(btn, n === info.page ? 'border-blue-500 bg-blue-500/15 text-white' : 'border-line-strong text-gray-300 hover:bg-white/5')}
              >
                {n}
              </Link>
            ),
          )}
          {info.page < info.pages ? (
            <Link href={href(info.page + 1)} aria-label="Nächste Seite" className={cn(btn, 'border-line-strong text-gray-200 hover:bg-white/5')}>
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <span className={cn(btn, 'border-line text-subtle opacity-50')} aria-hidden>
              <ChevronRight className="size-4" />
            </span>
          )}
        </div>
      )}
    </nav>
  );
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('surface p-5', className)}>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'red' | 'amber' }) {
  return (
    <div>
      <p className={cn('text-2xl font-semibold tracking-tight', tone === 'red' ? 'text-red-300' : tone === 'amber' ? 'text-amber-300' : 'text-white')}>{value}</p>
      <p className="mt-0.5 text-[13px] text-subtle">{label}</p>
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[900px] text-left text-[13px]">
        <thead className="bg-surface-2 text-gray-300">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2.5 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line bg-surface align-top">{children}</tbody>
      </table>
    </div>
  );
}

/** Filter der Nutzerliste (wie in der API) */
const USER_FILTERS = {
  unverified: 'E-Mail unbestätigt',
  'no-servers': 'ohne Server',
  waitlist: 'auf der Warteliste',
  locked: 'gesperrt',
  admins: 'Admins',
} as const;

function SearchBar({ tab, q, status }: { tab: Tab; q?: string; status?: string }) {
  return (
    <form method="get" action={adminPath()} className="mb-4 flex flex-col gap-2 sm:flex-row">
      <input type="hidden" name="tab" value={tab} />
      <input name="q" defaultValue={q} placeholder="Suchen (Name, E-Mail, ID …)" className="input sm:max-w-sm" />
      {tab === 'users' && (
        <select name="status" defaultValue={status ?? ''} className="input sm:max-w-[220px]" aria-label="Filter">
          <option value="">Alle Nutzer</option>
          {Object.entries(USER_FILTERS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      )}
      {tab === 'servers' && (
        <select name="status" defaultValue={status ?? ''} className="input sm:max-w-[220px]">
          <option value="">Alle (ohne gelöschte)</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      )}
      <button type="submit" className="rounded-lg border border-line-strong px-4 py-2 text-sm text-gray-200 hover:bg-white/5">
        Filtern
      </button>
    </form>
  );
}

/* ---------------------------------------------------------------- Tabs */

function OverviewTab({ o, settings, fmt }: { o: AdminOverviewDTO; settings: SiteSettings | null; fmt: ReturnType<typeof formatters> }) {
  const s = o.servers.byStatus;
  const base = adminPath();
  return (
    <div className="space-y-5">
      {o.site.maintenance && (
        <Alert tone="warning" title="Wartungsmodus ist aktiv">
          Besucher sehen die Wartungsseite. Du als Admin siehst die Website weiterhin normal.
        </Alert>
      )}
      <Card title="Website">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Wartungsmodus" value={o.site.maintenance ? 'an' : 'aus'} tone={o.site.maintenance ? 'amber' : undefined} />
            <div>
              <p className="text-base font-semibold text-white">{MODE_LABEL[o.site.registrationMode]}</p>
              <p className="mt-0.5 text-[13px] text-subtle">Registrierung · max. {o.site.maxServersPerUser} pro Person</p>
            </div>
            <Stat label="auf der Warteliste" value={o.site.waitlistConfirmed} />
            <Stat label="Warteliste unbestätigt" value={o.site.waitlistUnconfirmed} />
          </div>
          <div className="flex flex-wrap gap-2">
            {settings && <MaintenanceQuickToggle settings={settings} />}
            <Link href={`${base}?tab=settings`} className="inline-flex h-9 items-center rounded-lg border border-line-strong px-3.5 text-sm text-gray-200 hover:bg-white/5">
              Einstellungen
            </Link>
          </div>
        </div>
      </Card>
      {o.system.pterodactylMode === 'mock' && (
        <Alert tone="warning" title="Mock-Modus aktiv">
          Das Panel wird nur simuliert – es werden keine echten Server angelegt. Für den Betrieb PTERODACTYL_MODE=live setzen.
        </Alert>
      )}
      {!o.system.smtpConfigured && (
        <Alert tone="warning" title="Kein Mailserver eingestellt">
          SMTP_HOST ist leer – E-Mails werden nur ins Log geschrieben.
        </Alert>
      )}
      {o.jobs.some((j) => j.stale) && (
        <Alert tone="error" title="Worker läuft vermutlich nicht">
          Einige Jobs sind länger nicht gelaufen. Prüfen: docker compose ps · docker compose logs worker
        </Alert>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Nutzer">
          <div className="grid grid-cols-3 gap-4">
            <Stat label="gesamt" value={o.users.total} />
            <Stat label="bestätigt" value={o.users.verified} />
            <Stat label="neu (7 Tage)" value={o.users.newLast7Days} />
            <Stat label="gesperrt" value={o.users.locked} tone={o.users.locked ? 'amber' : undefined} />
            <Stat label={o.system.adminEmailsConfigured ? `Admins (+${o.system.adminEmailsConfigured} per .env)` : 'Admins'} value={o.users.admins} />
          </div>
        </Card>
        <Card title="Server">
          <div className="grid grid-cols-3 gap-4">
            <Stat label="aktiv" value={s.active ?? 0} />
            <Stat label="gerade online" value={o.servers.online} />
            <Stat label="in Fair-Use-Pause" value={o.servers.paused} />
            <Stat label="suspendiert" value={s.suspended ?? 0} />
            <Stat label="wartend" value={s.pending ?? 0} />
            <Stat label="Einrichtung fehlgeschlagen" value={s.provisioning_failed ?? 0} tone={s.provisioning_failed ? 'red' : undefined} />
          </div>
        </Card>
        <Card title="Pakete">
          <ul className="space-y-2 text-sm">
            {o.plans.map((p) => {
              const used = p.count + p.reserved;
              return (
                <li key={p.id} className="flex justify-between gap-4">
                  <span className="text-gray-200">{p.name}</span>
                  <span className="text-right text-muted">
                    {used}
                    {p.capacity !== null ? ` / ${p.capacity} belegt · ${Math.max(0, p.capacity - used)} frei` : ' belegt (unbegrenzt)'}
                    {p.reserved > 0 && <span className="block text-[11px] text-subtle">davon {p.reserved} außerhalb der Website</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="E-Mails">
          <div className="grid grid-cols-2 gap-4">
            <Stat label="in Warteschlange" value={o.mails.pending} tone={o.mails.pending > 5 ? 'amber' : undefined} />
            <Stat label="fehlgeschlagen" value={o.mails.failed} tone={o.mails.failed ? 'red' : undefined} />
          </div>
          {o.mails.lastError && <p className="mt-3 text-[13px] break-words text-red-300">Letzter Fehler: {o.mails.lastError}</p>}
        </Card>
      </div>

      <Card title="System">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Pterodactyl</dt>
            <dd className={o.system.pterodactylMode === 'mock' ? 'text-amber-300' : 'text-emerald-300'}>{o.system.pterodactylMode === 'mock' ? 'Mock (simuliert)' : 'Live'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Panel</dt>
            <dd>
              <a href={`${o.system.panelUrl}/admin`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300">
                {o.system.panelUrl.replace(/^https?:\/\//, '')}/admin <ArrowUpRight className="size-3.5" aria-hidden />
              </a>
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">SMTP</dt>
            <dd className="text-right text-gray-200">{o.system.smtpTarget ?? '–'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Absender</dt>
            <dd className="text-right text-gray-200">{o.system.mailFrom}</dd>
          </div>
        </dl>
      </Card>

      <Card title="Automatische Jobs">
        <Table head={['Job', 'Intervall', 'Letzter Lauf', 'Status', 'Fehler', '']}>
          {o.jobs.map((j) => (
            <tr key={j.name}>
              <td className="px-3 py-2.5 font-mono text-gray-100">{j.name}</td>
              <td className="px-3 py-2.5 text-muted">{j.intervalSeconds >= 60 ? `${Math.round(j.intervalSeconds / 60)} min` : `${j.intervalSeconds} s`}</td>
              <td className="px-3 py-2.5 text-muted">{j.lastStartedAt ? fmt.dateTime(j.lastStartedAt) : '–'}</td>
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot tone={j.stale ? 'red' : j.lastStatus === 'failed' ? 'red' : j.lastStatus === 'success' ? 'green' : 'gray'} />
                  {j.stale ? 'überfällig' : j.lastStatus === 'success' ? 'ok' : j.lastStatus === 'failed' ? 'Fehler' : j.lastStatus === 'running' ? 'läuft' : '–'}
                </span>
              </td>
              <td className="max-w-[280px] px-3 py-2.5 break-words text-red-300">{j.lastError ?? ''}</td>
              <td className="px-3 py-2.5 text-right">
                <RunJobButton name={j.name} />
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function ServersTab({ list, fmt }: { list: AdminServerDTO[]; fmt: ReturnType<typeof formatters> }) {
  const now = Date.now();
  return (
    <>
      <Table head={['Server', 'Besitzer', 'Status', 'Laufzeit', 'Paket', 'Adresse', 'Aktionen']}>
        {list.map((s) => {
          const st = STATUS_LABEL[s.status] ?? { label: s.status, tone: 'gray' as const };
          const paused = s.pausedUntil && new Date(s.pausedUntil).getTime() > now;
          return (
            <tr key={s.id}>
              <td className="px-3 py-2.5">
                <p className="font-medium text-white">{s.name}</p>
                <p className="font-mono text-[11px] text-subtle">{s.id.slice(0, 8)}</p>
                {s.panelAdminUrl && (
                  <a href={s.panelAdminUrl} target="_blank" rel="noopener" className="mt-1 inline-flex items-center gap-0.5 text-[12px] text-blue-400 hover:text-blue-300">
                    Panel #{s.pteroServerId} <ArrowUpRight className="size-3" aria-hidden />
                  </a>
                )}
              </td>
              <td className="px-3 py-2.5">
                <p className="text-gray-200">{s.ownerEmail}</p>
                <p className="text-[11px] text-subtle uppercase">{s.ownerLocale}</p>
              </td>
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-1.5 text-gray-200">
                  <StatusDot tone={st.tone} /> {st.label}
                </span>
                {s.suspensionReason && <p className="text-[11px] text-subtle">Grund: {s.suspensionReason === 'cycle_expired' ? '30 Tage abgelaufen' : s.suspensionReason === 'admin' ? 'vom Team' : s.suspensionReason}</p>}
                <p className="text-[11px] text-subtle">Power: {s.powerState}</p>
                {paused && (
                  <p className="text-[11px] text-amber-300">
                    Pause bis {fmt.dateTime(s.pausedUntil!)} ({s.pauseReason === 'weekly_offline' ? 'Woche' : '24 h'})
                  </p>
                )}
                {s.provisioningError && <p className="max-w-[240px] text-[11px] break-words text-red-300">{s.provisioningError}</p>}
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap text-muted">
                <p>bis {fmt.date(s.cycleEndsAt)}</p>
                <p className="text-[11px] text-subtle">
                  Zyklus {s.cycleNumber} · {s.reactivationCount}× reaktiviert
                </p>
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap text-muted">
                <p>{s.planId}</p>
                <p className="text-[11px] text-subtle">
                  {s.serverType} {s.version}
                </p>
              </td>
              <td className="px-3 py-2.5 font-mono text-[12px] text-muted">{s.address ?? '–'}</td>
              <td className="px-3 py-2.5">
                <ServerActions server={s} />
              </td>
            </tr>
          );
        })}
        {list.length === 0 && (
          <tr>
            <td colSpan={7} className="px-3 py-8 text-center text-muted">
              Keine Server gefunden.
            </td>
          </tr>
        )}
      </Table>
    </>
  );
}

function LogsTab({ list, fmt }: { list: AdminAuditDTO[]; fmt: ReturnType<typeof formatters> }) {
  return (
    <Table head={['Zeit', 'Von', 'Aktion', 'Nachricht', 'Nutzer', 'IP']}>
      {list.map((a) => (
        <tr key={a.id}>
          <td className="px-3 py-2 whitespace-nowrap text-muted">{fmt.dateTime(a.createdAt)}</td>
          <td className="px-3 py-2">
            <span className={cn('rounded px-1.5 py-0.5 text-[11px]', a.actor === 'admin' ? 'bg-blue-500/15 text-blue-300' : a.actor === 'system' ? 'bg-white/5 text-gray-300' : 'bg-emerald-500/10 text-emerald-300')}>
              {a.actor === 'admin' ? 'Admin' : a.actor === 'system' ? 'System' : 'Nutzer'}
            </span>
          </td>
          <td className="px-3 py-2 font-mono text-[12px] text-gray-300">{a.action}</td>
          <td className="max-w-[420px] px-3 py-2 break-words text-gray-200">{a.message}</td>
          <td className="px-3 py-2 text-muted">{a.userEmail ?? '–'}</td>
          <td className="px-3 py-2 font-mono text-[11px] text-subtle">{a.ip ?? ''}</td>
        </tr>
      ))}
      {list.length === 0 && (
        <tr>
          <td colSpan={6} className="px-3 py-8 text-center text-muted">
            Keine Einträge.
          </td>
        </tr>
      )}
    </Table>
  );
}

function MailsTab({ list, me, o, fmt }: { list: AdminMailDTO[]; me: string; o: AdminOverviewDTO | null; fmt: ReturnType<typeof formatters> }) {
  return (
    <div className="space-y-5">
      <Card title="Versand testen">
        <p className="mb-4 text-sm text-muted">
          Schickt eine Testmail über den eingestellten Mailserver{o?.system.smtpTarget ? ` (${o.system.smtpTarget})` : ''}. Bei Fehlern steht hier die Ursache.
        </p>
        <MailTestForm defaultTo={me} />
      </Card>
      <Card title="Ausstehende und fehlgeschlagene E-Mails">
        <Table head={['Zeit', 'Empfänger', 'Betreff', 'Status', 'Versuche', 'Fehler']}>
          {list.map((m) => (
            <tr key={m.id}>
              <td className="px-3 py-2 whitespace-nowrap text-muted">{fmt.dateTime(m.createdAt)}</td>
              <td className="px-3 py-2 text-gray-200">{m.userEmail}</td>
              <td className="px-3 py-2 text-gray-200">{m.title}</td>
              <td className="px-3 py-2">{m.emailStatus === 'failed' ? <span className="text-red-300">fehlgeschlagen</span> : <span className="text-amber-300">ausstehend</span>}</td>
              <td className="px-3 py-2 text-muted">{m.emailAttempts}</td>
              <td className="max-w-[360px] px-3 py-2 break-words text-red-300">{m.emailLastError ?? ''}</td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-8 text-center text-muted">
                Alles versendet.
              </td>
            </tr>
          )}
        </Table>
      </Card>
    </div>
  );
}

function SettingsTab({ settings, pub }: { settings: SiteSettings; pub: PublicSiteDTO | null }) {
  // Über die Website belegte Plätze je Paket (öffentliche Belegung minus außerhalb belegt)
  const planCounts = Object.fromEntries((pub?.plans ?? []).map((p) => [p.id, Math.max(0, p.used - (settings.plans[p.id]?.reserved ?? 0))]));
  return (
    <div className="space-y-5">
      {pub && (
        <Card title="Aktuell öffentlich angezeigt">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Registrierte Nutzer" value={pub.stats ? pub.stats.users.toLocaleString('de-DE') : '–'} />
            <Stat label="Aktive Server" value={pub.stats ? pub.stats.activeServers.toLocaleString('de-DE') : '–'} />
            <Stat label="Uptime (30 Tage)" value={pub.stats?.uptime != null ? `${pub.stats.uptime.toLocaleString('de-DE')} %` : '–'} />
            <Stat label="Warteliste" value={pub.waitlist.total !== null ? pub.waitlist.total.toLocaleString('de-DE') : 'ausgeblendet'} />
          </dl>
          <ul className="mt-4 space-y-1 text-[13px] text-muted">
            {pub.plans.map((p) => (
              <li key={p.id}>
                {freeHostingConfig.plans.find((x) => x.id === p.id)?.name ?? p.id}:{' '}
                {p.capacity === null ? 'unbegrenzt' : p.available ? `noch ${p.remaining} von ${p.capacity} Plätzen frei` : 'ausgebucht'}
              </li>
            ))}
            {pub.waitlist.epycSlots > 0 && (
              <li>
                AMD EPYC: {pub.waitlist.epycUsed} von {pub.waitlist.epycSlots} Plätzen belegt, {pub.waitlist.epycRemaining} frei
              </li>
            )}
          </ul>
          <p className="mt-3 text-[12px] text-subtle">Werte werden bis zu 10 Sekunden zwischengespeichert.</p>
        </Card>
      )}
      <SettingsForm initial={settings} planCounts={planCounts} />
    </div>
  );
}

function WaitlistTab({
  entries,
  blocks,
  pub,
  settings,
  pager,
  totalEntries,
}: {
  totalEntries: number;
  entries: AdminWaitlistDTO[];
  blocks: AdminWaitlistBlockDTO[];
  pub: PublicSiteDTO | null;
  settings: SiteSettings | null;
  pager: (list: React.ReactNode) => React.ReactNode;
}) {
  const external = settings?.waitlist.externalCount ?? 0;
  return (
    <div className="space-y-5">
      <Card title="Early Access">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat label="Einträge über die Website" value={totalEntries.toLocaleString('de-DE')} />
          <Stat label="Vormerkungen außerhalb" value={external.toLocaleString('de-DE')} />
          <Stat label="öffentlich angezeigt" value={pub?.waitlist.total?.toLocaleString('de-DE') ?? 'ausgeblendet'} />
          <Stat label="Plätze auf AMD EPYC" value={pub ? `${pub.waitlist.epycUsed} / ${pub.waitlist.epycSlots} belegt` : '–'} />
          <Stat label="EPYC noch frei" value={pub?.waitlist.epycRemaining ?? '–'} />
        </div>
        <p className="mt-4 text-[13px] leading-relaxed text-muted">
          Freischalten erstellt den Server sofort, wenn der Nutzer schon einen Panel-Zugang hat – sonst bekommt er eine E-Mail und legt den Zugang unter „Meine
          Server“ fest. Die Hardware (EPYC/Xeon) richtet sich nach dem aktuellen Platz. Die Laufzeit von 30 Tagen beginnt mit der Freischaltung.
        </p>
      </Card>
      {pager(<WaitlistManager entries={entries} blocks={blocks} />)}
      {settings && (
        <Card title="Vormerkungen außerhalb der Website (Anzahl)">
          <p className="mb-4 text-sm leading-relaxed text-muted">
            Für Vormerkungen, die du nur als Zahl hast (z. B. aus dem alten System). „Hinzufügen“ hängt sie als Block hinten an die Warteschlange: Sie belegen echte Plätze
            (auch EPYC-Plätze), wer sich danach über die Website einträgt, kommt dahinter. Beispiel: 23 Anmeldungen + 890 Vormerkungen → der nächste bekommt Platz #914.
            Öffentlich angezeigt: {pub?.waitlist.total?.toLocaleString('de-DE') ?? 'ausgeblendet'}.
          </p>
          <ExternalSpotsForm settings={settings} />
        </Card>
      )}
      <Card title="Personen hinzufügen">
        <p className="mb-4 text-sm leading-relaxed text-muted">
          Für Personen, die sich schon vorher eingetragen haben – z. B. im alten System oder per Discord. Sie bekommen einen echten Platz, erscheinen in der Liste oben, zählen in
          der öffentlichen Zahl mit und werden wie alle anderen freigeschaltet. Fehlende Konten werden angelegt; die Personen melden sich später per E-Mail-Link an.
        </p>
        <WaitlistAddForm />
      </Card>
    </div>
  );
}

function StatusTab({ settings, incidents, live }: { settings: SiteSettings; incidents: StatusIncidentDTO[]; live: StatusDTO | null }) {
  const labels = getDict('de').status.states;
  const components = STATUS_COMPONENTS.map((c) => {
    const l = live?.components.find((x) => x.id === c.id);
    return { ...c, live: l ? labels[l.status].label : null };
  });
  return (
    <div className="space-y-5">
      <Card title="Status je Dienst">
        <p className="mb-4 text-sm leading-relaxed text-muted">
          „Automatisch“ nutzt die eigenen Prüfungen. Aktive Meldungen ersetzen die Prüfung für die betroffenen Dienste, der Wartungsmodus zeigt „Wartung“ für FreeHosting
          und Website. Ein fester Status hat immer Vorrang und gilt, bis du ihn wieder auf „Automatisch“ stellst.
        </p>
        <StatusOverrides settings={settings} components={components} />
      </Card>
      <Card title="Neue Meldung">
        <IncidentForm components={STATUS_COMPONENTS} />
      </Card>
      <Card title="Meldungen">
        <IncidentList incidents={incidents} components={STATUS_COMPONENTS} />
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- Seite */

export default async function AdminPage({ params, searchParams }: Props) {
  const lang = await resolveLang(params);
  const query = await searchParams;
  // Nicht angemeldet oder kein Admin → 404 (verrät nicht, dass es hier etwas gibt)
  const me = await apiServer<{ user: UserDTO }>('/auth/me', lang);
  if (!me.ok && (me.status === 401 || me.status === 403)) notFound();
  if (!me.ok) throw new Error('API nicht erreichbar');
  const user = me.data.user;
  if (user.role !== 'admin') notFound();
  const base = adminPath();

  const tab: Tab = TABS.some((t) => t.id === query.tab) ? (query.tab as Tab) : 'overview';
  const fmt = formatters('de');
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const filters = { ...(query.q ? { q: query.q } : {}), ...(query.status ? { status: query.status } : {}) };
  const suffix = `?${new URLSearchParams({ ...filters, page: String(page) }).toString()}`;
  /** Link zu einer Seite des aktuellen Tabs (Suche und Filter bleiben erhalten) */
  const pageHref = (p: number) => `${base}?${new URLSearchParams({ tab, ...filters, ...(p > 1 ? { page: String(p) } : {}) }).toString()}`;
  const paged = (info: PageInfo, label: string, list: React.ReactNode) => (
    <>
      <Pager info={info} href={pageHref} label={label} />
      {list}
      <Pager info={info} href={pageHref} label={label} />
    </>
  );

  const overview = tab === 'overview' || tab === 'mails' ? await apiServer<{ overview: AdminOverviewDTO }>('/admin/overview', lang) : null;
  if (overview && !overview.ok && overview.status === 404) notFound();

  let content: React.ReactNode = null;
  let failed = overview ? !overview.ok : false;
  const needsSettings = tab === 'overview' || tab === 'settings' || tab === 'status' || tab === 'waitlist';
  const settingsRes = needsSettings ? await apiServer<{ settings: SiteSettings }>('/admin/settings', lang) : null;
  const settings = settingsRes?.ok ? settingsRes.data.settings : null;

  if (tab === 'overview' && overview?.ok) content = <OverviewTab o={overview.data.overview} settings={settings} fmt={fmt} />;
  if (tab === 'settings') {
    const pub = await apiServer<{ site: PublicSiteDTO }>('/site', lang);
    failed = !settings;
    if (settings) content = <SettingsTab settings={settings} pub={pub.ok ? pub.data.site : null} />;
  }
  if (tab === 'waitlist') {
    const [res, pub] = await Promise.all([
      apiServer<{ entries: AdminWaitlistDTO[]; blocks?: AdminWaitlistBlockDTO[] } & PageInfo>(`/admin/waitlist?page=${page}`, lang),
      apiServer<{ site: PublicSiteDTO }>('/site', lang),
    ]);
    failed = !res.ok;
    if (res.ok)
      content = (
        <WaitlistTab
          entries={res.data.entries}
          blocks={res.data.blocks ?? []}
          pub={pub.ok ? pub.data.site : null}
          settings={settings}
          totalEntries={res.data.total}
          pager={(list) => paged(res.data, 'Einträgen (über die Website)', list)}
        />
      );
  }
  if (tab === 'status') {
    const [inc, live] = await Promise.all([apiServer<{ incidents: StatusIncidentDTO[] }>('/admin/incidents', lang), apiServer<{ status: StatusDTO }>('/status', lang)]);
    failed = !inc.ok || !settings;
    if (inc.ok && settings) content = <StatusTab settings={settings} incidents={inc.data.incidents} live={live.ok ? live.data.status : null} />;
  }
  if (tab === 'servers') {
    const res = await apiServer<{ servers: AdminServerDTO[] } & PageInfo>(`/admin/servers${suffix}`, lang);
    failed = !res.ok;
    if (res.ok) content = paged(res.data, 'Servern', <ServersTab list={res.data.servers} fmt={fmt} />);
  }
  if (tab === 'users') {
    const res = await apiServer<{ users: AdminUserDTO[]; deletable: number } & PageInfo>(`/admin/users${suffix}`, lang);
    failed = !res.ok;
    if (res.ok)
      content = paged(
        res.data,
        'Nutzern',
        <UsersTable list={res.data.users} meId={user.id} filter={filters} deletable={res.data.deletable} filterLabels={USER_FILTERS} />,
      );
  }
  if (tab === 'logs') {
    const res = await apiServer<{ entries: AdminAuditDTO[] } & PageInfo>(`/admin/audit${suffix}`, lang);
    failed = !res.ok;
    if (res.ok) content = paged(res.data, 'Einträgen', <LogsTab list={res.data.entries} fmt={fmt} />);
  }
  if (tab === 'mails') {
    const res = await apiServer<{ mails: AdminMailDTO[] }>('/admin/mails', lang);
    failed = !res.ok;
    if (res.ok) content = <MailsTab list={res.data.mails} me={user.email} o={overview?.ok ? overview.data.overview : null} fmt={fmt} />;
  }

  return (
    <div className="container-page py-10 sm:py-14" lang="de">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="label">Intern</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em] text-white">Admin</h1>
        </div>
        <div className="flex gap-4 text-sm">
          <Link href={localePath('de', 'home')} className="text-muted hover:text-white">
            Website
          </Link>
          <Link href={localePath('de', 'myServers')} className="text-muted hover:text-white">
            Meine Server
          </Link>
        </div>
      </div>

      <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Admin-Bereiche">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`${base}?tab=${t.id}`}
            className={cn(
              '-mb-px border-b-2 px-3.5 py-2.5 text-sm whitespace-nowrap transition-colors',
              tab === t.id ? 'border-blue-500 text-white' : 'border-transparent text-muted hover:text-white',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {(tab === 'servers' || tab === 'users' || tab === 'logs') && <SearchBar tab={tab} q={query.q} status={query.status} />}
        {failed ? <Alert tone="error">Die Daten konnten nicht geladen werden. Läuft die API?</Alert> : content}
      </div>
    </div>
  );
}
