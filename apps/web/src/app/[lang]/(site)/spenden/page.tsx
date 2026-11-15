import type { Metadata } from 'next';
import { ArrowUpRight, Cpu, Heart, ShieldCheck, Users, Zap } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';
import { Alert, SectionHead } from '@/components/ui/primitives';
import { getDict, resolveLang } from '@/i18n';
import { pageMetadata } from '@/lib/seo';
import { site } from '@/lib/site';
import { getSite } from '@/lib/site-settings';

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  const t = getDict(lang).donate;
  return pageMetadata(lang, 'donate', { title: t.metaTitle, description: t.metaDescription });
}

const reasonIcons = [Zap, Users, Cpu, ShieldCheck];

export default async function DonatePage({ params }: Props) {
  const lang = await resolveLang(params);
  const t = getDict(lang).donate;
  const settings = await getSite();
  // Ohne Zahlungslink bleibt die Seite erreichbar – mit Hinweis statt Button
  const donateUrl = settings.donate.enabled ? settings.donate.url : null;

  return (
    <div className="container-page py-14 sm:py-20">
      <div className="mx-auto max-w-3xl">
        <p className="label">{t.label}</p>
        <h1 className="h2 mt-3">{t.title}</h1>
        <p className="lead mt-4">{t.intro}</p>

        {donateUrl ? (
          <div className="mt-8">
            <ButtonLink href={donateUrl} external size="lg">
              <Heart aria-hidden /> {t.button} <ArrowUpRight aria-hidden />
            </ButtonLink>
            <p className="mt-3 text-[13px] text-subtle">{t.redirectNote}</p>
          </div>
        ) : (
          <div className="mt-8">
            <Alert title={t.closedTitle}>
              {t.closedText}{' '}
              <a href={site.discordUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                {t.discord}
              </a>
            </Alert>
          </div>
        )}

        <section className="mt-16">
          <SectionHead label={t.whyLabel} title={t.whyTitle}>
            {t.whyIntro}
          </SectionHead>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {t.reasons.map((r, i) => {
              const Icon = reasonIcons[i % reasonIcons.length]!;
              return (
                <li key={r.title} className="rounded-xl border border-line bg-surface p-6">
                  <Icon className="size-5 text-blue-400" aria-hidden />
                  <h3 className="mt-4 font-medium text-white">{r.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{r.text}</p>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="mt-16">
          <h2 className="text-xl font-semibold text-white">{t.knowTitle}</h2>
          <ul className="mt-4 space-y-2.5 text-[15px] leading-relaxed text-gray-300">
            {t.know.map((item) => (
              <li key={item} className="ml-5 list-disc">
                {item}
              </li>
            ))}
            <li className="ml-5 list-disc">
              {t.refundBefore}
              <a href={`mailto:${site.supportEmail}`} className="text-blue-400 hover:text-blue-300">
                {site.supportEmail}
              </a>
              {t.refundAfter}
            </li>
          </ul>
        </section>

        <div className="mt-12 flex flex-col gap-4 rounded-xl border border-line p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-relaxed text-muted">{t.closing}</p>
          <ButtonLink href={site.discordUrl} external variant="secondary" className="shrink-0">
            {t.discord}
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
