import type { ReactNode } from 'react';
import type { Locale } from '@chfree/shared';
import { getDict } from '@/i18n';

/**
 * Rahmen für Rechtstexte. Englische Fassungen tragen einen Hinweis, dass die deutsche Fassung maßgeblich ist.
 */
export function LegalPage({ lang, title, updated, children }: { lang: Locale; title: string; updated: string; children: ReactNode }) {
  const t = getDict(lang).legal;
  return (
    <div className="container-page py-14 sm:py-20">
      <article className="mx-auto max-w-3xl" lang={lang}>
        <h1 className="text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-muted">
          {t.updated}: {updated}
        </p>
        {t.translationNote && <p className="mt-4 text-sm text-subtle">{t.translationNote}</p>}
        <div className="legal mt-10 space-y-8 text-[15px] leading-relaxed text-gray-300 [&_a]:text-blue-400 [&_a:hover]:text-blue-300 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-white [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:font-semibold [&_h3]:text-gray-100 [&_li]:ml-5 [&_li]:list-disc [&_p+p]:mt-3 [&_ul]:mt-2 [&_ul]:space-y-1">
          {children}
        </div>
      </article>
    </div>
  );
}
