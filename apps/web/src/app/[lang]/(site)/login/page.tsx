import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { localePath } from '@chfree/shared';
import { LoginForm } from '@/components/start/login-form';
import { getDict, resolveLang } from '@/i18n';
import { getCurrentUser } from '@/lib/api/server';
import { pageMetadata } from '@/lib/seo';
import { site } from '@/lib/site';
import { getSite } from '@/lib/site-settings';
import { Alert } from '@/components/ui/primitives';

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  const t = getDict(lang).login;
  return pageMetadata(lang, 'login', { title: t.metaTitle, description: t.metaDescription });
}

export default async function LoginPage({ params, searchParams }: Props) {
  const lang = await resolveLang(params);
  const d = getDict(lang);
  const t = d.login;
  const query = await searchParams;
  if (await getCurrentUser()) redirect(localePath(lang, 'myServers'));
  const settings = await getSite();
  return (
    <div className="container-page py-14 sm:py-20">
      {settings.maintenance.enabled && (
        <Alert tone="info" className="mx-auto mb-5 max-w-md">
          {t.maintenanceNote}
        </Alert>
      )}
      <div className="surface mx-auto max-w-md p-7 sm:p-9">
        <LoginForm
          discord={settings.discord.signup}
          twoFactor={query.tf && (query.m === 'password' || query.m === 'totp') ? { method: query.m, ticket: query.tf } : undefined}
          error={query.discord ? d.discord.results[query.discord] : undefined}
        />
        <div className="mt-8 space-y-1.5 border-t border-line pt-5 text-[13px] text-subtle">
          <p>
            {t.noServer}{' '}
            <Link href={localePath(lang, 'start')} className="text-gray-300 hover:text-white">
              {t.createFree}
            </Link>
          </p>
          <p>
            {t.manage}{' '}
            <a href={site.panelUrl} target="_blank" rel="noopener" className="text-gray-300 hover:text-white">
              {t.openPanel}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
