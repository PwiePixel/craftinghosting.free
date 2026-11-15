import type { Metadata } from 'next';
import { ArrowUpRight, Plus } from 'lucide-react';
import { localePath, productKinds, type Locale, type ServerDTO } from '@chfree/shared';
import { AccountActions, AutoRefresh, CopyText, DeleteServer, PanelSetupCard, ReactivateButton } from '@/components/my/client-bits';
import { ButtonLink } from '@/components/ui/button';
import { Alert, StatusDot } from '@/components/ui/primitives';
import { formatters, getDict, resolveLang, type Dictionary } from '@/i18n';
import { apiServer, requireUser } from '@/lib/api/server';
import { pageMetadata } from '@/lib/seo';
import { getSite } from '@/lib/site-settings';
import { siteTexts } from '@/lib/site-texts';

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  return pageMetadata(lang, 'myServers', { title: getDict(lang).my.metaTitle, noIndex: true });
}

export const dynamic = 'force-dynamic';

function statusInfo(s: ServerDTO, t: Dictionary['my']['status']): { tone: 'green' | 'amber' | 'red' | 'blue' | 'gray'; label: string } {
  switch (s.status) {
    case 'waitlist':
      return { tone: 'blue', label: t.waitlist };
    case 'pending':
      return { tone: 'gray', label: t.pending };
    case 'provisioning':
    case 'provisioning_failed':
      return { tone: 'blue', label: t.provisioning };
    case 'expiring':
      return { tone: 'amber', label: t.expiring };
    case 'suspended':
      return { tone: 'red', label: s.suspensionReason === 'cycle_expired' ? t.expired : t.locked };
    default:
      if (s.powerState === 'installing') return { tone: 'blue', label: t.installing };
      if (s.fairUse.isPaused) return { tone: 'amber', label: t.paused };
      if (s.fairUse.online) return { tone: 'green', label: t.online };
      return { tone: 'gray', label: t.offline };
  }
}

function ServerCard({ s, lang, twoTiers, cpus }: { s: ServerDTO; lang: Locale; twoTiers: boolean; cpus: string }) {
  const d = getDict(lang);
  const t = d.my;
  const fmt = formatters(lang);
  const st = statusInfo(s, t.status);
  const f = s.fairUse;
  const daysLeft = s.cycle.secondsRemaining < 2 * 86400 ? fmt.duration(s.cycle.secondsRemaining) : t.days(s.cycle.daysRemaining);
  return (
    <article className="surface overflow-hidden">
      <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="truncate text-lg font-semibold text-white">{s.name}</h2>
            <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
              <StatusDot tone={st.tone} /> {st.label}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-subtle">
            {d.start.products[s.kind].name} · {s.planName} · {s.serverTypeName}
            {s.kind === 'minecraft' && <> {s.version === 'latest' ? d.common.latestShort : s.version}</>} · {fmt.mb(s.limits.memoryMb)} RAM
          </p>
          {s.address && (
            <div className="mt-2">
              <CopyText value={s.address} />
            </div>
          )}
        </div>
        {s.panelUrl && s.status !== 'suspended' && (
          <ButtonLink href={s.panelUrl} external className="shrink-0">
            {d.common.openPanel} <ArrowUpRight aria-hidden />
          </ButtonLink>
        )}
      </div>

      <div className="border-t border-line bg-background/40 px-6 py-5">
        {s.status === 'suspended' && s.suspensionReason === 'cycle_expired' ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-md text-sm leading-relaxed text-muted">
              {t.expiredText}
              {s.reactivation.reason === 'cooldown' && s.reactivation.until && (
                <>
                  {' '}
                  {t.restBefore}
                  <span className="text-gray-100">{fmt.dateTime(s.reactivation.until)}</span>
                  {t.restAfter}
                </>
              )}
              {s.deleteAt && <span className="mt-2 block text-amber-300">{t.deleteAt(fmt.dateTime(s.deleteAt))}</span>}
            </p>
            <ReactivateButton server={s} />
          </div>
        ) : s.status === 'waitlist' ? (
          <div className="space-y-3">
            <p className="max-w-xl text-sm leading-relaxed text-muted">{d.early.myText}</p>
            {s.waitlist && (
              <>
                <dl className="flex flex-wrap gap-x-10 gap-y-2 text-sm">
                  <div>
                    <dt className="text-[13px] text-subtle">{d.early.positionLabel}</dt>
                    <dd className="mt-0.5 text-lg font-semibold text-white">#{s.waitlist.position}</dd>
                  </div>
                  <div>
                    <dt className="text-[13px] text-subtle">{d.early.hardwareLabel}</dt>
                    <dd className="mt-0.5 text-lg font-semibold text-white">{twoTiers ? d.early.tiers[s.waitlist.tier] : cpus}</dd>
                  </div>
                </dl>
                {twoTiers && <p className="text-[13px] leading-relaxed text-subtle">{d.early.tierNote[s.waitlist.tier]}</p>}
              </>
            )}
          </div>
        ) : s.status === 'suspended' ? (
          <p className="text-sm text-muted">{t.lockedText}</p>
        ) : s.status === 'pending' ? (
          <p className="text-sm text-muted">{t.pendingText}</p>
        ) : s.status === 'provisioning' || s.status === 'provisioning_failed' || s.status === 'expiring' ? (
          <p className="text-sm text-muted">
            {s.status === 'expiring' ? t.expiringText : t.provisioningText}
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-[13px] text-subtle">{t.runtime}</p>
              <p className="mt-0.5 text-sm text-gray-100">{t.activeUntil(fmt.date(s.cycle.endsAt), daysLeft)}</p>
              <div className="mt-2 h-1 rounded-full bg-white/10">
                <div
                  className={s.cycle.daysRemaining <= 3 ? 'h-1 rounded-full bg-amber-400' : 'h-1 rounded-full bg-blue-500'}
                  style={{ width: `${Math.max(2, s.cycle.remainingRatio * 100)}%` }}
                />
              </div>
            </div>
            <div>
              <p className="text-[13px] text-subtle">{t.fairUse}</p>
              <p className="mt-0.5 text-sm text-gray-100">
                {f.isPaused && f.pausedUntil
                  ? f.pauseReason === 'cpu_overload'
                    ? t.cpuPause(fmt.dateTime(f.pausedUntil))
                    : t.pausedUntil(fmt.dateTime(f.pausedUntil))
                  : !s.fairUseEnabled
                    ? t.alwaysOn
                  : f.online && f.autoStopAt
                    ? t.autoStop(fmt.dateTime(f.autoStopAt))
                    : f.weeklyOfflineFulfilled
                      ? t.weeklyDone
                      : t.weeklyLeft(fmt.duration(f.weeklyOfflineRemainingSeconds, { maxUnits: 1 }))}
              </p>
              <p className="mt-0.5 text-[13px] text-subtle">{s.fairUseEnabled ? t.rulesShort : t.alwaysOnHint}</p>
            </div>
          </div>
        )}
      </div>

      <div className="flex border-t border-line px-6 py-3">
        <DeleteServer server={s} />
      </div>
    </article>
  );
}

