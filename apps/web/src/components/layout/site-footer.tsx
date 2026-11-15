import Link from 'next/link';
import { localePath, type Locale } from '@chfree/shared';
import { Logo } from '@/components/brand/logo';
import { getDict } from '@/i18n';
import { site } from '@/lib/site';

export function SiteFooter({ lang, donate = false }: { lang: Locale; donate?: boolean }) {
  const t = getDict(lang);
  const links = [
    { href: localePath(lang, 'faq'), label: t.nav.faq },
    { href: localePath(lang, 'status'), label: t.nav.status },
    // Spenden-Link nur, wenn die Spenden-Seite im Admin-Bereich aktiviert ist
    ...(donate ? [{ href: localePath(lang, 'donate'), label: t.footer.donate }] : []),
    { href: site.discordUrl, label: t.common.discord, external: true },
    { href: `mailto:${site.supportEmail}`, label: t.footer.contact, external: true },
    { href: localePath(lang, 'imprint'), label: t.footer.imprint },
    { href: localePath(lang, 'privacy'), label: t.footer.privacy },
    { href: localePath(lang, 'terms'), label: t.footer.terms },
    { href: localePath(lang, 'rules'), label: t.footer.rules },
    { href: localePath(lang, 'discordTerms'), label: t.footer.discordTerms },
    { href: localePath(lang, 'cookies'), label: t.footer.cookies },
  ];

  return (
    <footer className="border-t border-line">
      <div className="container-page py-12">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <Logo href={localePath(lang, 'home')} />
            <p className="mt-4 text-sm leading-relaxed text-muted">
              {t.footer.aboutBefore}
              <a href={site.parentUrl} target="_blank" rel="noopener" className="text-gray-200 underline decoration-line-strong underline-offset-4 hover:text-white">
                Crafting Hosting
              </a>
              {t.footer.aboutAfter}
            </p>
          </div>
          <nav className="grid grid-cols-2 gap-x-10 gap-y-2.5 text-sm sm:grid-cols-3" aria-label={t.footer.label}>
            {links.map((l) =>
              l.external ? (
                <a key={l.label} href={l.href} target="_blank" rel="noopener" className="text-muted transition-colors hover:text-white">
                  {l.label}
                </a>
              ) : (
                <Link key={l.label} href={l.href} className="text-muted transition-colors hover:text-white">
                  {l.label}
                </Link>
              ),
            )}
          </nav>
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-line pt-6 text-[13px] text-subtle sm:flex-row sm:justify-between">
          <p>© 2024 – {new Date().getFullYear()} Crafting Hosting</p>
          <p>craftinghosting.free · A CraftingHosting Service</p>
        </div>
      </div>
    </footer>
  );
}
