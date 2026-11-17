'use client';

/**
 * „Meine Server“: E-Mail-Adresse bestätigen (freiwillig) oder ändern. Eine bestätigte Adresse ist die
 * Voraussetzung, um Partner zu werden.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Mail } from 'lucide-react';
import type { UserDTO } from '@chfree/shared';
import { Button, buttonClasses } from '@/components/ui/button';
import { useDict } from '@/i18n/client';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export function EmailCard({ user, discordUrl }: { user: UserDTO; discordUrl: string | null }) {
  const router = useRouter();
  const d = useDict();
  const t = d.my.email;
  const [mode, setMode] = useState<'idle' | 'code' | 'change'>('idle');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const status = user.emailVerified ? 'verified' : user.emailUndeliverable ? 'unreachable' : 'unverified';

  async function run(action: () => Promise<void>) {
    setPending(true);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiClientError ? err.message : d.verify.failed });
    } finally {
      setPending(false);
    }
  }
  const sendCode = () =>
    run(async () => {
      try {
        await api('/account/email/code', { body: {} });
        setMessage({ ok: true, text: t.sent });
      } catch (err) {
        // Gerade erst verschickt (z. B. bei der Registrierung): Der Code liegt schon im Postfach – Eingabe trotzdem zeigen
        if (!(err instanceof ApiClientError) || err.code !== 'cooldown') throw err;
        setMessage({ ok: true, text: err.message });
      }
      setMode('code');
    });
  const confirm = () =>
    run(async () => {
      await api('/account/email/verify', { body: { code: code.replace(/\D/g, '') } });
      setMode('idle');
      setCode('');
      setMessage({ ok: true, text: t.done });
      router.refresh();
    });
  const change = () =>
    run(async () => {
      await api('/account/email', { body: { email: email.trim().toLowerCase() } });
      setEmail('');
      setMode('code');
      setMessage({ ok: true, text: t.changed });
      router.refresh();
    });

  return (
    <section className="surface p-6" aria-label={t.title}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Mail className="size-4 text-subtle" aria-hidden />
        <h2 className="font-semibold text-white">{t.title}</h2>
        <span className="font-mono text-sm break-all text-gray-200">{user.email}</span>
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[11px] font-medium',
            status === 'verified' ? 'bg-emerald-500/15 text-emerald-300' : status === 'unreachable' ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-200',
          )}
        >
          {t[status]}
        </span>
      </div>
      <p className={cn('mt-2 max-w-2xl text-sm leading-relaxed', status === 'unreachable' ? 'text-red-200' : 'text-muted')}>{status === 'verified' ? t.verifiedText : status === 'unreachable' ? t.unreachableText : t.unverifiedText}</p>

      {mode === 'code' && !user.emailVerified && (
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <label className="block">
            <span className="mb-1.5 block text-[13px] text-subtle">{t.codeLabel}</span>
            <input className="input w-44 text-center font-mono text-lg tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} />
          </label>
          <Button type="submit" loading={pending} disabled={code.replace(/\D/g, '').length !== 6}>
            {t.confirm}
          </Button>
        </form>
      )}
      {mode === 'change' && (
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void change();
          }}
        >
          <label className="block sm:min-w-72">
            <span className="mb-1.5 block text-[13px] text-subtle">{t.newLabel}</span>
            <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <Button type="submit" loading={pending} disabled={!email.includes('@')}>
            {t.save}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setMode('idle')}>
            {t.cancel}
          </Button>
        </form>
      )}

      {message && <p className={cn('mt-3 text-sm', message.ok ? 'text-emerald-300' : 'text-red-300')}>{message.text}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {status === 'unverified' && mode !== 'change' && (
          <Button type="button" size="sm" variant="secondary" loading={pending && mode !== 'code'} disabled={pending} onClick={sendCode}>
            {t.send}
          </Button>
        )}
        {/* Ändern geht nur mit verknüpftem Discord-Konto – so bleibt die Anmeldung in jedem Fall möglich */}
        {mode !== 'change' && user.discord && (
          <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => { setMode('change'); setMessage(null); }}>
            {t.change}
          </Button>
        )}
        {status === 'verified' && discordUrl && (
          <a href={discordUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'sm')} title={t.partnerHint}>
            {t.partner}
          </a>
        )}
        {status === 'verified' && <span className="text-[13px] text-subtle">{t.partnerHint}</span>}
      </div>
    </section>
  );
}
