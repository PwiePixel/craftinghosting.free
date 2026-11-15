'use client';

import { useEffect } from 'react';
import { CubeMark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { useDict } from '@/i18n/client';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useDict();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <CubeMark className="size-12" />
      <h1 className="mt-6 text-2xl font-semibold text-white sm:text-3xl">{t.error.title}</h1>
      <p className="mt-3 max-w-md text-muted">{error.message || t.error.text}</p>
      <Button className="mt-8" onClick={reset}>
        {t.error.retry}
      </Button>
    </main>
  );
}
