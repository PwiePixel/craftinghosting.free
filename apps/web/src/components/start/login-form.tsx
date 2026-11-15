'use client';

import { useState } from 'react';
import { MailCheck } from 'lucide-react';
import { loginLinkSchema } from '@chfree/shared';
import { Button } from '@/components/ui/button';
import { Alert, Field } from '@/components/ui/primitives';
import { api } from '@/lib/api/client';
import { useDict } from '@/i18n/client';
import { useForm } from '@/lib/use-form';

export function LoginForm() {
  const t = useDict().login;
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const form = useForm(loginLinkSchema);

  if (sent) {
    return (
      <div>
        <span className="flex size-11 items-center justify-center rounded-full bg-blue-500/15">
          <MailCheck className="size-5 text-blue-400" aria-hidden />
        </span>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-white">{t.sentTitle}</h1>
        <p className="mt-2 leading-relaxed text-muted">
          {t.sentBefore}
          <span className="text-white">{email.trim().toLowerCase()}</span>
          {t.sentAfter}
        </p>
        <Button variant="ghost" className="mt-6 -ml-5" onClick={() => setSent(false)}>
          {t.otherEmail}
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void form.submit({ email }, async (data) => {
          await api('/auth/login-link', { body: data });
          setSent(true);
        });
      }}
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t.title}</h1>
        <p className="mt-2 leading-relaxed text-muted">{t.intro}</p>
      </div>
      {form.error && <Alert tone="error">{form.error}</Alert>}
      <Field label={t.email} htmlFor="email" error={form.fieldErrors.email}>
        <input id="email" type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </Field>
      <Button type="submit" size="lg" loading={form.pending} className="w-full">
        {t.submit}
      </Button>
    </form>
  );
}
