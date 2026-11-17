'use client';

import { useState } from 'react';
import { localePath, loginLinkSchema, type TwoFactorMethod, type VerifyResponse } from '@chfree/shared';
import { DiscordIcon } from '@/components/discord/discord-note';
import { Button } from '@/components/ui/button';
import { Alert, Field } from '@/components/ui/primitives';
import { api, ApiClientError } from '@/lib/api/client';
import { useDict, useLang } from '@/i18n/client';
import { useForm } from '@/lib/use-form';
import { VerifyFlow } from './verify-flow';

export function LoginForm({ discord = false, twoFactor, error }: { /** Anmeldung über Discord anbieten */ discord?: boolean; twoFactor?: { method: TwoFactorMethod; ticket: string }; error?: { title: string; text: string } }) {
  const t = useDict().login;
  const lang = useLang();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  // Zweite Stufe nach der Anmeldung mit Passwort
  const [second, setSecond] = useState<{ method: TwoFactorMethod; ticket: string } | null>(null);
  const form = useForm(loginLinkSchema);

  // Nach dem Absenden: Code eingeben (und, falls eingerichtet, die zweite Stufe)
  if (sent) return <VerifyFlow embedded email={email.trim().toLowerCase()} onBack={() => setSent(false)} />;
  // Zurück von Discord mit eingeschalteter zweiter Stufe: Passwort bzw. App-Code eingeben
  if (twoFactor ?? second) return <VerifyFlow embedded twoFactor={(twoFactor ?? second)!} />;

  async function passwordLogin() {
    setBusy(true);
    setLoginError(null);
    try {
      const res = await api<VerifyResponse>('/auth/password-login', { body: { email: email.trim().toLowerCase(), password } });
      if ('twoFactor' in res) return setSecond(res.twoFactor);
      // Offene Schritte (Discord verbinden, Panel-Zugang) zeigt die Startseite, sonst geht es zu „Meine Server“
      // (mit `?next=…` zurück zu der Seite, von der man kam – nur Pfade dieser Website)
      const wanted = new URLSearchParams(window.location.search).get('next');
      const target = wanted && /^\/(?![/\\])[^\s\\]*$/.test(wanted) ? wanted : localePath(lang, 'myServers');
      window.location.assign(res.next === 'overview' ? target : `${localePath(lang, 'start')}?resume=1`);
    } catch (err) {
      setLoginError(err instanceof ApiClientError ? err.message : t.passwordSubmit);
      setBusy(false);
    }
  }

  const sendCode = () =>
    form.submit({ email }, async (data) => {
      setLoginError(null);
      await api('/auth/login-code', { body: data });
      setSent(true);
    });

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        // Mit Passwort: direkt anmelden. Ohne: Code per E-Mail
        if (password) return void passwordLogin();
        void sendCode();
      }}
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t.title}</h1>
        <p className="mt-2 leading-relaxed text-muted">{discord ? t.discordIntro : t.passwordIntro}</p>
      </div>
      {error && (
        <Alert tone="warning" title={error.title}>
          {error.text}
        </Alert>
      )}
      {(loginError ?? form.error) && <Alert tone="error">{loginError ?? form.error}</Alert>}
      <Field label={t.email} htmlFor="email" error={form.fieldErrors.email}>
        <input id="email" type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </Field>
      <Field label={t.password} htmlFor="login-password">
        <input id="login-password" type="password" autoComplete="current-password" className="input" value={password} maxLength={200} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" size="lg" loading={busy || (form.pending && !!password)} disabled={!email.trim() || !password} className="w-full">
        {t.passwordSubmit}
      </Button>
      <button type="button" className="block w-full text-center text-sm text-blue-400 hover:text-blue-300 disabled:text-subtle" disabled={form.pending || busy} onClick={() => void sendCode()}>
        {t.codeInstead}
      </button>
      {discord && (
        <>
          <div className="flex items-center gap-3 text-[13px] text-subtle">
            <span className="h-px flex-1 bg-line" />
            {t.orEmail}
            <span className="h-px flex-1 bg-line" />
          </div>
          {/* Für Konten mit verbundenem Discord-Konto. Normaler Link: Die API leitet zu Discord weiter und danach zurück */}
          <a href={`/api/v1/discord/login?lang=${lang}`} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-[#5865f2]/60 px-6 text-base font-medium text-white hover:bg-[#5865f2]/15">
            <DiscordIcon className="size-5" /> {t.discordButton}
          </a>
        </>
      )}
    </form>
  );
}
