import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import { describeServerLimits, isProductKind, kindExhausted, localePath, productKinds, serverLimitBlock, takenPlanIds, type BonusSlot, type ServerDTO } from '@chfree/shared';
import { VerifyFlow } from '@/components/start/verify-flow';
import { Alert } from '@/components/ui/primitives';
import { StartForm } from '@/components/start/start-form';
import { ButtonLink } from '@/components/ui/button';
import { getDict, resolveLang } from '@/i18n';
import { apiServer, getCurrentUser } from '@/lib/api/server';
import { pageMetadata } from '@/lib/seo';
import { DiscordRequiredNote } from '@/components/discord/discord-note';
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
  const limits = settings.registration.limits;
  const early = mode === 'preregistration';

  let servers: ServerDTO[] = [];
  // Zusätzliche Slots aus Belohnungen (Einladungen, Server-Boosts)
  let bonusSlots: BonusSlot[] = [];
  if (me) {
    const res = await apiServer<{ servers: ServerDTO[]; bonusSlots?: BonusSlot[] }>('/servers', lang);
    if (res.ok) {
      servers = res.data.servers;
      bonusSlots = res.data.bonusSlots ?? [];
    }
  }
  const ownedServers = servers.filter((srv) => srv.status !== 'pending' && srv.status !== 'waitlist');
  const owned = ownedServers.length;
  const offered = productKinds.filter((k) => settings.products[k].enabled && settings.products[k].plans.length > 0);
  // Grenzen aus dem Admin-Bereich: je Angebot, zusammen und – falls eingestellt – jedes Paket nur einmal
  const ownedRefs = ownedServers.map((srv) => ({ kind: srv.kind, planId: srv.planId }));
  const blockedKinds = productKinds.filter((k) => kindExhausted(limits, ownedRefs, k, settings.products[k].plans.map((p) => p.id), bonusSlots));
  const takenPlans = productKinds.flatMap((k) => takenPlanIds(limits, ownedRefs, k, bonusSlots));
  // Pakete, für die gerade kein Slot frei ist (z. B. wenn nur noch ein paketgebundener Bonus-Slot übrig ist)
  const lockedPlans = productKinds.flatMap((k) =>
    settings.products[k].plans.map((p) => p.id).filter((id) => !takenPlans.includes(id) && serverLimitBlock(limits, ownedRefs, k, id, bonusSlots) !== null),
  );
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
      <InfoCard title={owned <= 1 || early ? s.hasServerTitle : s.hasServerTitleMany} text={s.hasServerText(early ? t.early.onePerPerson : describeServerLimits(limits, lang, offered))}>
        {myServersButton}
        {premiumButton}
      </InfoCard>
    );
  } else {
    // „Server erstellen“ ist für angemeldete Nutzer. Ohne Anmeldung geht es zuerst zur Registrierung – und von dort
    // automatisch hierher zurück, samt gewähltem Paket.
    if (!me) {
      const back: Record<string, string> = {};
      if (initialPlan) back.plan = initialPlan;
      if (initialKind) back.type = initialKind;
      redirect(localePath(lang, 'register', { next: localePath(lang, 'start', Object.keys(back).length ? back : undefined) }));
    }
    content = (
      <StartForm
        products={settings.products}
        initialPlan={initialPlan}
        initialKind={initialKind}
        blockedKinds={early ? [] : blockedKinds}
        takenPlans={early ? [] : takenPlans}
        lockedPlans={early || !me ? [] : lockedPlans}
        bonusSlots={bonusSlots.length}
        userEmail={me?.user.email}
        early={early}
        newsletterOption={settings.newsletter.signupCheckbox}
        discordSignup={settings.discord.signup}
        needsDiscord={settings.discord.available && !!me && !me.user.discord}
      />
    );
  }
  // Zurück von Discord (Registrierung/Anmeldung): mit dem nächsten Schritt weitermachen – Panel-Zugang, Beitritt, fertig
  // Ebenso, wenn schon eine Anfrage wartet und noch Schritte fehlen (Discord verbinden, Panel-Zugang festlegen)
  const openSteps = !!me && !me.user.panelLinked && servers.some((srv) => srv.status === 'pending');
  if (me && (query.resume === '1' || openSteps)) {
    content = (
      <div className="surface p-8 sm:p-10">
        <VerifyFlow embedded resume />
      </div>
    );
  }
  const discordResult = query.discord ? t.discord.results[query.discord] : undefined;

  return (
    <div className="container-page py-12 sm:py-16">
      <div className="grid gap-10 lg:grid-cols-[1fr_300px] lg:gap-14">
        <div className="min-w-0">
          {early && <p className="label">{e.badge}</p>}
          <h1 className={early ? 'mt-3 text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl' : 'text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl'}>
            {early ? e.startTitle : s.title}
          </h1>
          <p className="mt-3 max-w-xl text-muted">{early ? e.startIntro : s.intro}</p>
          <DiscordRequiredNote site={settings} lang={lang} user={me?.user} className="mt-6" />
          {discordResult && !discordResult.ok && (
            <Alert tone="warning" title={discordResult.title} className="mt-8">
              {discordResult.text}
            </Alert>
          )}
          <div className={discordResult && !discordResult.ok ? 'mt-5' : 'mt-8'}>{content}</div>
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
