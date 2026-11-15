import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Check, Cpu, Users } from 'lucide-react';
import { freeHostingConfig, homeSections, intlLocale, localePath, tr, type Locale, type PublicSiteDTO } from '@chfree/shared';
import { FaqList } from '@/components/home/faq-list';
import { PanelPreview } from '@/components/home/panel-preview';
import { ButtonLink } from '@/components/ui/button';
import { Alert, SectionHead } from '@/components/ui/primitives';
import { formatters, getDict, resolveLang } from '@/i18n';
import { alternates } from '@/lib/seo';
import { panelHost, site } from '@/lib/site';
import { getSite } from '@/lib/site-settings';
import { cn } from '@/lib/utils';

const { plans, hardware } = freeHostingConfig;

type Props = { params: Promise<{ lang: string }> };


export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  return { alternates: alternates(lang, 'home') };
}

function JsonLd({ lang }: { lang: Locale }) {
  const t = getDict(lang).home;
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${site.parentUrl}#organization`, name: 'Crafting Hosting', url: site.parentUrl },
      { '@type': 'WebSite', name: site.name, url: site.url, inLanguage: ['de-DE', 'en-GB'], publisher: { '@id': `${site.parentUrl}#organization` } },
      {
        '@type': 'Service',
        name: t.jsonLdService,
        serviceType: 'Minecraft Server Hosting',
        provider: { '@id': `${site.parentUrl}#organization` },
        areaServed: 'EU',
        url: `${site.url}${localePath(lang, 'home')}`,
        offers: plans.map((p) => ({ '@type': 'Offer', name: p.name, price: '0', priceCurrency: 'EUR', url: `${site.url}${localePath(lang, 'start', { plan: p.id })}` })),
      },
    ],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}

