import type { ReactNode } from 'react';
import { CookieBanner } from '@/components/layout/cookie-banner';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { getDict, resolveLang } from '@/i18n';
import { cookies } from 'next/headers';
import { getSite } from '@/lib/site-settings';

export default async function SiteLayout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const lang = await resolveLang(params);
  const t = getDict(lang);
  const site = await getSite();
  // Nur ob ein Session-Cookie da ist (für den Header-Button) – geprüft wird die Anmeldung auf den Seiten selbst
  const signedIn = (await cookies()).has(process.env.SESSION_COOKIE_NAME ?? 'chf_session');
  return (
    <>
      <a
        href="#inhalt"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-white"
      >
        {t.common.skipToContent}
      </a>
      <SiteHeader mode={site.registration.mode} maintenance={site.maintenance.enabled} signedIn={signedIn} donate={site.donate.enabled} />
      <main id="inhalt">{children}</main>
      <SiteFooter lang={lang} donate={site.donate.enabled} />
      <CookieBanner />
    </>
  );
}
