'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, CircleX, KeyRound, LoaderCircle, MailCheck, ShieldCheck } from 'lucide-react';
import { localePath, type TwoFactorMethod, type VerifyResponse, type VerifyResult, type WaitlistInfo } from '@chfree/shared';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert, Field } from '@/components/ui/primitives';
import { useDict, useLang } from '@/i18n/client';
import { api, ApiClientError } from '@/lib/api/client';
import { PanelSetupForm } from './panel-setup-form';

type State =
  | { kind: 'loading' }
  | { kind: 'code' }
  | { kind: 'twoFactor'; method: TwoFactorMethod; ticket: string }
  | { kind: 'error'; message: string }
  | { kind: 'setup'; email: string }
  | { kind: 'done'; email: string; panelUrl: string; existing: boolean }
  | { kind: 'waitlist'; waitlist: WaitlistInfo };

export function DoneCard({ email, panelUrl, existing }: { email: string; panelUrl: string; existing: boolean }) {
  const lang = useLang();
  const t = useDict();
  const v = t.verify;
  return (
    <div>
      <ol className="space-y-3 text-sm">
        {v.doneSteps(existing).map((step, i) => (
          <li key={step} className="flex items-center gap-3 text-gray-200">
            <span className={i < 2 ? 'flex size-5 items-center justify-center rounded-full bg-emerald-400/15' : 'flex size-5 items-center justify-center'}>
              {i < 2 ? <Check className="size-3 text-emerald-400" strokeWidth={3} /> : <LoaderCircle className="size-4 animate-spin text-blue-400" />}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <div className="mt-7 rounded-lg border border-line bg-background p-5">
        <p className="text-sm font-medium text-white">{v.loginTitle}</p>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-subtle">{v.loginPanel}</dt>
            <dd className="font-mono text-gray-200">{panelUrl.replace(/^https?:\/\//, '')}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-subtle">{v.loginEmail}</dt>
            <dd className="break-all text-gray-200">{email}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-subtle">{v.loginPassword}</dt>
            <dd className="text-gray-200">{existing ? v.passwordExisting : v.passwordNew}</dd>
          </div>
        </dl>
      </div>
      <p className="mt-4 text-[13px] leading-relaxed text-subtle">{v.doneHint}</p>
      <div className="mt-7 flex flex-col gap-3 sm:flex-row">
        <ButtonLink href={panelUrl} external size="lg" className="sm:flex-1">
          {t.common.toPanel} <ArrowUpRight aria-hidden />
        </ButtonLink>
        <ButtonLink href={localePath(lang, 'myServers')} variant="secondary" size="lg">
          {t.common.myServers}
        </ButtonLink>
      </div>
    </div>
  );
}

const RESEND_SECONDS = 45;
const fieldError = (err: unknown, key: string) => (err instanceof ApiClientError ? (err.fields?.[key] ?? err.message) : null);

/** Eingabe des sechsstelligen Codes aus der E-Mail. Ohne bekannte Adresse wird sie mit abgefragt. */
function CodeStep({ email: knownEmail, onResult, onBack }: { email?: string; onResult: (res: VerifyResponse) => void; onBack?: () => void }) {
  const dict = useDict();
  const a = dict.auth;
  const emailLabel = dict.login.email;
  const [email, setEmail] = useState(knownEmail ?? '');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [wait, setWait] = useState(knownEmail ? RESEND_SECONDS : 0);
  const digits = code.replace(/\D/g, '');

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const submit = useCallback(
    async (value: string) => {
      if (pending || value.length !== 6 || !email.trim()) return;
      setPending(true);
      setError(null);
      try {
        onResult(await api<VerifyResponse>('/auth/verify', { body: { email: email.trim().toLowerCase(), code: value } }));
      } catch (err) {
        setError(fieldError(err, 'code') ?? a.codeHint);
        setCode('');
      } finally {
        setPending(false);
      }
    },
    [pending, email, onResult, a.codeHint],
  );

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit(digits);
      }}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-blue-500/15">
        <MailCheck className="size-5 text-blue-400" aria-hidden />
      </span>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-white">{a.codeTitle}</h1>
      <p className="mt-2 leading-relaxed text-muted">
        {knownEmail ? (
          <>
            {a.codeTextBefore}
            <span className="text-white">{knownEmail}</span>
            {a.codeTextAfter}
          </>
        ) : (
          a.codeTextNoEmail
        )}
      </p>
      <div className="mt-6 space-y-5">
        {error && <Alert tone="error">{error}</Alert>}
        {info && !error && <Alert tone="success">{info}</Alert>}
        {!knownEmail && (
          <Field label={emailLabel} htmlFor="verify-email">
            <input id="verify-email" type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        )}
        <Field label={a.codeLabel} htmlFor="verify-code" hint={a.codeHint}>
          <input
            id="verify-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            autoFocus={!!knownEmail}
            className="input h-14 text-center font-mono text-2xl tracking-[0.4em]"
            placeholder="••••••"
            value={code}
            onChange={(e) => {
              const next = e.target.value.replace(/[^\d ]/g, '');
              setCode(next);
              // Vollständig eingegeben (oder eingefügt) → gleich prüfen
              const d = next.replace(/\D/g, '');
              if (d.length === 6) void submit(d);
            }}
          />
        </Field>
        <Button type="submit" size="lg" loading={pending} disabled={digits.length !== 6 || !email.trim()} className="w-full">
          {a.codeSubmit}
        </Button>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <button
          type="button"
          disabled={wait > 0 || !email.trim()}
          className="text-blue-400 hover:text-blue-300 disabled:text-subtle"
          onClick={async () => {
            setError(null);
            setInfo(null);
            try {
              await api('/auth/login-code', { body: { email: email.trim().toLowerCase() } });
              setInfo(a.resent);
              setWait(RESEND_SECONDS);
            } catch (err) {
              setError(err instanceof ApiClientError ? err.message : a.codeSpam);
            }
          }}
        >
          {wait > 0 ? a.resendIn(wait) : a.resend}
        </button>
        {onBack && (
          <button type="button" className="inline-flex items-center gap-1.5 text-muted hover:text-white" onClick={onBack}>
            <ArrowLeft className="size-4" aria-hidden /> {a.otherEmail}
          </button>
        )}
      </div>
      <p className="mt-3 text-[13px] text-subtle">{a.codeSpam}</p>
    </form>
  );
}

/** Zweite Stufe: Passwort oder Code aus der Authenticator-App – oder ein Wiederherstellungscode */
function TwoFactorStep({ method, ticket, onResult }: { method: TwoFactorMethod; ticket: string; onResult: (res: VerifyResult) => void }) {
  const a = useDict().auth;
  const [value, setValue] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPassword = method === 'password' && !recovery;

  return (
    <form
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending || !value.trim()) return;
        setPending(true);
        setError(null);
        try {
          const factor = recovery ? { recovery: value.trim() } : method === 'password' ? { password: value } : { code: value.replace(/\s/g, '') };
          onResult(await api<VerifyResult>('/auth/two-factor', { body: { ticket, ...factor } }));
        } catch (err) {
          setError(fieldError(err, recovery ? 'recovery' : method === 'password' ? 'password' : 'code') ?? a.lostAccess);
          setValue('');
        } finally {
          setPending(false);
        }
      }}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-blue-500/15">
        {method === 'password' ? <KeyRound className="size-5 text-blue-400" aria-hidden /> : <ShieldCheck className="size-5 text-blue-400" aria-hidden />}
      </span>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-white">{a.twoFactorTitle}</h1>
      <p className="mt-2 leading-relaxed text-muted">{method === 'password' ? a.passwordText : a.totpText}</p>
      <div className="mt-6 space-y-5">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={recovery ? a.recoveryLabel : method === 'password' ? a.passwordLabel : a.totpLabel} htmlFor="second-factor" hint={recovery ? a.recoveryHint : undefined}>
          <input
            id="second-factor"
            key={recovery ? 'recovery' : method}
            type={isPassword ? 'password' : 'text'}
            inputMode={!recovery && method === 'totp' ? 'numeric' : undefined}
            autoComplete={isPassword ? 'current-password' : 'one-time-code'}
            autoFocus
            className={isPassword ? 'input' : 'input h-12 text-center font-mono text-xl tracking-[0.25em]'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <Button type="submit" size="lg" loading={pending} disabled={!value.trim()} className="w-full">
          {a.twoFactorSubmit}
        </Button>
      </div>
      <div className="mt-6 space-y-2 text-sm">
        <button
          type="button"
          className="text-blue-400 hover:text-blue-300"
          onClick={() => {
            setRecovery((r) => !r);
            setValue('');
            setError(null);
          }}
        >
          {recovery ? a.useNormal : a.useRecovery}
        </button>
        <p className="text-[13px] text-subtle">{a.lostAccess}</p>
      </div>
    </form>
  );
}

