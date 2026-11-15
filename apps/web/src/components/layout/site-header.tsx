'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Globe, Menu, X } from 'lucide-react';
import { localePath, sectionPath, switchLocalePath, type RegistrationMode } from '@chfree/shared';
import { Logo } from '@/components/brand/logo';
import { buttonClasses } from '@/components/ui/button';
import { useDict, useLang } from '@/i18n/client';
import { cn } from '@/lib/utils';

/** Merkt sich die Sprachwahl (verhindert die automatische Weiterleitung auf „/“). */
function rememberLang(lang: string) {
  document.cookie = `chf_lang=${lang}; path=/; max-age=31536000; samesite=lax`;
}

export function SiteHeader({
  minimal = false,
  mode = 'open',
  maintenance = false,
  signedIn = false,
}: {
  minimal?: boolean;
  mode?: RegistrationMode;
  maintenance?: boolean;
  signedIn?: boolean;
}) {
  const lang = useLang();
  const t = useDict();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const other = lang === 'de' ? 'en' : 'de';
  // Early Access: „Platz sichern“ statt „Server erstellen“; Registrierung geschlossen: kein Button
  // Wartung: Anmelden statt Registrieren · Early Access: „Platz sichern“ · Registrierung geschlossen: kein Button
  const cta = maintenance ? null : mode === 'preregistration' ? t.early.cta : mode === 'closed' ? null : t.common.createServer;
  const ctaHref = localePath(lang, 'start');
  // Wartung: angemeldet → „Meine Server“, sonst „Anmelden“
  const maintenanceLink = signedIn ? { href: localePath(lang, 'myServers'), label: t.common.myServers } : { href: localePath(lang, 'login'), label: t.common.signIn };
  const switchHref = switchLocalePath(pathname, other);

  const nav = [
    { href: sectionPath(lang, 'plans'), label: t.nav.plans },
    { href: sectionPath(lang, 'how'), label: t.nav.how },
    { href: sectionPath(lang, 'rules'), label: t.nav.rules },
    { href: localePath(lang, 'faq'), label: t.nav.faq },
    { href: localePath(lang, 'status'), label: t.nav.status },
  ];

  // Bewusst <a> statt <Link>: Der Sprachwechsel lädt die Seite komplett neu (andere Sprache im Root-Layout, sauberer Prefetch-Cache).
  const langSwitch = (className?: string) => (
    <a
      href={switchHref}
      hrefLang={other}
      lang={other}
      onClick={() => rememberLang(other)}
      title={t.nav.switchTitle}
      className={cn('inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-white', className)}
    >
      <Globe className="size-4" aria-hidden />
      {t.nav.switchLabel}
    </a>
  );

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-background/85 backdrop-blur-md">
      <div className="container-page flex h-16 items-center justify-between gap-6">
        <Logo href={localePath(lang, 'home')} />

        {!minimal && (
          <nav className="hidden items-center gap-7 lg:flex" aria-label={t.nav.main}>
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className={cn('text-sm transition-colors', pathname === item.href ? 'text-white' : 'text-muted hover:text-white')}>
                {item.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2">
          {langSwitch('hidden px-2 md:inline-flex')}
          {!(maintenance && signedIn) && (
          <Link href={localePath(lang, 'myServers')} className="hidden px-2 text-sm text-muted transition-colors hover:text-white sm:inline">
            {t.common.myServers}
          </Link>
          )}
          {cta && (
            <Link href={ctaHref} className={buttonClasses('primary', 'sm', 'hidden sm:inline-flex')}>
              {cta}
            </Link>
          )}
          {maintenance && (
            <Link href={maintenanceLink.href} className={buttonClasses('primary', 'sm', 'hidden sm:inline-flex')}>
              {maintenanceLink.label}
            </Link>
          )}
          {!minimal && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="ml-1 inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-white lg:hidden"
              aria-expanded={open}
              aria-label={open ? t.nav.closeMenu : t.nav.openMenu}
            >
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          )}
        </div>
      </div>
      {open && (
        <nav className="border-t border-line lg:hidden" aria-label={t.nav.mobile}>
          <div className="container-page flex flex-col py-3">
            {[...nav, { href: localePath(lang, 'myServers'), label: t.common.myServers }].map((item) => (
              <Link key={item.href} href={item.href} className="py-2.5 text-[15px] text-gray-200">
                {item.label}
              </Link>
            ))}
            {langSwitch('py-2.5 text-[15px] text-gray-200')}
            {cta && (
              <Link href={ctaHref} className={buttonClasses('primary', 'md', 'mt-3')}>
                {cta}
              </Link>
            )}
            {maintenance && (
              <Link href={maintenanceLink.href} className={buttonClasses('primary', 'md', 'mt-3')}>
                {maintenanceLink.label}
              </Link>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
