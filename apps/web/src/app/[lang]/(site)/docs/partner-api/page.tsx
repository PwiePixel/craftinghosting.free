import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Lock } from 'lucide-react';
import { localePath } from '@chfree/shared';
import { DocView } from '@/components/docs/doc-view';
import { ButtonLink } from '@/components/ui/button';
import { partnerDoc } from '@/content/docs/partner';
import { getDict, resolveLang } from '@/i18n';
import { getCurrentUser } from '@/lib/api/server';
import { userDocs } from '@/content/docs/user';
import { docVars } from '@/content/docs/vars';

type Props = { params: Promise<{ lang: string }> };

// Nie in Suchmaschinen und nie aus einem Zwischenspeicher: Der Inhalt hängt vom angemeldeten Konto ab
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Partner API', robots: { index: false, follow: false } };

/**
 * Partner-Dokumentation: nur für Partner-Konten (Admin → Nutzer → „Zum Partner machen“) und Admins.
 * Ohne Anmeldung geht es zur Anmeldung; angemeldete Konten ohne Partner-Status bekommen den Inhalt nicht zu sehen.
 */
export default async function PartnerDocsPage({ params }: Props) {
  const lang = await resolveLang(params);
  const t = getDict(lang).docs;
  const here = `${localePath(lang, 'docs')}/${partnerDoc.slug}`;
  const me = await getCurrentUser();
  if (!me) redirect(localePath(lang, 'login', { next: here }));
  if (!me.user.partner) {
    return (
      <div className="py-6 sm:py-10">
        <div className="surface mx-auto max-w-lg p-8 text-center">
          <Lock className="mx-auto size-8 text-violet-300" aria-hidden />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white">{t.noAccessTitle}</h1>
          <p className="mt-3 leading-relaxed text-muted">{t.noAccessText}</p>
          <div className="mt-7 flex justify-center">
            <ButtonLink href={localePath(lang, 'docs')} variant="secondary">
              {t.noAccessBack}
            </ButtonLink>
          </div>
        </div>
      </div>
    );
  }
  const last = userDocs[userDocs.length - 1]!;
  return (
    <DocView
      page={partnerDoc}
      lang={lang}
      vars={docVars()}
      badge={t.partnerBadge}
      prev={{ href: `${localePath(lang, 'docs')}/${last.slug}`, title: last.title[lang] }}
      labels={{ onThisPage: t.onThisPage, prev: t.prev, next: t.next }}
    />
  );
}
