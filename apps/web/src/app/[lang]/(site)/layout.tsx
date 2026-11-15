import type { ReactNode } from 'react';
import { AnnouncementBar } from '@/components/layout/announcement';
import { CookieBanner } from '@/components/layout/cookie-banner';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { getDict, resolveLang } from '@/i18n';
import { RuntimeConfig } from '@/i18n/client';
import { cookies } from 'next/headers';
import { getSite } from '@/lib/site-settings';

export default async function SiteLayout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const lang = await resolveLang(params);
  // Erst die Einstellungen laden – sie bestimmen auch die Texte (Regeln, Links)
  const site = await getSite();
  const t = getDict(lang);
  // Nur ob ein Session-Cookie da ist (für den Header-Button) – geprüft wird die Anmeldung auf den Seiten selbst
  const signedIn = (await cookies()).has(process.env.SESSION_COOKIE_NAME ?? 'chf_session');
  return (
    <RuntimeConfig rules={site.rules} brand={site.brand}>
      <a
        href="#inhalt"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-white"
      >
        {t.common.skipToContent}
      </a>
      <AnnouncementBar announcement={site.announcement} lang={lang} />
      {site.beta.instance && (
        <div className="border-b border-amber-400/30 bg-amber-400/[0.1] text-sm text-amber-100" role="status">
          <div className="container-page flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-2 text-center">
            <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[11px] font-semibold tracking-[0.08em] uppercase">{t.beta.badge}</span>
            <span>{t.beta.bar}</span>
            {site.beta.mainUrl && (
              <a href={site.beta.mainUrl} className="font-medium text-white underline underline-offset-4 hover:no-underline">
                {t.beta.barLink}
              </a>
            )}
          </div>
        </div>
      )}
      <SiteHeader
        mode={site.registration.mode}
        maintenance={site.maintenance.enabled}
        signedIn={signedIn}
        donate={site.donate.enabled}
        logo={site.logo}
        sections={{
          minecraft: site.products.minecraft.enabled && site.products.minecraft.plans.length > 0,
          discord: site.products.discord.enabled && site.products.discord.plans.length > 0,
        }}
      />
      <main id="inhalt">{children}</main>
      <SiteFooter lang={lang} donate={site.donate.enabled} newsletter={site.newsletter.footerForm} logo={site.logo} />
      <CookieBanner />
    </RuntimeConfig>
  );
}
