'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MailCheck } from 'lucide-react';
import { localePath } from '@chfree/shared';
import { Button } from '@/components/ui/button';
import { useDict, useLang } from '@/i18n/client';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

/**
 * Newsletter-Anmeldung (Double-Opt-in): Die Adresse wird erst nach dem Klick auf den Bestätigungslink aktiv.
 * `compact` = schmale Variante für den Footer.
 */
export function NewsletterForm({ compact = false, id = 'newsletter-email' }: { compact?: boolean; id?: string }) {
  const lang = useLang();
  const t = useDict().newsletter;
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await api('/newsletter/subscribe', { body: { email } });
      setSentTo(email.trim().toLowerCase());
      setEmail('');
    } catch (err) {
      const e = err as ApiClientError;
      setError(e.fields?.email ?? e.message);
    } finally {
      setPending(false);
    }
  }

  if (sentTo) {
    return (
      <div className={cn('flex gap-3 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.07] p-3.5 text-sm', compact && 'max-w-sm')} role="status">
        <MailCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden />
        <p className="leading-relaxed text-muted">
          <span className="block font-medium text-white">{t.sentTitle}</span>
          {t.sentText(sentTo)}
        </p>
      </div>
    );
  }

  return (
    <form
      noValidate
      className={cn(compact && 'max-w-sm')}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={id} className={cn('block text-sm font-medium text-gray-100', compact && 'sr-only')}>
        {t.emailLabel}
      </label>
      <div className={cn('flex gap-2', !compact && 'mt-2')}>
        <input
          id={id}
          type="email"
          autoComplete="email"
          required
          className="input min-w-0 flex-1"
          placeholder={t.placeholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!error}
        />
        <Button type="submit" size={compact ? 'md' : 'md'} loading={pending} disabled={!email.trim()}>
          {t.submit}
        </Button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
      <p className={cn('mt-2 leading-relaxed text-subtle', compact ? 'text-xs' : 'text-[13px]')}>
        {t.privacyBefore}
        <Link href={localePath(lang, 'privacy')} className="underline underline-offset-4 hover:text-white">
          {t.privacyLink}
        </Link>
        {t.privacyAfter}
      </p>
    </form>
  );
}
