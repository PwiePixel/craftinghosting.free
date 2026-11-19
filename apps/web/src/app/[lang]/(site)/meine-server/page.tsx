import { DiscordCard } from '@/components/my/discord-card';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, Bot, FlaskConical, Pickaxe, Plus, ShieldAlert, SquareTerminal } from 'lucide-react';
import { TileUsage } from '@/components/my/server-tile';
import { kindExhausted, localePath, productKinds, serverPagePath, type BonusSlot, type DiscordMeDTO, type Locale, type ServerDTO, type WarningStatusDTO } from '@chfree/shared';
import { DiscordIcon } from '@/components/discord/discord-note';
import { AutoRefresh, CopyText, DeleteServer, PanelSetupCard, ReactivateButton } from '@/components/my/client-bits';
import { ButtonLink, buttonClasses } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
      return { tone: 'red', label: s.suspensionReason === 'warning' ? t.lockedWarning : s.suspensionReason === 'ban' ? t.lockedBan : s.suspensionReason !== 'cycle_expired' ? t.locked : s.cycle.unlimited ? t.released : t.expired };
    default:
      if (s.powerState === 'installing') return { tone: 'blue', label: t.installing };
      if (s.fairUse.isPaused) return { tone: 'amber', label: t.paused };
      if (s.fairUse.online) return { tone: 'green', label: t.online };
      return { tone: 'gray', label: t.offline };
  }
}

/**
 * Kopfbereich einer Server-Kachel: eigener Farbverlauf je Angebot mit feinem Raster (Minecraft: Blockraster in
 * Grün/Türkis, Discord-Bot: Violett), Symbol und Status als Pille (Punkt + Text – nie nur Farbe).
 */
