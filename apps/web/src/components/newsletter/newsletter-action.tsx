'use client';

import { useEffect, useRef, useState } from 'react';
import { CircleCheck, CircleX, Loader2 } from 'lucide-react';
import { localePath } from '@chfree/shared';
import { ButtonLink } from '@/components/ui/button';
import { useDict, useLang } from '@/i18n/client';
import { api } from '@/lib/api/client';
import { NewsletterForm } from './newsletter-form';

/** Löst einen Link aus einer Newsletter-Mail ein: Anmeldung bestätigen oder abmelden. */
export function NewsletterAction({ action, token }: { action: 'confirm' | 'unsubscribe'; token: string }) {
  const lang = useLang();
  const t = useDict().newsletter;
  const [state, setState] = useState<{ status: 'working' } | { status: 'done'; email: string } | { status: 'failed' }>({ status: 'working' });
  const started = useRef(false);

  useEffect(() => {
    // Nur einmal einlösen (React ruft Effekte in der Entwicklung doppelt auf)
    if (started.current) return;
    started.current = true;
    api<{ email: string }>(`/newsletter/${action}`, { body: { token } })
      .then((res) => setState({ status: 'done', email: res.email }))
      .catch(() => setState({ status: 'failed' }));
  }, [action, token]);

  if (state.status === 'working') {
    return (
      <p className="flex items-center gap-3 text-muted" role="status">
        <Loader2 className="size-5 animate-spin text-blue-400" aria-hidden /> {t.working}
      </p>
    );
  }
  if (state.status === 'failed') {
    return (
      <div>
        <CircleX className="size-9 text-red-400" aria-hidden />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white">{t.invalidTitle}</h1>
        <p className="mt-3 leading-relaxed text-muted">{t.invalidText}</p>
        <div className="mt-7">
          <NewsletterForm id="newsletter-retry" />
        </div>
      </div>
    );
  }
  const confirmed = action === 'confirm';
  return (
    <div>
      <CircleCheck className="size-9 text-emerald-400" aria-hidden />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white">{confirmed ? t.confirmedTitle : t.unsubscribedTitle}</h1>
      <p className="mt-3 leading-relaxed text-muted">{confirmed ? t.confirmedText(state.email) : t.unsubscribedText(state.email)}</p>
      <ButtonLink href={localePath(lang, 'home')} variant="secondary" className="mt-7">
        {t.backHome}
      </ButtonLink>
    </div>
  );
}
