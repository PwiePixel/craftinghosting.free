import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { localePath } from '@chfree/shared';
import { RegisterForm } from '@/components/start/register-form';
import { Alert } from '@/components/ui/primitives';
import { getDict, resolveLang } from '@/i18n';
import { getCurrentUser } from '@/lib/api/server';
import { pageMetadata } from '@/lib/seo';
import { getSite } from '@/lib/site-settings';

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  const t = getDict(lang).register;
  return pageMetadata(lang, 'register', { title: t.metaTitle, description: t.metaDescription });
}

/** Nur Pfade dieser Website – nie eine fremde Adresse */
const safeNext = (next: string | undefined, fallback: string) => (next && /^\/(?![/\\])[^\s\\]*$/.test(next) ? next : fallback);

export default async function RegisterPage({ params, searchParams }: Props) {
  const lang = await resolveLang(params);
  const t = getDict(lang).register;
  const query = await searchParams;
  // Nach der Registrierung geht es zu „Server erstellen“ – oder dorthin, woher man kam (z. B. mit gewähltem Paket)
  const next = safeNext(query.next, localePath(lang, 'start'));
  if (await getCurrentUser()) redirect(next);
  const settings = await getSite();
  const closed = settings.registration.mode === 'closed';
  const login = `${localePath(lang, 'login')}?next=${encodeURIComponent(next)}`;
  return (
    <div className="container-page py-14 sm:py-20">
      <div className="surface mx-auto max-w-md p-7 sm:p-9">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{closed ? t.closedTitle : t.title}</h1>
        <p className="mt-2 leading-relaxed text-muted">{closed ? t.closedText : next.includes('plan=') ? t.introPlan : t.intro}</p>
        {!closed && (
          <div className="mt-6">
            {settings.maintenance.enabled && (
              <Alert tone="info" className="mb-5">
                {getDict(lang).login.maintenanceNote}
              </Alert>
            )}
            <RegisterForm next={next} newsletterOption={settings.newsletter.signupCheckbox} />
            {settings.discord.available && <p className="mt-5 rounded-lg border border-[#5865f2]/40 bg-[#5865f2]/[0.08] p-4 text-[13px] leading-relaxed text-gray-200">{t.discordNote}</p>}
          </div>
        )}
        <p className="mt-8 border-t border-line pt-5 text-[13px] text-subtle">
          {t.haveAccount}{' '}
          <Link href={login} className="text-gray-300 hover:text-white">
            {t.signIn}
          </Link>
        </p>
      </div>
    </div>
  );
}
