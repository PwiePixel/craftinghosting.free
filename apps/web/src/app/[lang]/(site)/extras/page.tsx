import type { Metadata } from 'next';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { formatAddonPeriod, formatAddonPrice, localePath, productKinds, tr } from '@chfree/shared';
import { addonIcons } from '@/components/my/addon-icons';
import { ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/primitives';
import { getDict, resolveLang } from '@/i18n';
import { pageMetadata } from '@/lib/seo';
import { getSite } from '@/lib/site-settings';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  const t = getDict(lang).extras;
  return pageMetadata(lang, 'extras', { title: t.metaTitle, description: t.metaDescription });
}

/** Öffentliche Übersicht der kostenpflichtigen Extras – gebucht wird je Server unter „Meine Server“ */
export default async function ExtrasPage({ params }: Props) {
  const lang = await resolveLang(params);
  const d = getDict(lang);
  const t = d.extras;
  const site = await getSite();
  const { enabled, items, priceNote } = site.addons;
  const planNames = new Map(productKinds.flatMap((k) => site.products[k].plans.map((p) => [p.id, p.name] as const)));
  const note = tr(priceNote, lang);

  return (
    <div className="container-page py-14 sm:py-20">
      <div className="mx-auto max-w-4xl">
        <p className="label">{t.label}</p>
        <h1 className="h2 mt-3">{t.title}</h1>
        <p className="lead mt-4">{t.intro}</p>

        {!enabled || items.length === 0 ? (
          <div className="mt-8">
            <Alert>{t.closed}</Alert>
          </div>
        ) : (
          <ul className="mt-10 grid gap-4 sm:grid-cols-2">
            {items.map((a) => {
              const plans = a.planIds.map((id) => planNames.get(id)).filter((n): n is string => !!n);
              return (
                <li key={a.id} className={cn('relative flex flex-col rounded-xl border bg-surface p-6', a.highlighted ? 'border-blue-500/60' : 'border-line')}>
                  {a.highlighted && <span className="absolute top-4 right-4 rounded bg-blue-500 px-2 py-0.5 text-[11px] font-medium tracking-[0.06em] text-white">{t.popular}</span>}
                  <span className="grid size-10 place-items-center rounded-lg bg-blue-500/15 text-blue-300">{addonIcons[a.icon]}</span>
                  <h2 className="mt-4 text-lg font-semibold text-white">{tr(a.name, lang)}</h2>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{tr(a.description, lang)}</p>
                  {plans.length > 0 && <p className="mt-3 text-[13px] text-subtle">{t.onlyFor(plans.join(', '))}</p>}
                  <p className="mt-5 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-white">{formatAddonPrice(a.priceCents, lang)}</span>
                    <span className="text-sm text-muted">{a.periodDays > 0 ? t.perPeriod(formatAddonPeriod(a.periodDays, lang)) : t.once}</span>
                  </p>
                  {note && <p className="mt-1 text-[12px] text-subtle">{note}</p>}
                </li>
              );
            })}
          </ul>
        )}

        <section className="mt-14">
          <h2 className="text-xl font-semibold text-white">{t.howTitle}</h2>
          <ul className="mt-4 space-y-3 text-[15px] leading-relaxed text-gray-300">
            {t.how.map((item) => (
              <li key={item} className="flex gap-3">
                <Check className="mt-1 size-4 shrink-0 text-emerald-400" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <ButtonLink href={localePath(lang, 'myServers')}>{t.cta}</ButtonLink>
          <ButtonLink href={localePath(lang, 'start')} variant="secondary">
            {t.ctaStart}
          </ButtonLink>
        </div>
        <p className="mt-6 text-[13px] text-subtle">
          <Link href={localePath(lang, 'extrasTerms')} className="underline underline-offset-4 hover:text-white">
            {t.termsLink}
          </Link>
        </p>
      </div>
    </div>
  );
}
