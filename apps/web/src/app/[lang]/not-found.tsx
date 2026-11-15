'use client';

import { localePath } from '@chfree/shared';
import { CubeMark } from '@/components/brand/logo';
import { ButtonLink } from '@/components/ui/button';
import { useDict, useLang } from '@/i18n/client';

export default function NotFound() {
  const lang = useLang();
  const t = useDict();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <CubeMark className="size-14" />
      <p className="mt-6 font-mono text-sm text-blue-400">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{t.notFound.title}</h1>
      <p className="mt-3 max-w-md text-muted">{t.notFound.text}</p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <ButtonLink href={localePath(lang, 'home')}>{t.notFound.home}</ButtonLink>
        <ButtonLink href={localePath(lang, 'myServers')} variant="secondary">
          {t.common.myServers}
        </ButtonLink>
      </div>
    </main>
  );
}
