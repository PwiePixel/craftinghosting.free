import '@fontsource-variable/inter';
import '../globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { localePath, locales } from '@chfree/shared';
import { LangProvider } from '@/i18n/client';
import { getDict, resolveLang } from '@/i18n';
import { alternates } from '@/lib/seo';
import { site } from '@/lib/site';
import { getSite } from '@/lib/site-settings';

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const lang = await resolveLang(params);
  const t = getDict(lang).meta;
  // Im Admin-Bereich abschaltbar: Einstellungen → Suchmaschinen & KI
  const indexing = (await getSite()).seo.indexing;
  return {
    metadataBase: new URL(site.url),
    title: { default: t.title, template: '%s | CraftingHosting.free' },
    description: t.description,
    applicationName: site.name,
    keywords: t.keywords,
    authors: [{ name: 'Crafting Hosting', url: site.parentUrl }],
    creator: 'Crafting Hosting',
    publisher: 'Crafting Hosting',
    alternates: alternates(lang, 'home'),
    openGraph: { type: 'website', locale: t.ogLocale, url: `${site.url}${localePath(lang, 'home')}`, siteName: site.name, title: t.shortTitle, description: t.description },
    twitter: { card: 'summary_large_image', title: t.shortTitle, description: t.description },
    robots: indexing ? { index: true, follow: true } : { index: false, follow: false },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  themeColor: '#0b0d14',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const lang = await resolveLang(params);
  return (
    <html lang={lang} className="dark">
      <body className="min-h-screen">
        <LangProvider lang={lang}>{children}</LangProvider>
      </body>
    </html>
  );
}
