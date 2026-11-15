import type { Metadata } from 'next';
import { FaqList } from '@/components/home/faq-list';
import { ButtonLink } from '@/components/ui/button';
import { getDict, resolveLang } from '@/i18n';
import { pageMetadata } from '@/lib/seo';
import { site } from '@/lib/site';
import { getSite } from '@/lib/site-settings';
import { siteTexts } from '@/lib/site-texts';

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  const t = getDict(lang).faq;
  return pageMetadata(lang, 'faq', { title: t.metaTitle, description: t.metaDescription });
}

export default async function FaqPage({ params }: Props) {
  const lang = await resolveLang(params);
  const t = getDict(lang).faq;
  const settings = await getSite();
  const x = siteTexts(settings, lang);
  const items = [...(settings.registration.mode === 'preregistration' ? [t.earlyItem(x.twoTiers)] : []), ...t.items(x.limits, x.faq)];
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: lang === 'en' ? 'en-GB' : 'de-DE',
    mainEntity: items.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })),
  };
  return (
    <div className="container-page py-14 sm:py-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="mx-auto max-w-3xl">
        <p className="label">FAQ</p>
        <h1 className="h2 mt-3">{t.title}</h1>
        <p className="lead mt-4">{t.intro}</p>
        <div className="mt-10">
          <FaqList items={items} />
        </div>
        <div className="mt-12 flex flex-col gap-4 rounded-xl border border-line p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-white">{t.moreTitle}</p>
            <p className="mt-1 text-sm text-muted">{t.moreText}</p>
          </div>
          <ButtonLink href={site.discordUrl} external variant="secondary">
            {t.openDiscord}
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