/** Registrierte Nutzer, aktive Server, Uptime – Werte und Anzeige im Admin-Bereich einstellbar */
function StatsBand({ stats, lang }: { stats: NonNullable<PublicSiteDTO['stats']>; lang: Locale }) {
  const t = getDict(lang).home.stats;
  const n = (v: number) => v.toLocaleString(intlLocale(lang));
  const items: [string, string][] = [
    [n(stats.users), t.users],
    [n(stats.activeServers), t.servers],
  ];
  if (stats.uptime !== null) items.push([`${stats.uptime.toLocaleString(intlLocale(lang), { maximumFractionDigits: 2 })} %`, t.uptime]);
  return (
    <section aria-label={t.label} className="border-t border-line">
      <dl className={cn('container-page grid divide-line py-2 sm:divide-x', items.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {items.map(([value, label]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 py-4 sm:flex-col sm:items-center sm:justify-center sm:py-6">
            <dt className="order-2 text-[13px] text-subtle sm:mt-1">{label}</dt>
            <dd className="order-1 text-2xl font-semibold tracking-tight text-white tabular-nums sm:text-3xl">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Early Access: Warteliste und freie EPYC-Plätze unter dem Hero */
function WaitlistInfo({ settings, lang }: { settings: PublicSiteDTO; lang: Locale }) {
  const t = getDict(lang).early;
  const n = (v: number) => v.toLocaleString(intlLocale(lang));
  const w = settings.waitlist;
  return (
    <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
      {w.total !== null && w.total > 0 && (
        <span className="inline-flex items-center gap-2 text-gray-200">
          <Users className="size-4 text-blue-400" aria-hidden />
          {t.waitlistCount(n(w.total))}
        </span>
      )}
      {w.epycSlots > 0 && (
        <span className="inline-flex items-center gap-2 text-gray-200">
          <Cpu className="size-4 text-blue-400" aria-hidden />
          {w.epycRemaining > 0 ? t.epycLeft(n(w.epycRemaining), n(w.epycSlots)) : t.epycFull}
        </span>
      )}
    </div>
  );
}

export default async function HomePage({ params }: Props) {
  const lang = await resolveLang(params);
  const t = getDict(lang);
  const h = t.home;
  const f = formatters(lang);
  const startHref = localePath(lang, 'start');
  const settings = await getSite();
  const mode = settings.registration.mode;
  const early = mode === 'preregistration';
  const closed = mode === 'closed';
  const ctaLabel = early ? t.early.cta : t.common.startFree;
  const faqItems = [...(early ? [t.faq.earlyItem] : []), ...t.faq.items(settings.registration.maxServersPerUser)];
  return (
    <>
      <JsonLd lang={lang} />

      {/* ------------------------------------------------------------ Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(37,99,235,0.16),transparent)]" aria-hidden />
        <div className="relative container-page grid grid-cols-1 items-center gap-14 py-14 sm:py-24 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div className="animate-fade-in min-w-0">
            <p className="text-sm text-muted">
              <span className="font-medium text-blue-400">craftinghosting.free</span>
              <span className="mx-2 text-subtle">·</span>
              {early ? (
                <span className="font-medium text-gray-100">{t.early.kicker}</span>
              ) : closed ? (
                <span className="font-medium text-amber-300">{t.closed.kicker}</span>
              ) : (
                h.kicker
              )}
            </p>
            <h1 className="mt-5 text-[2.75rem] leading-[1.04] font-semibold tracking-[-0.04em] text-white sm:text-[4.25rem]">
              {h.heroLine1}
              <span className="block text-blue-400">{h.heroLine2}</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">{early ? t.early.heroText : h.heroText}</p>
            {closed && (
              <Alert tone="warning" className="mt-6 max-w-xl">
                {t.closed.text}
              </Alert>
            )}
            <div className="mt-9 flex flex-wrap items-center gap-3">
              {closed ? (
                <ButtonLink href={localePath(lang, 'myServers')} size="lg">
                  {t.common.myServers}
                </ButtonLink>
              ) : (
                <ButtonLink href={startHref} size="lg">
                  {ctaLabel}
                </ButtonLink>
              )}
              <Link href={`#${homeSections.how[lang]}`} className="inline-flex h-12 items-center gap-1.5 px-3 text-[15px] text-gray-200 hover:text-white">
                {h.howLink} <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            {early && <WaitlistInfo settings={settings} lang={lang} />}
            <dl className="mt-12 grid max-w-lg grid-cols-2 gap-x-8 gap-y-5 border-t border-line pt-8 sm:grid-cols-4">
              {h.facts.map(([v, l]) => (
                <div key={l}>
                  <dt className="sr-only">{l}</dt>
                  <dd className="text-xl font-semibold text-white">{v}</dd>
                  <dd className="mt-0.5 text-[13px] text-subtle">{l}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="animate-fade-in min-w-0 [animation-delay:120ms]">
            <PanelPreview lang={lang} />
          </div>
        </div>
      </section>

      {settings.stats && <StatsBand stats={settings.stats} lang={lang} />}

      {/* ------------------------------------------------------- Hardware */}
      <section className="border-y border-line bg-surface/60">
        <div className="container-page flex flex-wrap items-center justify-center gap-x-8 gap-y-2 py-5 text-[13px] text-muted sm:justify-between">
          {[...hardware.cpus, hardware.storage, hardware.network, h.datacenters].map((item) => (
            <span key={item} className="whitespace-nowrap">
              {item}
            </span>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------- Ablauf */}
      <section id={homeSections.how[lang]} className="scroll-mt-16 py-20 sm:py-28">
        <div className="container-page">
          <SectionHead label={h.howLabel} title={h.howTitle}>
            {h.howText}
          </SectionHead>
          <ol className="mt-12 grid overflow-hidden rounded-xl border border-line md:grid-cols-3">
            {(early ? t.early.steps(panelHost) : h.steps(panelHost)).map(([title, text], i) => (
              <li key={title} className={cn('bg-surface p-7 sm:p-8', i > 0 && 'border-t border-line md:border-t-0 md:border-l')}>
                <span className="font-mono text-sm text-blue-400">0{i + 1}</span>
                <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------------------------------------------------------- Pakete */}
      <section id={homeSections.plans[lang]} className="scroll-mt-16 border-t border-line py-20 sm:py-28">
        <div className="container-page">
          <SectionHead label={h.plansLabel} title={h.plansTitle}>
            {h.plansText}
          </SectionHead>
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {plans.map((p) => {
              const cap = settings.plans.find((x) => x.id === p.id);
              const full = cap ? !cap.available : false;
              return (
              <div key={p.id} className={cn('flex flex-col rounded-xl border bg-surface p-7', p.highlighted ? 'border-blue-500/60' : 'border-line')}>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">{p.name}</h3>
                  {p.highlighted && <span className="rounded-md bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-300">{h.morePower}</span>}
                </div>
                <p className="mt-1 text-sm text-muted">{tr(p.tagline, lang)}</p>
                <p className="mt-6 flex items-baseline gap-1.5">
                  <span className="text-4xl font-semibold tracking-tight text-white">{lang === 'en' ? '€0' : '0 €'}</span>
                  <span className="text-sm text-subtle">{t.common.perMonth}</span>
                </p>
                {cap && cap.capacity !== null && (
                  <p className={cn('mt-2 text-[13px] font-medium', full ? 'text-amber-300' : 'text-emerald-300')}>
                    {full ? h.planFull : h.planLeft(cap.remaining!.toLocaleString(intlLocale(lang)), cap.capacity.toLocaleString(intlLocale(lang)))}
                  </p>
                )}
                <dl className="mt-6 divide-y divide-line border-y border-line text-sm">
                  {[
                    [h.planRows.ram, f.mb(p.memoryMb)],
                    [h.planRows.cpu, h.planRows.cpuValue((p.cpuPercent / 100).toLocaleString(intlLocale(lang)), p.cpuPercent === 100)],
                    [h.planRows.disk, f.mb(p.diskMb)],
                    [h.planRows.backups, h.planRows.backupsValue(p.backups)],
                    [h.planRows.manage, h.planRows.manageValue],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 py-2.5">
                      <dt className="text-muted">{k}</dt>
                      <dd className="text-right text-gray-100">{v}</dd>
                    </div>
                  ))}
                </dl>
                {!closed && !full && (
                  <ButtonLink href={localePath(lang, 'start', { plan: p.id })} variant={p.highlighted ? 'primary' : 'secondary'} className="mt-7 w-full">
                    {early ? t.early.securePlan(p.name) : h.createPlan(p.name)}
                  </ButtonLink>
                )}
                {!closed && full && (
                  <span className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-lg border border-line text-[15px] text-subtle">{h.planFull}</span>
                )}
              </div>
              );
            })}
            <div className="flex flex-col rounded-xl border border-dashed border-line-strong p-7 md:col-span-2 lg:col-span-1">
              <h3 className="text-lg font-semibold text-white">{h.premiumTitle}</h3>
              <p className="mt-1 text-sm text-muted">{h.premiumSub}</p>
              <p className="mt-6 text-[15px] leading-relaxed text-muted">{h.premiumText}</p>
              <ul className="mt-6 space-y-2.5 text-sm text-gray-200">
                {h.premiumPoints.map((point) => (
                  <li key={point} className="flex gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-blue-400" aria-hidden />
                    {point}
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-7">
                <ButtonLink href={site.parentPricingUrl} external variant="secondary" className="w-full">
                  {h.premiumCta} <ArrowUpRight aria-hidden />
                </ButtonLink>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ---------------------------------------------------------- Regeln */}
      <section id={homeSections.rules[lang]} className="scroll-mt-16 border-t border-line py-20 sm:py-28">
        <div className="container-page">
          <SectionHead label={h.rulesLabel} title={h.rulesTitle}>
            {h.rulesText}
          </SectionHead>
          <div className="mt-12 grid gap-10 sm:grid-cols-3 sm:gap-8">
            {h.rules.map(([big, small, text]) => (
              <div key={small} className="border-t border-line-strong pt-6">
                <p className="text-4xl font-semibold tracking-tight text-white">{big}</p>
                <p className="mt-1 text-sm font-medium text-blue-400">{small}</p>
                <p className="mt-3 text-[15px] leading-relaxed text-muted">{text}</p>
              </div>
            ))}
          </div>
          <ul className="mt-12 grid gap-3 text-[15px] text-gray-200 sm:grid-cols-2">
            {h.automation.map((item) => (
              <li key={item} className="flex gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-blue-400" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------- FAQ */}
      <section className="border-t border-line py-20 sm:py-28">
        <div className="container-page grid gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
          <div>
            <p className="label">FAQ</p>
            <h2 className="h2 mt-3">{h.faqTitle}</h2>
            <p className="lead mt-4">
              {h.faqMoreBefore}
              <Link href={localePath(lang, 'faq')} className="text-blue-400 hover:text-blue-300">
                {h.faqMoreAll}
              </Link>
              {h.faqMoreMiddle}
              <a href={site.discordUrl} target="_blank" rel="noopener" className="text-blue-400 hover:text-blue-300">
                Discord
              </a>
              {h.faqMoreAfter}
            </p>
          </div>
          <FaqList items={faqItems.slice(0, 6)} />
        </div>
      </section>

      {/* ------------------------------------------------------------- CTA */}
      <section className="border-t border-line">
        <div className="container-page py-20 text-center sm:py-28">
          <p className="text-4xl font-semibold tracking-[-0.03em] text-white sm:text-6xl">
            craftinghosting<span className="text-blue-400">.free</span>
          </p>
          <p className="mx-auto mt-5 max-w-md text-lg text-muted">{early ? t.early.ctaText : closed ? t.closed.text : h.ctaText}</p>
          {!closed && (
            <ButtonLink href={startHref} size="lg" className="mt-9">
              {ctaLabel}
            </ButtonLink>
          )}
        </div>
      </section>
    </>
  );
}
