import type { Metadata } from 'next';
import type { ComponentType } from 'react';
import type { Locale, PublicSiteDTO } from '@chfree/shared';
import { LegalPage } from '@/components/layout/legal-page';
import { getDict, resolveLang } from '@/i18n';
import { pageMetadata } from '@/lib/seo';
import { getSite } from '@/lib/site-settings';
import { operator } from './operator';

type LegalKey = 'imprint' | 'privacy' | 'terms' | 'rules' | 'cookies' | 'discordTerms' | 'extrasTerms';
type Props = { params: Promise<{ lang: string }> };
/** Rechtstexte bekommen die aktuellen Einstellungen (z. B. Server pro Person) */
export type LegalContent = ComponentType<{ site: PublicSiteDTO }>;

/** Erzeugt Seite + Metadaten für einen Rechtstext in beiden Sprachen. */
export function legalRoute(key: LegalKey, content: Record<Locale, LegalContent>) {
  async function generateMetadata({ params }: Props): Promise<Metadata> {
    const lang = await resolveLang(params);
    const t = getDict(lang).legal[key];
    return pageMetadata(lang, key, { title: 'short' in t ? t.short : t.title, description: t.description });
  }

  async function Page({ params }: Props) {
    const lang = await resolveLang(params);
    const Content = content[lang];
    const site = await getSite();
    return (
      <LegalPage lang={lang} title={getDict(lang).legal[key].title} updated={operator.updated[lang]}>
        <Content site={site} />
      </LegalPage>
    );
  }

  return { generateMetadata, Page };
}
