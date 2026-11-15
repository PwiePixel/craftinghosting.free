'use client';

import { useEffect, useRef, useState } from 'react';
import { CircleX, FlaskConical, Loader2 } from 'lucide-react';
import { Button, ButtonLink } from '@/components/ui/button';
import { useDict } from '@/i18n/client';
import { api, ApiClientError } from '@/lib/api/client';

/** Beta-Instanz: löst das Einmal-Ticket von der Hauptseite ein. Die API prüft dabei den Beta-Zugang erneut. */
export function BetaAccess({ ticket, mainUrl }: { ticket: string | null; mainUrl: string | null }) {
  const t = useDict().beta;
  const [failed, setFailed] = useState<'expired' | 'denied' | null>(ticket ? null : 'expired');
  const started = useRef(false);

  useEffect(() => {
    if (!ticket || started.current) return;
    started.current = true;
    api('/beta/session', { body: { ticket } })
      // Ganze Seite neu laden: ab jetzt gilt die Sitzung der Beta-Instanz
      .then(() => window.location.replace('/'))
      .catch((err) => setFailed(err instanceof ApiClientError && err.status === 403 ? 'denied' : 'expired'));
  }, [ticket]);

  if (!failed) {
    return (
      <p className="flex items-center justify-center gap-3 text-lg text-muted" role="status">
        <Loader2 className="size-5 animate-spin text-blue-400" aria-hidden /> {t.checking}
      </p>
    );
  }
  return (
    <div className="text-center">
      <CircleX className="mx-auto size-10 text-red-400" aria-hidden />
      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-white">{failed === 'denied' ? t.gateTitle : t.expiredTitle}</h1>
      <p className="mt-4 leading-relaxed text-muted">{failed === 'denied' ? t.gateText : t.expiredText}</p>
      {mainUrl && (
        <ButtonLink href={mainUrl} external size="lg" className="mt-8">
          {t.toMain}
        </ButtonLink>
      )}
    </div>
  );
}

/** Hauptseite: Wechsel auf die Beta-Instanz bestätigen. Die API prüft den Beta-Zugang und stellt ein Einmal-Ticket aus. */
export function BetaEnterButton() {
  const t = useDict().beta;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Button
        size="lg"
        loading={pending}
        icon={<FlaskConical />}
        onClick={() => {
          setPending(true);
          setError(null);
          api<{ url: string }>('/beta/enter', { body: {} })
            .then((res) => window.location.assign(res.url))
            .catch((err) => {
              setError(err instanceof ApiClientError ? err.message : 'Error');
              setPending(false);
            });
        }}
      >
        {t.confirmButton}
      </Button>
      {error && (
        <p className="mt-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
