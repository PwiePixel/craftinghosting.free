import type { Metadata } from 'next';
import { FlaskConical } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { ButtonLink } from '@/components/ui/button';
import { getDict, resolveLang } from '@/i18n';
import { getSite } from '@/lib/site-settings';

/**
 * Beta-Instanz: Hinweis für alle ohne Beta-Zugang. Der Proxy zeigt diese Seite bei JEDER Adresse (Status 403),
 * solange keine gültige Beta-Sitzung vorliegt. Anmelden kann man sich hier nicht – der Zugang läuft über die Hauptseite.
 */
type Props = { params: Promise<{ lang: string }> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  return { title: getDict(lang).beta.gateMetaTitle, robots: { index: false, follow: false } };
}

export default async function BetaGatePage({ params }: Props) {
  const lang = await resolveLang(params);
  const t = getDict(lang).beta;
  const settings = await getSite();
  const main = settings.beta.mainUrl;
  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(37,99,235,0.16),transparent)]" aria-hidden />
      <header className="relative container-page flex h-16 items-center">
        <Logo href={main ?? '#'} custom={settings.logo} />
      </header>
      <main className="relative container-page flex flex-1 items-center py-16">
        <div className="mx-auto max-w-xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[13px] font-medium text-blue-300">
            <FlaskConical className="size-3.5" aria-hidden /> {t.badge}
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-[-0.03em] text-white sm:text-5xl">{t.gateTitle}</h1>
          <p className="mt-5 text-lg leading-relaxed text-muted">{t.gateText}</p>
          <p className="mt-4 text-[15px] leading-relaxed text-subtle">{t.gateHow}</p>
          {main && (
            <div className="mt-9 flex justify-center">
              <ButtonLink href={main} external size="lg">
                {t.toMain}
              </ButtonLink>
            </div>
          )}
        </div>
      </main>
      <footer className="relative border-t border-line">
        <div className="container-page py-6 text-[13px] text-subtle">© {new Date().getFullYear()} Crafting Hosting</div>
      </footer>
    </div>
  );
}