/**
 * Bestätigung und Anmeldung: Code aus der E-Mail → (falls eingerichtet) zweite Stufe → nächster Schritt.
 * `embedded` = ohne eigenen Rahmen (z. B. innerhalb des Anmelde- oder Bestellformulars).
 * Links aus älteren E-Mails (`token`) funktionieren bis zu ihrem Ablauf weiter.
 */
export function VerifyFlow({ token, email, embedded = false, onBack }: { token?: string; email?: string; embedded?: boolean; onBack?: () => void }) {
  const router = useRouter();
  const lang = useLang();
  const t = useDict();
  const v = t.verify;
  const [state, setState] = useState<State>(token ? { kind: 'loading' } : { kind: 'code' });
  const started = useRef(false);

  const handle = useCallback(
    (res: VerifyResponse) => {
      if ('twoFactor' in res) return setState({ kind: 'twoFactor', method: res.twoFactor.method, ticket: res.twoFactor.ticket });
      if (res.next === 'overview') {
        router.replace(localePath(lang, 'myServers'));
        router.refresh();
      } else if (res.next === 'waitlist' && res.waitlist) {
        setState({ kind: 'waitlist', waitlist: res.waitlist });
      } else if (res.next === 'panel_setup') {
        setState({ kind: 'setup', email: res.user.email });
      } else {
        setState({ kind: 'done', email: res.user.email, panelUrl: res.panelUrl, existing: res.existingPanelAccount });
      }
    },
    [router, lang],
  );

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api<VerifyResponse>('/auth/verify', { body: { token } })
      .then(handle)
      .catch((err) => setState({ kind: 'error', message: err instanceof ApiClientError ? err.message : v.failed }));
  }, [token, handle, v.failed]);

  return (
    <div className={embedded ? undefined : 'surface mx-auto max-w-lg p-7 sm:p-9'}>
      {state.kind === 'code' && <CodeStep email={email} onResult={handle} onBack={onBack} />}
      {state.kind === 'twoFactor' && <TwoFactorStep method={state.method} ticket={state.ticket} onResult={handle} />}

      {state.kind === 'loading' && (
        <div className="flex flex-col items-center py-10 text-center">
          <LoaderCircle className="size-8 animate-spin text-blue-400" aria-hidden />
          <p className="mt-4 text-muted">{v.checking}</p>
        </div>
      )}

      {state.kind === 'error' && (
        <div>
          <CircleX className="size-8 text-red-400" aria-hidden />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white">{v.invalidTitle}</h1>
          <p className="mt-2 text-muted">{state.message}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <ButtonLink href={localePath(lang, 'login')}>{v.requestNew}</ButtonLink>
            <ButtonLink href={localePath(lang, 'start')} variant="secondary">
              {t.common.createServer}
            </ButtonLink>
          </div>
        </div>
      )}

      {state.kind === 'setup' && (
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-300">
            <Check className="size-4" aria-hidden /> {v.confirmed}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white">{v.setupTitle}</h1>
          <p className="mt-2 leading-relaxed text-muted">{v.setupText}</p>
          <div className="mt-7">
            <PanelSetupForm
              email={state.email}
              onDone={(r) => setState({ kind: 'done', email: state.email, panelUrl: r.panelUrl, existing: r.existingPanelAccount })}
            />
          </div>
        </div>
      )}

      {state.kind === 'done' && (
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{v.doneTitle}</h1>
          <p className="mt-2 text-muted">{v.doneText}</p>
          <div className="mt-7">
            <DoneCard email={state.email} panelUrl={state.panelUrl} existing={state.existing} />
          </div>
        </div>
      )}

      {state.kind === 'waitlist' && (
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-300">
            <Check className="size-4" aria-hidden /> {v.confirmed}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white">{t.early.verifyTitle}</h1>
          <p className="mt-2 leading-relaxed text-muted">{t.early.verifyText}</p>
          <dl className="mt-7 grid grid-cols-2 gap-4 rounded-lg border border-line bg-background p-5">
            <div>
              <dt className="text-[13px] text-subtle">{t.early.positionLabel}</dt>
              <dd className="mt-0.5 text-2xl font-semibold text-white">#{state.waitlist.position}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-subtle">{t.early.hardwareLabel}</dt>
              <dd className="mt-0.5 text-base font-semibold text-white">{t.early.tiers[state.waitlist.tier]}</dd>
            </div>
          </dl>
          <p className="mt-4 text-[13px] leading-relaxed text-subtle">{t.early.tierNote[state.waitlist.tier]}</p>
          <div className="mt-7">
            <ButtonLink href={localePath(lang, 'myServers')} size="lg">
              {t.common.myServers}
            </ButtonLink>
          </div>
        </div>
      )}

      {state.kind !== 'loading' && state.kind !== 'done' && state.kind !== 'waitlist' && (
        <p className="mt-8 border-t border-line pt-5 text-[13px] text-subtle">
          {v.problems}{' '}
          <Link href={localePath(lang, 'faq')} className="text-gray-300 hover:text-white">
            FAQ
          </Link>
          {v.problemsAfter}
        </p>
      )}
    </div>
  );
}
