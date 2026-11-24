import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, Wrench } from 'lucide-react';
import { localePath } from '@chfree/shared';
import { Logo } from '@/components/brand/logo';
import { CookieBanner } from '@/components/layout/cookie-banner';
import { MaintenanceLangSwitch, MaintenanceWatcher } from '@/components/maintenance/maintenance-bits';
import { ButtonLink } from '@/components/ui/button';
import { formatters, getDict, resolveLang } from '@/i18n';
import { site } from '@/lib/site';
import { getSiteFresh } from '@/lib/site-settings';

/**
 * Wartungsseite. Wird vom Proxy für alle Seiten außer Status, Anmeldung und Rechtstexten
 * angezeigt, solange der Wartungsmodus im Admin-Bereich aktiv ist. Direkt nicht erreichbar.
 */
type Props = { params: Promise<{ lang: string }> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  return { title: getDict(lang).maintenance.metaTitle, robots: { index: false, follow: false } };
}

export default async function MaintenancePage({ params }: Props) {
  const lang = await resolveLang(params);
  const d = getDict(lang);
  const t = d.maintenance;
  const fmt = formatters(lang);
  const settings = await getSiteFresh();
  const m = settings.maintenance;
  const message = (m.message[lang] || m.message.en || m.message.de).trim();

  return (
    <div className="relative flex min-h-screen flex-col">
      <MaintenanceWatcher />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(37,99,235,0.16),transparent)]" aria-hidden />

      <header className="relative container-page flex h-16 items-center justify-between">
        <Logo href={localePath(lang, 'home')} custom={settings.logo} />
        <div className="flex items-center gap-4">
          <MaintenanceLangSwitch />
          {/* Anmelden bleibt möglich – nur Registrieren ist während der Wartung gesperrt */}
          <ButtonLink href={localePath(lang, 'login')} size="sm">
            {d.common.signIn}
          </ButtonLink>
        </div>
      </header>

      <main className="relative container-page flex flex-1 items-center py-16">
        <div className="mx-auto max-w-xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[13px] font-medium text-blue-300">
            <Wrench className="size-3.5" aria-hidden /> {t.label}
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-[-0.03em] text-white sm:text-5xl">{t.title}</h1>
          <p className="mt-5 text-lg leading-relaxed whitespace-pre-line text-muted">{message || t.text}</p>
          {m.until && <p className="mt-4 text-[15px] font-medium text-gray-100">{t.until(fmt.dateTime(m.until))}</p>}

          <div className="mt-9 flex justify-center">
            <ButtonLink href={site.discordUrl} external size="lg">
              {t.discord} <ArrowUpRight aria-hidden />
            </ButtonLink>
          </div>

          <ul className="mx-auto mt-10 max-w-md space-y-1.5 text-[13px] text-subtle">
            <li>{t.noDeletion}</li>
            <li>{t.autoRefresh}</li>
          </ul>
        </div>
      </main>

      <footer className="relative border-t border-line">
        <div className="container-page flex flex-col gap-2 py-6 text-[13px] text-subtle sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} Crafting Hosting</p>
          <nav className="flex flex-wrap gap-x-5 gap-y-1" aria-label={d.footer.label}>
            <Link href={localePath(lang, 'imprint')} className="hover:text-white">
              {d.footer.imprint}
            </Link>
            <Link href={localePath(lang, 'privacy')} className="hover:text-white">
              {d.footer.privacy}
            </Link>
            <Link href={localePath(lang, 'terms')} className="hover:text-white">
              {d.footer.terms}
            </Link>
            {settings.addons.online && (
              <Link href={localePath(lang, 'cancelSubscription')} className="hover:text-white">
                {d.footer.cancelSubscription}
              </Link>
            )}
            <a href={`mailto:${site.supportEmail}`} className="hover:text-white">
              {d.footer.contact}
            </a>
          </nav>
        </div>
      </footer>
      <CookieBanner />
    </div>
  );
}