export default async function MyServersPage({ params, searchParams }: Props) {
  const lang = await resolveLang(params);
  const d = getDict(lang);
  const t = d.my;
  const query = await searchParams;
  const { user, panelUrl } = await requireUser(lang, 'myServers');
  const [res, settings] = await Promise.all([apiServer<{ servers: ServerDTO[] }>('/servers', lang), getSite()]);
  const servers = res.ok ? res.data.servers : [];
  const hasPending = servers.some((s) => s.status === 'pending');
  const onWaitlist = servers.some((s) => s.status === 'waitlist');
  const transitional = servers.some((s) => ['provisioning', 'provisioning_failed', 'expiring'].includes(s.status) || s.powerState === 'installing');
  const ownedServers = servers.filter((s) => s.status !== 'pending' && s.status !== 'waitlist');
  const owned = ownedServers.length;
  const mode = settings.registration.mode;
  const x = siteTexts(settings, lang);
  // Das Limit gilt je Produkt – ein weiterer Server ist möglich, solange ein Angebot noch nicht ausgeschöpft ist
  const freeKind = productKinds.some(
    (k) =>
      settings.products[k].enabled &&
      settings.products[k].plans.length > 0 &&
      ownedServers.filter((s) => s.kind === k).length < settings.registration.maxServersPerUser,
  );
  const maintenance = settings.maintenance.enabled;
  // Weiteren Server anfordern: offen bis zur Obergrenze, Early Access nur ein Platz pro Person, geschlossen gar nicht
  const canCreate =
    !maintenance &&
    !hasPending &&
    !onWaitlist &&
    (mode === 'open' ? freeKind : mode === 'preregistration' ? owned === 0 : false);

  return (
    <div className="container-page py-12 sm:py-16">
      <AutoRefresh active={transitional} />
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.02em] text-white">{t.title}</h1>
            <p className="mt-2 text-sm text-muted">
              {user.email}
              {user.panelUsername && (
                <span className="text-subtle">
                  {' '}
                  · {t.panelUser} {user.panelUsername}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canCreate && servers.length > 0 && (
              <ButtonLink href={localePath(lang, 'start')} variant="secondary" size="sm">
                <Plus aria-hidden /> {mode === 'preregistration' ? d.early.cta : d.common.createServer}
              </ButtonLink>
            )}
          </div>
        </div>

        <div className="mt-8 space-y-5">
          {maintenance && (
            <Alert tone="info" title={t.maintenanceTitle}>
              {t.maintenanceText}
            </Alert>
          )}
          {query.neu === '1' && (
            <Alert tone="success" title={t.createdTitle}>
              {t.createdText}
            </Alert>
          )}
          {query.neu === 'waitlist' && (
            <Alert tone="success" title={d.early.createdTitle}>
              {d.early.createdText}
            </Alert>
          )}
          {!res.ok && <Alert tone="error">{t.loadError}</Alert>}
          {!user.panelLinked && hasPending && <PanelSetupCard email={user.email} />}

          {servers.map((s) => (
            <ServerCard key={s.id} s={s} lang={lang} twoTiers={x.twoTiers} cpus={x.cpus} />
          ))}

          {res.ok && servers.length === 0 && (
            <div className="surface p-10 text-center">
              <h2 className="text-lg font-semibold text-white">{t.emptyTitle}</h2>
              <p className="mx-auto mt-2 max-w-sm text-muted">{mode === 'closed' ? d.closed.text : mode === 'preregistration' ? d.early.startIntro : t.emptyText}</p>
              {canCreate && (
                <ButtonLink href={localePath(lang, 'start')} className="mt-6">
                  {mode === 'preregistration' ? d.early.cta : d.common.createServer}
                </ButtonLink>
              )}
            </div>
          )}
        </div>

        <div className="mt-10 rounded-xl border border-line p-6">
          <p className="text-sm font-medium text-white">{t.helpTitle}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">{t.helpText}</p>
          <a href={panelUrl} target="_blank" rel="noopener" className="mt-3 inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300">
            {panelUrl.replace(/^https?:\/\//, '')} <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        </div>

        <div className="mt-10">
          <AccountActions email={user.email} />
        </div>
      </div>
    </div>
  );
}
