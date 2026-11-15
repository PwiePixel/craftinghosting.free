import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import { isProductKind, localePath, productKinds, type ServerDTO } from '@chfree/shared';
import { StartForm } from '@/components/start/start-form';
import { ButtonLink } from '@/components/ui/button';
import { getDict, resolveLang } from '@/i18n';
import { apiServer, getCurrentUser } from '@/lib/api/server';
import { pageMetadata } from '@/lib/seo';
import { site } from '@/lib/site';
import { getSite } from '@/lib/site-settings';
import { siteTexts } from '@/lib/site-texts';

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  const t = getDict(lang).start;
  return pageMetadata(lang, 'start', { title: t.metaTitle, description: t.metaDescription });
}

function InfoCard({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="surface p-8">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mt-2 leading-relaxed text-muted">{text}</p>
      {children && <div className="mt-6 flex flex-wrap gap-3">{children}</div>}
    </div>
  );
}

export default async function StartPage({ params, searchParams }: Props) {
  const lang = await resolveLang(params);
  const t = getDict(lang);
  const s = t.start;
  const e = t.early;
  const query = await searchParams;
  const [me, settings] = await Promise.all([getCurrentUser(), getSite()]);
  const x = siteTexts(settings, lang);
  const initialPlan = query.plan && settings.plans.some((p) => p.id === query.plan) ? query.plan : undefined;
  // /start?type=discord öffnet direkt das Discord-Bot-Formular
  const initialKind = isProductKind(query.type) ? query.type : undefined;
  const mode = settings.registration.mode;
  const max = settings.registration.maxServersPerUser;
  const early = mode === 'preregistration';

  let servers: ServerDTO[] = [];
  if (me) {
    const res = await apiServer<{ servers: ServerDTO[] }>('/servers', lang);
    if (res.ok) servers = res.data.servers;
  }
  const ownedServers = servers.filter((srv) => srv.status !== 'pending' && srv.status !== 'waitlist');
  const owned = ownedServers.length;
  // Das Limit gilt je Produkt: ein Minecraft-Server UND ein Discord-Bot sind möglich
  const offered = productKinds.filter((k) => settings.products[k].enabled && settings.products[k].plans.length > 0);
  const blockedKinds = productKinds.filter((k) => ownedServers.filter((srv) => srv.kind === k).length >= max);
  const allBlocked = offered.length > 0 && offered.every((k) => blockedKinds.includes(k));
  const waitlistEntry = servers.find((srv) => srv.status === 'waitlist' && srv.waitlist);

  const myServersButton = <ButtonLink href={localePath(lang, 'myServers')}>{t.common.myServers}</ButtonLink>;
  const premiumButton = (
    <ButtonLink href={site.parentPricingUrl} external variant="secondary">
      {s.premiumOffers}
    </ButtonLink>
  );

  let content: React.ReactNode;
  if (mode === 'closed') {
    content = (
      <InfoCard title={s.closedTitle} text={s.closedText}>
        {me && myServersButton}
        <ButtonLink href={site.discordUrl} external variant="secondary">
          Discord
        </ButtonLink>
      </InfoCard>
    );
  } else if (early && waitlistEntry?.waitlist) {
    const w = waitlistEntry.waitlist;
    content = (
      <InfoCard title={e.onListTitle} text={e.onListText}>
        <dl className="flex w-full flex-wrap gap-x-10 gap-y-3 border-y border-line py-4 text-sm">
          <div>
            <dt className="text-subtle">{e.positionLabel}</dt>
            <dd className="mt-0.5 text-xl font-semibold text-white">#{w.position}</dd>
          </div>
          <div>
            <dt className="text-subtle">{e.hardwareLabel}</dt>
            <dd className="mt-0.5 text-xl font-semibold text-white">{x.twoTiers ? e.tiers[w.tier] : x.cpus}</dd>
          </div>
        </dl>
        {myServersButton}
      </InfoCard>
    );
  } else if (allBlocked || (early && owned > 0)) {
    content = (
      <InfoCard title={max === 1 || early ? s.hasServerTitle : s.hasServerTitleMany} text={s.hasServerText(early ? 1 : max)}>
        {myServersButton}
        {premiumButton}
      </InfoCard>
    );
  } else {
    content = (
      <StartForm
        products={settings.products}
        initialPlan={initialPlan}
        initialKind={initialKind}
        blockedKinds={early ? [] : blockedKinds}
        userEmail={me?.user.email}
        early={early}
        newsletterOption={settings.newsletter.signupCheckbox}
      />
    );
  }

  return (
    <div className="container-page py-12 sm:py-16">
      <div className="grid gap-10 lg:grid-cols-[1fr_300px] lg:gap-14">
        <div className="min-w-0">
          {early && <p className="label">{e.badge}</p>}
          <h1 className={early ? 'mt-3 text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl' : 'text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl'}>
            {early ? e.startTitle : s.title}
          </h1>
          <p className="mt-3 max-w-xl text-muted">{early ? e.startIntro : s.intro}</p>
          <div className="mt-8">{content}</div>
        </div>

        <aside className="lg:pt-24">
          <div className="lg:sticky lg:top-24">
            <p className="text-sm font-semibold text-white">{s.asideTitle}</p>
            <ul className="mt-4 space-y-3 text-sm text-muted">
              {s.asidePoints(x.cpus, x.locationNames, x.locationCount).map((point) => (
                <li key={point} className="flex gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-blue-400" aria-hidden />
                  {point}
                </li>
              ))}
            </ul>
            <div className="mt-8 border-t border-line pt-6">
              <p className="text-sm font-semibold text-white">{s.fairTitle}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.fairText}</p>
            </div>
            {x.discord && (
              <div className="mt-8 border-t border-line pt-6">
                <p className="text-sm font-semibold text-white">
                  {s.products.discord.name}: {s.fairTitleBot}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.fairTextBot(settings.products.discord.fairUse)}</p>
              </div>
            )}
            {early && settings.waitlist.epycSlots > 0 && (
              <div className="mt-8 border-t border-line pt-6">
                <p className="text-sm font-semibold text-white">{e.badge}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {settings.waitlist.epycRemaining > 0
                    ? e.epycLeft(String(settings.waitlist.epycRemaining), String(settings.waitlist.epycSlots))
                    : e.epycFull}
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
