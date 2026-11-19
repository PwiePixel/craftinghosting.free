'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type MouseEvent } from 'react';
import { Globe, Heart, Menu, UserRound, X } from 'lucide-react';
import { localePath, sectionPath, switchLocalePath, type RegistrationMode } from '@chfree/shared';
import { Logo, type CustomLogo } from '@/components/brand/logo';
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
  donate = false,
  logo,
  sections = { minecraft: true, discord: true },
}: {
  /** Welche Angebote die Startseite zeigt – „Pakete“ springt zum ersten vorhandenen Abschnitt */
  sections?: { minecraft: boolean; discord: boolean };
  /** Hochgeladenes Logo aus dem Admin-Bereich */
  logo?: CustomLogo;
  minimal?: boolean;
  mode?: RegistrationMode;
  maintenance?: boolean;
  signedIn?: boolean;
  /** Spenden-Seite ist aktiv → Link in der Navigation */
  donate?: boolean;
}) {
  const lang = useLang();
  const t = useDict();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const other = lang === 'de' ? 'en' : 'de';
  // Early Access: „Platz sichern“ statt „Server erstellen“; Registrierung geschlossen: kein Button
  // Wartung: Anmelden statt Registrieren · Early Access: „Platz sichern“ · Registrierung geschlossen: kein Button
  // Angemeldet: statt „Server erstellen“ der eigene Kontoname (führt zum Konto; neue Server gibt es unter „Meine Server“)
  const cta = maintenance || signedIn ? null : mode === 'preregistration' ? t.early.cta : mode === 'closed' ? null : t.common.createServer;
  const [accountName, setAccountName] = useState<string | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let off = false;
    fetch('/api/v1/auth/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { user?: { email: string; panelUsername: string | null } } | null) => {
        if (!off && d?.user) setAccountName(d.user.panelUsername || d.user.email.split('@')[0] || null);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [signedIn]);
  const accountHref = localePath(lang, 'account');
  const ctaHref = localePath(lang, 'start');
  // Wartung: angemeldet → „Meine Server“, sonst „Anmelden“
  const maintenanceLink = signedIn ? { href: localePath(lang, 'myServers'), label: t.common.myServers } : { href: localePath(lang, 'login'), label: t.common.signIn };
  const switchHref = switchLocalePath(pathname, other);
  const donateHref = localePath(lang, 'donate');

  const nav: { href: string; label: string; wide?: boolean }[] = [
    // Ohne Minecraft-Pakete führt „Pakete“ zum Discord-Bereich; ohne beides entfällt der Link
    ...(sections.minecraft || sections.discord ? [{ href: sectionPath(lang, sections.minecraft ? 'plans' : 'discord'), label: t.nav.plans }] : []),
    ...(sections.discord ? [{ href: sectionPath(lang, 'discord'), label: t.nav.discord }] : []),
    // „Ablauf“ erscheint in der Desktop-Leiste erst ab sehr breiten Fenstern – sonst wird es zu eng
    { href: sectionPath(lang, 'how'), label: t.nav.how, wide: true },
    { href: sectionPath(lang, 'rules'), label: t.nav.rules },
    { href: localePath(lang, 'docs'), label: t.nav.docs },
    { href: localePath(lang, 'faq'), label: t.nav.faq },
    { href: localePath(lang, 'status'), label: t.nav.status },
  ];

  /**
   * Links zu Abschnitten der Startseite: Steht das Ziel schon in der Adresse (z. B. zweiter Klick auf „Pakete“),
   * würde der Browser nicht mehr scrollen. Deshalb springen wir selbst zum Abschnitt, wenn er auf dieser Seite liegt.
   */
  const goToSection = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    const [path, hash] = href.split('#');
    if (!hash || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const here = window.location.pathname.replace(/\/$/, '') === (path ?? '').replace(/\/$/, '');
    const target = here ? document.getElementById(hash) : null;
    if (!target) return;
    e.preventDefault();
    setOpen(false);
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (window.location.hash !== `#${hash}`) window.history.pushState(null, '', `#${hash}`);
  };

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
        <Logo href={localePath(lang, 'home')} custom={logo} />

        {!minimal && (
          <nav className="hidden items-center gap-5 lg:flex xl:gap-7" aria-label={t.nav.main}>
            {nav.map((item) => (
              <Link key={item.label} href={item.href} onClick={(e) => goToSection(e, item.href)} className={cn('text-sm whitespace-nowrap transition-colors', item.wide && 'hidden 2xl:inline', pathname === item.href ? 'text-white' : 'text-muted hover:text-white')}>
                {item.label}
              </Link>
            ))}
            {donate && (
              <Link href={donateHref} className={cn('inline-flex items-center gap-1.5 text-sm whitespace-nowrap transition-colors', pathname === donateHref ? 'text-white' : 'text-muted hover:text-white')}>
                <Heart className="size-3.5 text-blue-400" aria-hidden />
                {t.nav.donate}
              </Link>
            )}
          </nav>
        )}

        <div className="flex items-center gap-2">
          {langSwitch('hidden px-2 md:inline-flex')}
          {!(maintenance && signedIn) && (
          <Link href={localePath(lang, 'myServers')} className="hidden px-2 text-sm whitespace-nowrap text-muted transition-colors hover:text-white sm:inline">
            {t.common.myServers}
          </Link>
          )}
          {cta && (
            <Link href={ctaHref} className={buttonClasses('primary', 'sm', 'hidden sm:inline-flex')}>
              {cta}
            </Link>
          )}
          {signedIn && !maintenance && (
            <Link href={accountHref} className={buttonClasses('secondary', 'sm', 'hidden max-w-[14rem] sm:inline-flex')} title={t.common.account}>
              <UserRound aria-hidden /> <span className="truncate">{accountName ?? t.common.account}</span>
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
            {[...nav, { href: localePath(lang, 'myServers'), label: t.common.myServers }, ...(signedIn ? [{ href: accountHref, label: accountName ? `${t.common.account} (${accountName})` : t.common.account }] : [])].map((item) => (
              <Link key={item.label} href={item.href} onClick={(e) => goToSection(e, item.href)} className="py-2.5 text-[15px] text-gray-200">
                {item.label}
              </Link>
            ))}
            {donate && (
              <Link href={donateHref} className="inline-flex items-center gap-1.5 py-2.5 text-[15px] text-gray-200">
                <Heart className="size-4 text-blue-400" aria-hidden />
                {t.nav.donate}
              </Link>
            )}
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
