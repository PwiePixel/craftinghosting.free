'use client';

/**
 * Kündigungsformular für Abos – ohne Anmeldung erreichbar („Verträge hier kündigen“).
 * Die Antwort ist immer dieselbe: Sie verrät nicht, ob es zu einer Adresse ein Konto gibt. Die Bestätigung mit
 * Zeitpunkt und Ende der Laufzeit kommt per E-Mail an das Konto.
 */
import { useState } from 'react';
import { MailCheck } from 'lucide-react';
import { formatDateTime, freeHostingConfig } from '@chfree/shared';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/primitives';
import { useDict, useLang } from '@/i18n/client';
import { api, ApiClientError } from '@/lib/api/client';

export function CancelSubscriptionForm() {
  const lang = useLang();
  const t = useDict().extras.cancelPage;
  const [email, setEmail] = useState('');
  const [ref, setRef] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneAt, setDoneAt] = useState<Date | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await api('/payments/cancel-subscription', { body: { email: email.trim(), ...(ref.trim() ? { ref: ref.trim() } : {}) } });
      setDoneAt(new Date());
    } catch (err) {
      const e = err as ApiClientError;
      setError(e.fields?.email ?? (e.status === 429 || e.status === 400 ? e.message : t.error));
    } finally {
      setPending(false);
    }
  }

  if (doneAt) {
    return (
      <div className="flex gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.07] p-5" role="status">
        <MailCheck className="mt-0.5 size-5 shrink-0 text-emerald-400" aria-hidden />
        <div>
          <p className="font-medium text-white">{t.doneTitle}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">{t.doneText(formatDateTime(doneAt, freeHostingConfig.fairUse.timezone, lang))}</p>
        </div>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div>
        <label htmlFor="cancel-email" className="block text-sm font-medium text-gray-100">
          {t.email}
        </label>
        <input id="cancel-email" type="email" autoComplete="email" required className="input mt-1.5" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label htmlFor="cancel-ref" className="block text-sm font-medium text-gray-100">
          {t.ref}
        </label>
        <input id="cancel-ref" type="text" className="input mt-1.5 font-mono" value={ref} maxLength={20} placeholder="CH-" onChange={(e) => setRef(e.target.value.toUpperCase())} />
        <p className="mt-1.5 text-[13px] text-subtle">{t.refHint}</p>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-100">{t.kind}</p>
        <p className="mt-1 text-sm text-muted">{t.kindValue}</p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" size="lg" loading={pending} disabled={!email.trim()}>
        {t.submit}
      </Button>
    </form>
  );
}
