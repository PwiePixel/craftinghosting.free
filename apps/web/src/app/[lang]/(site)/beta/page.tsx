import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Check, FlaskConical } from 'lucide-react';
import { localePath } from '@chfree/shared';
import { BetaEnterButton } from '@/components/beta/beta-bits';
import { getDict, resolveLang } from '@/i18n';
import { getCurrentUser } from '@/lib/api/server';
import { getSite } from '@/lib/site-settings';

/**
 * Hauptseite: „Möchtest du die Beta-Seite öffnen?“ – nur für angemeldete Nutzer mit Beta-Zugang.
 * Alle anderen sehen eine 404-Seite (die Seite verrät nicht, dass es ein Beta-Programm gibt).
 */
type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  return { title: getDict(lang).beta.confirmMetaTitle, robots: { index: false, follow: false } };
}

export default async function BetaConfirmPage({ params }: Props) {
  const lang = await resolveLang(params);
  const t = getDict(lang).beta;
  const [me, settings] = await Promise.all([getCurrentUser(), getSite()]);
  // Nicht angemeldet, kein Beta-Zugang oder keine Beta-Instanz eingerichtet → 404
  if (!me?.user.beta || !settings.beta.url || settings.beta.instance) notFound();
  return (
    <div className="container-page py-14 sm:py-20">
      <div className="surface mx-auto max-w-xl p-8 sm:p-10">
        <span className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[13px] font-medium text-blue-300">
          <FlaskConical className="size-3.5" aria-hidden /> {t.badge}
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t.confirmTitle}</h1>
        <p className="mt-3 leading-relaxed text-muted">{t.confirmText}</p>
        <ul className="mt-6 space-y-2.5 text-[15px] text-gray-200">
          {t.confirmPoints.map((point) => (
            <li key={point} className="flex gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-blue-400" aria-hidden />
              {point}
            </li>
          ))}
        </ul>
        <p className="mt-6 font-mono text-[13px] text-subtle">{settings.beta.url.replace(/^https?:\/\//, '')}</p>
        <div className="mt-6">
          <BetaEnterButton />
        </div>
        <Link href={localePath(lang, 'myServers')} className="mt-6 inline-block text-sm text-muted hover:text-white">
          {t.back}
        </Link>
      </div>
    </div>
  );
}
