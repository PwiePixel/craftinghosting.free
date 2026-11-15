'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { Globe } from 'lucide-react';
import { switchLocalePath } from '@chfree/shared';
import { useDict, useLang } from '@/i18n/client';

/** Prüft alle 20 s, ob die Wartung vorbei ist, und lädt dann die ursprünglich aufgerufene Seite neu. */
export function MaintenanceWatcher() {
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/v1/site', { cache: 'no-store' });
        const data = await res.json();
        if (res.ok && data?.site?.maintenance?.enabled === false) window.location.reload();
      } catch {
        /* API noch nicht erreichbar – beim nächsten Mal erneut versuchen */
      }
    };
    const timer = setInterval(check, 20_000);
    return () => clearInterval(timer);
  }, []);
  return null;
}

/** Sprachumschalter für die Wartungsseite (die URL bleibt die ursprünglich aufgerufene Seite) */
export function MaintenanceLangSwitch() {
  const lang = useLang();
  const t = useDict();
  const pathname = usePathname();
  const other = lang === 'de' ? 'en' : 'de';
  return (
    <a
      href={switchLocalePath(pathname, other)}
      hrefLang={other}
      lang={other}
      onClick={() => {
        document.cookie = `chf_lang=${other}; path=/; max-age=31536000; samesite=lax`;
      }}
      title={t.nav.switchTitle}
      className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-white"
    >
      <Globe className="size-4" aria-hidden />
      {t.nav.switchLabel}
    </a>
  );
}
