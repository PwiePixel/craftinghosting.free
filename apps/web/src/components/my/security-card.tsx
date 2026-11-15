'use client';

/**
 * „Meine Server“ → Sicherheit: freiwillige zweite Stufe bei der Anmeldung.
 * Standard ist der Code per E-Mail; zusätzlich lässt sich ein eigenes Passwort oder eine Authenticator-App einrichten.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { accountPasswordSchema, issueMessage, type SecurityDTO, type TotpSetupDTO } from '@chfree/shared';
import { Button } from '@/components/ui/button';
import { Alert, Field } from '@/components/ui/primitives';
import { useDict, useLang } from '@/i18n/client';
import { api, ApiClientError } from '@/lib/api/client';

type View = { kind: 'idle' } | { kind: 'password' } | { kind: 'totp'; setup: TotpSetupDTO } | { kind: 'recovery'; codes: string[] } | { kind: 'disable' };

export function SecurityCard({ security }: { security: SecurityDTO }) {
  const t = useDict().security;
  const lang = useLang();
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [copied, setCopied] = useState(false);

  const reset = (next: View = { kind: 'idle' }) => {
    setView(next);
    setA('');
    setB('');
    setError(null);
    setUseRecovery(false);
  };
  const fail = (err: unknown) => setError(err instanceof ApiClientError ? (Object.values(err.fields ?? {})[0] ?? err.message) : t.failed);

  /** Führt eine Aktion aus und zeigt Fehler im Formular */
  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      fail(err);
    } finally {
      setPending(false);
    }
  }

  const enablePassword = (e: FormEvent) => {
    e.preventDefault();
    if (a !== b) return setError(t.passwordMismatch);
    const check = accountPasswordSchema.safeParse({ password: a });
    if (!check.success) return setError(issueMessage(check.error.issues[0] ?? { message: '' }, lang));
    void run(async () => {
      const res = await api<{ recoveryCodes: string[] }>('/account/two-factor/password', { body: { password: a } });
      reset({ kind: 'recovery', codes: res.recoveryCodes });
    });
  };

  const startTotp = () =>
    run(async () => {
      const res = await api<{ setup: TotpSetupDTO }>('/account/two-factor/totp/setup', { body: {} });
      reset({ kind: 'totp', setup: res.setup });
    });

  const confirmTotp = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await api<{ recoveryCodes: string[] }>('/account/two-factor/totp/confirm', { body: { code: a.replace(/\s/g, '') } });
      reset({ kind: 'recovery', codes: res.recoveryCodes });
    });
  };

  const disable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const factor = useRecovery ? { recovery: a.trim() } : security.method === 'password' ? { password: a } : { code: a.replace(/\s/g, '') };
      await api('/account/two-factor/disable', { body: factor });
      reset();
      router.refresh();
    });
  };

  return (
    <div className="surface p-5">
      <div className="flex gap-3.5">
        <ShieldCheck className={security.method ? 'mt-0.5 size-5 shrink-0 text-emerald-400' : 'mt-0.5 size-5 shrink-0 text-muted'} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-white">{t.title}</p>

          {view.kind === 'idle' && (
            <>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">{security.method === 'password' ? t.onPassword : security.method === 'totp' ? t.onTotp : t.off}</p>
              {security.method && <p className="mt-1 text-[13px] text-subtle">{t.recoveryLeft(security.recoveryCodesLeft)}</p>}
              {error && (
                <Alert tone="error" className="mt-3">
                  {error}
                </Alert>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {security.method ? (
                  <Button variant="secondary" size="sm" onClick={() => reset({ kind: 'disable' })}>
                    {t.disable}
                  </Button>
                ) : (
                  <>
                    <Button variant="secondary" size="sm" icon={<KeyRound />} onClick={() => reset({ kind: 'password' })}>
                      {t.choosePassword}
                    </Button>
                    <Button variant="secondary" size="sm" icon={<Smartphone />} loading={pending} onClick={() => void startTotp()}>
                      {t.chooseTotp}
                    </Button>
                  </>
                )}
              </div>
            </>
          )}

          {view.kind === 'password' && (
            <form noValidate className="mt-3 max-w-md space-y-4" onSubmit={enablePassword}>
              <p className="text-sm leading-relaxed text-muted">{t.passwordText}</p>
              {error && <Alert tone="error">{error}</Alert>}
              <Field label={t.passwordLabel} htmlFor="sec-pw">
                <input id="sec-pw" type="password" autoComplete="new-password" className="input" value={a} onChange={(e) => setA(e.target.value)} autoFocus />
              </Field>
              <Field label={t.passwordRepeat} htmlFor="sec-pw2">
                <input id="sec-pw2" type="password" autoComplete="new-password" className="input" value={b} onChange={(e) => setB(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={pending} disabled={!a || !b}>
                  {t.enable}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => reset()}>
                  {t.cancel}
                </Button>
              </div>
            </form>
          )}

          {view.kind === 'totp' && (
            <form noValidate className="mt-3 space-y-4" onSubmit={confirmTotp}>
              <p className="max-w-xl text-sm leading-relaxed text-muted">{t.totpStep1}</p>
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                {/* eslint-disable-next-line @next/next/no-img-element -- QR-Code als eingebettetes Bild vom eigenen Server */}
                <img src={view.setup.qr} alt="QR-Code" width={176} height={176} className="size-44 shrink-0 rounded-lg bg-white p-2" />
                <div className="min-w-0 space-y-3 text-sm">
                  <a href={view.setup.uri} className="inline-block text-blue-400 hover:text-blue-300">
                    {t.totpOpenApp}
                  </a>
                  <p className="text-muted">{t.totpManual}</p>
                  <code className="block rounded-md border border-line bg-black/30 px-2.5 py-1.5 font-mono text-[13px] break-all text-gray-200">{view.setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                </div>
              </div>
              <p className="max-w-xl text-sm leading-relaxed text-muted">{t.totpStep2}</p>
              {error && <Alert tone="error">{error}</Alert>}
              <div className="flex max-w-md flex-wrap items-end gap-2">
                <div className="w-44">
                  <Field label={t.totpCode} htmlFor="sec-totp">
                    <input id="sec-totp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={7} className="input text-center font-mono text-lg tracking-[0.25em]" value={a} onChange={(e) => setA(e.target.value.replace(/[^\d ]/g, ''))} />
                  </Field>
                </div>
                <Button type="submit" size="sm" loading={pending} disabled={a.replace(/\D/g, '').length !== 6} className="mb-0.5">
                  {t.enable}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => reset()} className="mb-0.5">
                  {t.cancel}
                </Button>
              </div>
            </form>
          )}

          {view.kind === 'recovery' && (
            <div className="mt-3 space-y-4">
              <Alert tone="success" title={t.recoveryTitle}>
                {t.recoveryText}
              </Alert>
              <ul className="grid max-w-md grid-cols-2 gap-2 font-mono text-sm text-gray-100">
                {view.codes.map((c) => (
                  <li key={c} className="rounded-md border border-line bg-black/30 px-3 py-1.5 text-center">
                    {c}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(view.codes.join('\n')).then(() => setCopied(true));
                  }}
                >
                  {copied ? t.copied : t.copy}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    reset();
                    router.refresh();
                  }}
                >
                  {t.recoveryDone}
                </Button>
              </div>
            </div>
          )}

          {view.kind === 'disable' && (
            <form noValidate className="mt-3 max-w-md space-y-4" onSubmit={disable}>
              <p className="text-sm leading-relaxed text-muted">{t.disableText}</p>
              {error && <Alert tone="error">{error}</Alert>}
              <DisableInput method={security.method} recovery={useRecovery} value={a} onChange={setA} />
              <button type="button" className="block text-sm text-blue-400 hover:text-blue-300" onClick={() => (setUseRecovery((r) => !r), setA(''))}>
                {useRecovery ? <BackLabel /> : <RecoveryLabel />}
              </button>
              <div className="flex gap-2">
                <Button type="submit" variant="danger" size="sm" loading={pending} disabled={!a.trim()}>
                  {t.disableConfirm}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => reset()}>
                  {t.cancel}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function RecoveryLabel() {
  return <>{useDict().auth.useRecovery}</>;
}
function BackLabel() {
  return <>{useDict().auth.useNormal}</>;
}

function DisableInput({ method, recovery, value, onChange }: { method: SecurityDTO['method']; recovery: boolean; value: string; onChange: (v: string) => void }) {
  const a = useDict().auth;
  const password = method === 'password' && !recovery;
  return (
    <Field label={recovery ? a.recoveryLabel : method === 'password' ? a.passwordLabel : a.totpLabel} htmlFor="sec-disable">
      <input
        id="sec-disable"
        key={recovery ? 'r' : 'n'}
        type={password ? 'password' : 'text'}
        autoComplete={password ? 'current-password' : 'one-time-code'}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus
      />
    </Field>
  );
}
