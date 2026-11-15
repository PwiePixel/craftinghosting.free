import type { Metadata } from 'next';
import { BetaAccess } from '@/components/beta/beta-bits';
import { getDict, resolveLang } from '@/i18n';
import { getSite } from '@/lib/site-settings';

/**
 * Beta-Instanz: Ziel des Wechsels von der Hauptseite (…/beta-access?ticket=…). Hier wird das Einmal-Ticket eingelöst.
 * Auf der Hauptseite ist diese Seite nicht erreichbar (der Proxy liefert dort 404).
 */
type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | undefined>> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  return { title: getDict(lang).beta.gateMetaTitle, robots: { index: false, follow: false } };
}

export default async function BetaAccessPage({ params, searchParams }: Props) {
  await resolveLang(params);
  const { ticket } = await searchParams;
  const settings = await getSite();
  return (
    <main className="container-page flex min-h-screen items-center justify-center py-16">
      <div className="mx-auto max-w-xl">
        <BetaAccess ticket={ticket && /^[A-Za-z0-9._:-]{20,400}$/.test(ticket) ? ticket : null} mainUrl={settings.beta.mainUrl} />
      </div>
    </main>
  );
}
