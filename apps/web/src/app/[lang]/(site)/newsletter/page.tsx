import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import { NewsletterAction } from '@/components/newsletter/newsletter-action';
import { NewsletterForm } from '@/components/newsletter/newsletter-form';
import { Alert } from '@/components/ui/primitives';
import { getDict, resolveLang } from '@/i18n';
import { pageMetadata } from '@/lib/seo';
import { getSite } from '@/lib/site-settings';

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  const t = getDict(lang).newsletter;
  const query = await searchParams;
  // Links aus E-Mails (mit Token) gehören nicht in den Suchindex
  return pageMetadata(lang, 'newsletter', { title: t.metaTitle, description: t.metaDescription, noIndex: !!(query.confirm || query.unsubscribe) });
}

export default async function NewsletterPage({ params, searchParams }: Props) {
  const lang = await resolveLang(params);
  const query = await searchParams;
  const site = await getSite();
  const t = getDict(lang).newsletter;
  const token = query.confirm ?? query.unsubscribe;
  const validToken = !!token && /^[A-Za-z0-9._-]{20,200}$/.test(token);

  return (
    <div className="container-page py-14 sm:py-20">
      <div className="mx-auto max-w-xl">
        {validToken ? (
          <div className="surface p-8 sm:p-10">
            <NewsletterAction action={query.confirm ? 'confirm' : 'unsubscribe'} token={token} />
          </div>
        ) : (
          <>
            <p className="label">{t.label}</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl">{t.title}</h1>
            <p className="mt-4 text-lg leading-relaxed text-muted">{t.intro}</p>
            <ul className="mt-7 space-y-2.5 text-[15px] text-gray-200">
              {t.points.map((point) => (
                <li key={point} className="flex gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-blue-400" aria-hidden />
                  {point}
                </li>
              ))}
            </ul>
            <div className="surface mt-9 p-6 sm:p-8">{site.newsletter.enabled ? <NewsletterForm /> : <Alert tone="info">{t.disabled}</Alert>}</div>
          </>
        )}
      </div>
    </div>
  );
}
