'use client';

import { useState } from 'react';
import { loginLinkSchema, type TwoFactorMethod } from '@chfree/shared';
import { DiscordIcon } from '@/components/discord/discord-note';
import { Button } from '@/components/ui/button';
import { Alert, Field } from '@/components/ui/primitives';
import { api } from '@/lib/api/client';
import { useDict, useLang } from '@/i18n/client';
import { useForm } from '@/lib/use-form';
import { VerifyFlow } from './verify-flow';

export function LoginForm({ discord = false, twoFactor, error }: { /** Anmeldung über Discord anbieten */ discord?: boolean; twoFactor?: { method: TwoFactorMethod; ticket: string }; error?: { title: string; text: string } }) {
  const t = useDict().login;
  const lang = useLang();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const form = useForm(loginLinkSchema);

  // Nach dem Absenden: Code eingeben (und, falls eingerichtet, die zweite Stufe)
  if (sent) return <VerifyFlow embedded email={email.trim().toLowerCase()} onBack={() => setSent(false)} />;
  // Zurück von Discord mit eingeschalteter zweiter Stufe: Passwort bzw. App-Code eingeben
  if (twoFactor) return <VerifyFlow embedded twoFactor={twoFactor} />;

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void form.submit({ email }, async (data) => {
          await api('/auth/login-code', { body: data });
          setSent(true);
        });
      }}
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t.title}</h1>
        <p className="mt-2 leading-relaxed text-muted">{discord ? t.discordIntro : t.intro}</p>
      </div>
      {error && (
        <Alert tone="warning" title={error.title}>
          {error.text}
        </Alert>
      )}
      {discord && (
        <>
          {/* Normaler Link: Die API leitet zu Discord weiter und danach zurück */}
          <a href={`/api/v1/discord/login?lang=${lang}`} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#5865f2] px-6 text-base font-medium text-white hover:bg-[#6b76f5]">
            <DiscordIcon className="size-5" /> {t.discordButton}
          </a>
          <div className="flex items-center gap-3 text-[13px] text-subtle">
            <span className="h-px flex-1 bg-line" />
            {t.orEmail}
            <span className="h-px flex-1 bg-line" />
          </div>
          <p className="text-sm leading-relaxed text-muted">{t.emailIntro}</p>
        </>
      )}
      {form.error && <Alert tone="error">{form.error}</Alert>}
      <Field label={t.email} htmlFor="email" error={form.fieldErrors.email}>
        <input id="email" type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!discord} />
      </Field>
      <Button type="submit" size="lg" variant={discord ? 'secondary' : 'primary'} loading={form.pending} className="w-full">
        {t.submit}
      </Button>
    </form>
  );
}