function ServerBanner({ kind, tone, label }: { kind: ServerDTO['kind']; tone: 'green' | 'amber' | 'red' | 'blue' | 'gray'; label: string }) {
  const bot = kind === 'discord';
  const pill = {
    green: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100',
    amber: 'border-amber-400/40 bg-amber-500/15 text-amber-100',
    red: 'border-red-400/40 bg-red-500/15 text-red-100',
    blue: 'border-blue-400/40 bg-blue-500/15 text-blue-100',
    gray: 'border-white/15 bg-white/5 text-gray-200',
  }[tone];
  return (
    <div
      className="relative h-20"
      style={{
        backgroundImage: bot
          ? 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(120deg, #2b2f7a 0%, #4b3fb0 55%, #1a1f4d 100%)'
          : 'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(120deg, #0f4d3a 0%, #1f7a4f 50%, #0e3b4a 100%)',
        backgroundSize: '16px 16px, 16px 16px, 100% 100%',
      }}
    >
      <span className={cn('absolute top-3.5 right-4 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium backdrop-blur-sm', pill)}>
        <StatusDot tone={tone} /> {label}
      </span>
      <span className="absolute -bottom-6 left-6 flex size-12 items-center justify-center rounded-xl border border-line-strong bg-surface text-white shadow-lg">
        {bot ? <Bot className="size-6 text-[#9da6ff]" aria-hidden /> : <Pickaxe className="size-6 text-emerald-300" aria-hidden />}
      </span>
    </div>
  );
}

function ServerCard({ s, lang, twoTiers, cpus, waitingForDiscord, discordUrl }: { s: ServerDTO; lang: Locale; twoTiers: boolean; cpus: string; waitingForDiscord: boolean; discordUrl: string | null }) {
  const d = getDict(lang);
  const t = d.my;
  const fmt = formatters(lang);
  // Panel-Zugang ist da, aber die Discord-Mitgliedschaft fehlt noch
  const discordWait = waitingForDiscord && s.status === 'pending';
  const st = discordWait ? { tone: 'amber' as const, label: d.discord.pendingStatus } : statusInfo(s, t.status);
  const f = s.fairUse;
  const daysLeft = s.cycle.secondsRemaining < 2 * 86400 ? fmt.duration(s.cycle.secondsRemaining) : t.days(s.cycle.daysRemaining);
  // Verwalten auf der Website (Konsole, Start/Stopp, Ports), sobald der Server im Panel angelegt ist
  const manageable = (s.status === 'active' || s.status === 'expiring') && !!s.panelUrl;
  return (
    <article className={cn('surface overflow-hidden', s.abuse && 'border-red-400/60 ring-1 ring-red-400/30')}>
      {s.abuse && (
        <div className="border-b border-red-400/30 bg-red-400/[0.1] px-6 py-4" role="alert">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-red-100">
            <span className="rounded bg-red-500 px-1.5 py-0.5 text-[11px] tracking-[0.08em] text-white uppercase">{t.abuseBadge}</span>
            {s.abuse.reason[lang]}
          </p>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-red-100/90">{t.abuseText(fmt.date(s.abuse.at))}</p>
          <p className="mt-1.5 text-[13px] text-red-100/80">{s.abuse.source === 'manual' ? t.abuseSourceManual : t.abuseSourceSystem}</p>
          {discordUrl && (
            <a href={discordUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses('danger', 'sm', 'mt-3 border-red-300/50 text-red-100')}>
              <DiscordIcon className="size-4" /> {t.abuseTicket}
            </a>
          )}
        </div>
      )}
      {(s.upgrade || s.moving) && (
        <div className="border-b border-emerald-400/25 bg-emerald-400/[0.07] px-6 py-3.5">
          {s.upgrade && (
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-emerald-100">
              <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[11px] tracking-[0.08em] text-white uppercase">{t.upgradeBadge}</span>
              {t.upgradeText(fmt.date(s.upgrade.at), s.planName)}
            </p>
          )}
          {s.upgrade?.note && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-emerald-100/85">{t.upgradeNote(s.upgrade.note)}</p>}
          {s.moving && <p className={cn('max-w-2xl text-sm leading-relaxed text-amber-200', s.upgrade && 'mt-1.5')}>{t.movingText}</p>}
        </div>
      )}
      <ServerBanner kind={s.kind} tone={st.tone} label={st.label} />
      <div className="px-6 pt-9 pb-5">
        <h2 className="truncate text-lg font-semibold text-white">
          {manageable ? (
            <Link href={serverPagePath(lang, s.id)} className="hover:text-blue-300">
              {s.name}
            </Link>
          ) : (
            s.name
          )}
        </h2>
        <p className="mt-1 text-[13px] text-subtle">
          {s.serverTypeName}
          {s.kind === 'minecraft' && <> {s.version === 'latest' ? d.common.latestShort : s.version}</>} · {s.planName}
        </p>
        {s.address && (
          <div className="mt-2">
            <CopyText value={s.address} />
          </div>
        )}
        {s.status === 'active' && s.panelUrl && (
          <div className="mt-4">
            <TileUsage id={s.id} limits={s.limits} />
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          {manageable && (
            <ButtonLink href={serverPagePath(lang, s.id)} className="flex-1">
              <SquareTerminal aria-hidden /> {d.manage.manage}
            </ButtonLink>
          )}
          {s.panelUrl && s.status !== 'suspended' && (
            <ButtonLink href={s.panelUrl} external variant={manageable ? 'secondary' : 'primary'} className={manageable ? undefined : 'flex-1'}>
              {d.common.openPanel} <ArrowUpRight aria-hidden />
            </ButtonLink>
          )}
        </div>
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
          <p className="text-sm text-muted">{s.suspensionReason === 'warning' ? t.lockedTextWarning : s.suspensionReason === 'ban' ? t.lockedTextBan : t.lockedText}</p>
        ) : s.status === 'pending' ? (
          <div>
            <p className="text-sm text-muted">{discordWait ? d.discord.pendingBlocked : t.pendingText}</p>
            {s.pendingDeadlineAt && <p className="mt-1.5 text-sm text-amber-300">{d.discord.pendingDeadline(fmt.dateTime(s.pendingDeadlineAt))}</p>}
          </div>
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

      {s.softwareFailed ? (
        <div className="border-t border-line px-6 py-3">
          <p className={`text-sm ${s.softwareGaveUp ? 'text-red-300' : 'text-amber-200'}`}>{s.softwareGaveUp ? t.softwareGaveUp : t.softwareFailed}</p>
        </div>
      ) : (
        s.status === 'active' &&
        s.powerState === 'installing' && (
          <div className="border-t border-line px-6 py-3">
            <p className="text-sm text-blue-200">{t.softwareInstalling}</p>
          </div>
        )
      )}
      <div className="flex border-t border-line px-6 py-3">
        {s.deleteLocked ? <p className="text-[13px] leading-relaxed text-subtle">{t.deleteLocked}</p> : <DeleteServer server={s} />}
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
  const [res, settings] = await Promise.all([apiServer<{ servers: ServerDTO[]; bonusSlots?: BonusSlot[]; warnings?: WarningStatusDTO }>('/servers', lang), getSite()]);
  // Zusätzliche Slots aus Belohnungen (Einladungen, Server-Boosts)
  const bonusSlots: BonusSlot[] = res.ok ? (res.data.bonusSlots ?? []) : [];
  // Discord-Verknüpfung nur abfragen, wenn die Anbindung eingerichtet ist
  const discordRes = settings.discord.available ? await apiServer<{ discord: DiscordMeDTO }>('/discord/me', lang) : null;
  const discordMe = discordRes?.ok ? discordRes.data.discord : null;
  const discordResult = query.discord ? d.discord.results[query.discord] : undefined;
  const servers = res.ok ? res.data.servers : [];
  // Verwarnungs-System: aktive Verwarnungen und eine laufende Auszeit
  const warnings = res.ok ? (res.data.warnings ?? null) : null;
  const fmt = formatters(lang);
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
        bonusSlots,
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
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.02em] text-white">{t.title}</h1>
            <p className="mt-2 text-sm text-muted">
              <Link href={localePath(lang, 'account')} className="hover:text-white">
                {user.panelUsername ?? user.email}
              </Link>
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
          {warnings && (warnings.active > 0 || warnings.suspendedUntil) && (
            <div className={cn('surface p-5', warnings.suspendedUntil ? 'border-red-400/60 ring-1 ring-red-400/30' : 'border-amber-400/50')}>
              <p className="flex items-center gap-2 text-[15px] font-semibold text-white">
                <ShieldAlert className={cn('size-4', warnings.suspendedUntil ? 'text-red-400' : 'text-amber-300')} aria-hidden /> {t.warningsTitle(warnings.active, warnings.banAt)}
              </p>
              {warnings.suspendedUntil && <p className="mt-2 text-sm font-medium text-red-200">{t.warningsTimeout(fmt.dateTime(warnings.suspendedUntil))}</p>}
              <p className="mt-2 text-sm leading-relaxed text-muted">{t.warningsText(warnings.timeoutFrom, warnings.timeoutHours, warnings.banAt, warnings.expireDays)}</p>
              {warnings.items.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-[13px] text-subtle">
                  {warnings.items.map((w) => (
                    <li key={w.id}>
                      <span className="text-white/90">{w.reason[lang]}</span>
                      {w.serverName && <> · {t.warningServer(w.serverName)}</>} · {t.warningItem(fmt.date(w.at), fmt.date(w.expiresAt))}
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
          {/* Discord hier nur, wenn etwas zu tun ist (sonst unter „Konto“) */}
          {discordMe?.available && !maintenance && ((!discordMe.linked && discordMe.required) || discordMe.blocked !== null) && (
            <DiscordCard
              me={discordMe}
              lang={lang}
              inviteUrl={settings.discord.inviteUrl}
              autoJoin={settings.discord.autoJoin}
              note={settings.discord.note[lang] || settings.discord.note[lang === 'de' ? 'en' : 'de']}
              waiting={hasPending && user.panelLinked}
            />
          )}
          {user.emailUndeliverable && (
            <Alert tone="warning">
              {d.my.email.unreachableText}{' '}
              <Link href={localePath(lang, 'account')} className="underline underline-offset-4">
                {d.account.title}
              </Link>
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

          {servers.length > 0 && (
            <div className="grid items-start gap-5 lg:grid-cols-2">
              {servers.map((s) => (
                <ServerCard key={s.id} s={s} lang={lang} twoTiers={x.twoTiers} cpus={x.cpus} waitingForDiscord={user.panelLinked && !!discordMe?.blocked} discordUrl={settings.discord.inviteUrl ?? settings.brand.discordUrl ?? null} />
              ))}
            </div>
          )}

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

      </div>
    </div>
  );
}
