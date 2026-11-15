import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import { getPlan, localePath, type ServerDTO } from '@chfree/shared';
import { StartForm, type Availability } from '@/components/start/start-form';
import { ButtonLink } from '@/components/ui/button';
import { getDict, resolveLang } from '@/i18n';
import { apiPublic, apiServer, getCurrentUser } from '@/lib/api/server';
import { pageMetadata } from '@/lib/seo';
import { site } from '@/lib/site';
import { getSite } from '@/lib/site-settings';

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
  const initialPlan = query.plan && getPlan(query.plan) ? query.plan : undefined;
  const [me, meta, settings] = await Promise.all([getCurrentUser(), apiPublic<{ availability: Availability }>('/meta', 0), getSite()]);
  const mode = settings.registration.mode;
  const max = settings.registration.maxServersPerUser;
  const early = mode === 'preregistration';

  let servers: ServerDTO[] = [];
  if (me) {
    const res = await apiServer<{ servers: ServerDTO[] }>('/servers', lang);
    if (res.ok) servers = res.data.servers;
  }
  const owned = servers.filter((srv) => srv.status !== 'pending' && srv.status !== 'waitlist').length;
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
            <dd className="mt-0.5 text-xl font-semibold text-white">{e.tiers[w.tier]}</dd>
          </div>
        </dl>
        {myServersButton}
      </InfoCard>
    );
  } else if (owned >= max || (early && owned > 0)) {
    content = (
      <InfoCard title={max === 1 || early ? s.hasServerTitle : s.hasServerTitleMany} text={s.hasServerText(early ? 1 : max)}>
        {myServersButton}
        {premiumButton}
      </InfoCard>
    );
  } else {
    content = <StartForm availability={meta.ok ? meta.data.availability : null} initialPlan={initialPlan} userEmail={me?.user.email} early={early} />;
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
              {s.asidePoints.map((point) => (
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
