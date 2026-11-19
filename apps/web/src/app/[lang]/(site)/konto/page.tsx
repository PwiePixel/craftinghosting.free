import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { localePath, type DiscordMeDTO, type SecurityDTO } from '@chfree/shared';
import { AccountActions } from '@/components/my/client-bits';
import { DiscordCard } from '@/components/my/discord-card';
import { EmailCard } from '@/components/my/email-card';
import { SecurityCard } from '@/components/my/security-card';
import { Alert } from '@/components/ui/primitives';
import { getDict, resolveLang } from '@/i18n';
import { apiServer, requireUser } from '@/lib/api/server';
import { pageMetadata } from '@/lib/seo';
import { getSite } from '@/lib/site-settings';

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  return pageMetadata(lang, 'account', { title: getDict(lang).account.metaTitle, noIndex: true });
}

export const dynamic = 'force-dynamic';

/** Konto: Anmeldung, E-Mail-Adresse, Discord, Sicherheit, Konto löschen – getrennt von „Meine Server“ */
export default async function AccountPage({ params, searchParams }: Props) {
  const lang = await resolveLang(params);
  const d = getDict(lang);
  const query = await searchParams;
  const { user } = await requireUser(lang, 'account');
  const settings = await getSite();
  const [discordRes, securityRes] = await Promise.all([
    settings.discord.available ? apiServer<{ discord: DiscordMeDTO }>('/discord/me', lang) : null,
    apiServer<{ security: SecurityDTO }>('/account/security', lang),
  ]);
  const discordMe = discordRes?.ok ? discordRes.data.discord : null;
  const security = securityRes.ok ? securityRes.data.security : null;
  const discordResult = query.discord ? d.discord.results[query.discord] : undefined;

  return (
    <div className="container-page py-12 sm:py-16">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.02em] text-white">{d.account.title}</h1>
            <p className="mt-2 text-sm text-muted">
              {user.email}
              {user.panelUsername && (
                <span className="text-subtle">
                  {' '}
                  · {d.my.panelUser} {user.panelUsername}
                </span>
              )}
            </p>
            <p className="mt-2 max-w-xl text-sm text-subtle">{d.account.intro}</p>
          </div>
          <Link href={localePath(lang, 'myServers')} className="inline-flex shrink-0 items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300">
            {d.account.toServers} <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>

        <div className="mt-8 space-y-5">
          {discordResult && (
            <Alert tone={discordResult.ok ? 'success' : 'warning'} title={discordResult.title}>
              {discordResult.text}
            </Alert>
          )}
          {discordMe?.available && (
            <DiscordCard
              me={discordMe}
              lang={lang}
              inviteUrl={settings.discord.inviteUrl}
              autoJoin={settings.discord.autoJoin}
              note={settings.discord.note[lang] || settings.discord.note[lang === 'de' ? 'en' : 'de']}
              waiting={false}
              back="account"
            />
          )}
          <EmailCard user={user} discordUrl={settings.discord.inviteUrl ?? settings.brand.discordUrl ?? null} />
          {security && <SecurityCard security={security} />}
          <AccountActions email={user.email} user={user} />
        </div>
      </div>
    </div>
  );
}
