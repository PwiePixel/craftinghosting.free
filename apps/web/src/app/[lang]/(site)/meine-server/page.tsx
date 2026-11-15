import type { Metadata } from 'next';
import { ArrowUpRight, FlaskConical, Plus } from 'lucide-react';
import { kindExhausted, localePath, productKinds, type DiscordMeDTO, type Locale, type SecurityDTO, type ServerDTO } from '@chfree/shared';
import { SecurityCard } from '@/components/my/security-card';
import { DiscordIcon } from '@/components/discord/discord-note';
import { AccountActions, AutoRefresh, CopyText, DeleteServer, DiscordRecheck, DiscordUnlink, PanelSetupCard, ReactivateButton } from '@/components/my/client-bits';
import { ButtonLink, buttonClasses } from '@/components/ui/button';
import { Alert, StatusDot } from '@/components/ui/primitives';
import { formatters, getDict, resolveLang, type Dictionary } from '@/i18n';
import { apiServer, requireUser } from '@/lib/api/server';
import { pageMetadata } from '@/lib/seo';
import { getSite } from '@/lib/site-settings';
import { siteTexts } from '@/lib/site-texts';

/** Discord: verbinden, Mitgliedschaft prüfen, Verknüpfung lösen */
function DiscordCard({ me, lang, inviteUrl, note, waiting }: { me: DiscordMeDTO; lang: Locale; inviteUrl: string | null; note: string; waiting: boolean }) {
  const t = getDict(lang).discord;
  const connectHref = `/api/v1/discord/connect?lang=${lang}`;
  const attention = me.blocked !== null;
  const title = !me.linked ? (me.required ? t.requiredTitle : t.cardTitle) : me.blocked === 'not_member' ? t.notMemberTitle : t.connectedAs(me.linked.username);
  const text = !me.linked
    ? me.required
      ? note || t.requiredText
      : t.optionalText
    : me.blocked === 'not_member'
      ? t.notMemberText
      : me.blocked === 'unavailable'
        ? t.unavailableText
        : t.connectedText;
  return (
    <div className={`surface p-5 ${attention ? 'border-[#5865f2]/50' : ''}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3.5">
          <DiscordIcon className="mt-0.5 size-5 shrink-0 text-[#8b93ff]" />
          <div>
            <p className="text-[15px] font-semibold text-white">{title}</p>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">{text}</p>
            {waiting && attention && <p className="mt-2 text-sm text-amber-300">{t.pendingBlocked}</p>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!me.linked ? (
            // Normaler Link: Die API leitet zu Discord weiter
            <a href={connectHref} className={buttonClasses('primary', 'sm')}>
              {t.connect}
            </a>
          ) : me.blocked ? (
            <>
              {me.blocked === 'not_member' && inviteUrl && (
                <a href={inviteUrl} target="_blank" rel="noopener" className={buttonClasses('primary', 'sm')}>
                  {t.join} <ArrowUpRight aria-hidden />
                </a>
              )}
              <DiscordRecheck />
            </>
          ) : (
            <DiscordUnlink />
          )}
        </div>
      </div>
    </div>
  );
}

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
      return { tone: 'red', label: s.suspensionReason !== 'cycle_expired' ? t.locked : s.cycle.unlimited ? t.released : t.expired };
    default:
      if (s.powerState === 'installing') return { tone: 'blue', label: t.installing };
      if (s.fairUse.isPaused) return { tone: 'amber', label: t.paused };
      if (s.fairUse.online) return { tone: 'green', label: t.online };
      return { tone: 'gray', label: t.offline };
  }
}

function ServerCard({ s, lang, twoTiers, cpus, waitingForDiscord }: { s: ServerDTO; lang: Locale; twoTiers: boolean; cpus: string; waitingForDiscord: boolean }) {
  const d = getDict(lang);
  const t = d.my;
  const fmt = formatters(lang);
  // Panel-Zugang ist da, aber die Discord-Mitgliedschaft fehlt noch
  const discordWait = waitingForDiscord && s.status === 'pending';
  const st = discordWait ? { tone: 'amber' as const, label: d.discord.pendingStatus } : statusInfo(s, t.status);
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
              {s.cycle.unlimited ? t.releasedText : t.expiredText}
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
          <p className="text-sm text-muted">{discordWait ? d.discord.pendingBlocked : t.pendingText}</p>
        ) : s.status === 'provisioning' || s.status === 'provisioning_failed' || s.status === 'expiring' ? (
          <p className="text-sm text-muted">
            {s.status === 'expiring' ? t.expiringText : t.provisioningText}
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-[13px] text-subtle">{t.runtime}</p>
              {s.cycle.unlimited ? (
                <>
                  {/* Discord-Bots: kein 30-Tage-Zyklus, kein Ruhetag */}
                  <p className="mt-0.5 text-sm text-gray-100">{t.noEnd}</p>
                  <p className="mt-0.5 text-[13px] text-subtle">{t.noEndHint}</p>
                </>
              ) : (
                <>
                  <p className="mt-0.5 text-sm text-gray-100">{t.activeUntil(fmt.date(s.cycle.endsAt), daysLeft)}</p>
                  <div className="mt-2 h-1 rounded-full bg-white/10">
                    <div
                      className={s.cycle.daysRemaining <= 3 ? 'h-1 rounded-full bg-amber-400' : 'h-1 rounded-full bg-blue-500'}
                      style={{ width: `${Math.max(2, s.cycle.remainingRatio * 100)}%` }}
                    />
                  </div>
                </>
              )}
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
  // Discord-Verknüpfung nur abfragen, wenn die Anbindung eingerichtet ist
  const discordRes = settings.discord.available ? await apiServer<{ discord: DiscordMeDTO }>('/discord/me', lang) : null;
  const discordMe = discordRes?.ok ? discordRes.data.discord : null;
  const discordResult = query.discord ? d.discord.results[query.discord] : undefined;
  const securityRes = await apiServer<{ security: SecurityDTO }>('/account/security', lang);
  const security = securityRes.ok ? securityRes.data.security : null;
  const servers = res.ok ? res.data.servers : [];
  const hasPending = servers.some((s) => s.status === 'pending');
  const onWaitlist = servers.some((s) => s.status === 'waitlist');
  const transitional = servers.some((s) => ['provisioning', 'provisioning_failed', 'expiring'].includes(s.status) || s.powerState === 'installing');
  const ownedServers = servers.filter((s) => s.status !== 'pending' && s.status !== 'waitlist');
  const owned = ownedServers.length;
  const mode = settings.registration.mode;
  const x = siteTexts(settings, lang);
  // Ein weiterer Server ist möglich, solange ein Angebot noch nicht ausgeschöpft ist (Grenzen je Angebot, zusammen und je Paket)
  const freeKind = productKinds.some(
    (k) =>
      settings.products[k].enabled &&
      settings.products[k].plans.length > 0 &&
      !kindExhausted(
        settings.registration.limits,
        ownedServers.map((s) => ({ kind: s.kind, planId: s.planId })),
        k,
        settings.products[k].plans.map((p) => p.id),
      ),
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
          {user.beta && settings.beta.url && !settings.beta.instance && (
            <div className="surface flex flex-col gap-4 border-blue-500/40 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="flex items-center gap-2 text-[15px] font-semibold text-white">
                  <FlaskConical className="size-4 text-blue-400" aria-hidden /> {d.beta.cardTitle}
                </p>
                <p className="mt-1 text-sm text-muted">{d.beta.cardText}</p>
              </div>
              <ButtonLink href={localePath(lang, 'beta')} variant="secondary" size="sm" className="shrink-0">
                {d.beta.cardButton}
              </ButtonLink>
            </div>
          )}
          {discordResult && (
            <Alert tone={discordResult.ok ? 'success' : 'warning'} title={discordResult.title}>
              {discordResult.text}
            </Alert>
          )}
          {discordMe?.available && !maintenance && (
            <DiscordCard
              me={discordMe}
              lang={lang}
              inviteUrl={settings.discord.inviteUrl}
              note={settings.discord.note[lang] || settings.discord.note[lang === 'de' ? 'en' : 'de']}
              waiting={hasPending && user.panelLinked}
            />
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
            <ServerCard key={s.id} s={s} lang={lang} twoTiers={x.twoTiers} cpus={x.cpus} waitingForDiscord={user.panelLinked && !!discordMe?.blocked} />
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

        <div className="mt-10 space-y-4">
          {security && <SecurityCard security={security} />}
          <AccountActions email={user.email} />
        </div>
      </div>
    </div>
  );
}
