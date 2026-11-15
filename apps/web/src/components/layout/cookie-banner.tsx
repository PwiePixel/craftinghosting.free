'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { localePath } from '@chfree/shared';
import { buttonClasses } from '@/components/ui/button';
import { useDict, useLang } from '@/i18n/client';
import { api } from '@/lib/api/client';

const CONSENT_COOKIE = 'chf_consent';

/**
 * Cookie-Hinweis. Es gibt nur technisch notwendige Cookies – deshalb eine einzige Bestätigung
 * statt „Annehmen/Ablehnen“. Die Bestätigung wird im Cookie gemerkt und von der API protokolliert.
 */
export function CookieBanner() {
  const lang = useLang();
  const t = useDict().cookieBanner;
  const [visible, setVisible] = useState(false);

  // Erst im Browser prüfen (kein Unterschied zwischen Server- und Client-Ausgabe)
  useEffect(() => {
    if (!document.cookie.split('; ').some((c) => c.startsWith(`${CONSENT_COOKIE}=`))) setVisible(true);
  }, []);

  if (!visible) return null;

  function confirm() {
    document.cookie = `${CONSENT_COOKIE}=essential; path=/; max-age=31536000; samesite=lax`;
    setVisible(false);
    // Nachweis der Bestätigung – Fehler sind hier unkritisch
    api('/consent', { method: 'POST', body: { choice: 'essential' } }).catch(() => {});
  }

  return (
    <aside aria-label={t.label} className="fixed inset-x-0 bottom-0 z-[55] p-3 sm:p-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-xl border border-line-strong bg-surface-2 p-4 shadow-2xl shadow-black/40 sm:flex-row sm:items-center sm:gap-5 sm:px-5">
        <p className="text-sm leading-relaxed text-muted">
          {t.text}{' '}
          <Link href={localePath(lang, 'cookies')} className="text-blue-400 hover:text-blue-300">
            {t.more}
          </Link>
        </p>
        <button type="button" onClick={confirm} className={buttonClasses('primary', 'sm', 'shrink-0')}>
          {t.ok}
        </button>
      </div>
    </aside>
  );
}
