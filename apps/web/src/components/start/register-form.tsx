'use client';

/**
 * Registrieren: Konto mit E-Mail-Adresse und Passwort anlegen. Danach geht es angemeldet weiter – zur Seite aus
 * `next` (z. B. „Server erstellen“ mit dem zuvor gewählten Paket).
 */
import Link from 'next/link';
import { useState } from 'react';
import { localePath } from '@chfree/shared';
import { Button } from '@/components/ui/button';
import { Alert, Field } from '@/components/ui/primitives';
import { useDict, useLang } from '@/i18n/client';
import { api, ApiClientError } from '@/lib/api/client';

export function RegisterForm({ next, newsletterOption = false }: { /** Ziel nach der Registrierung (nur Pfade dieser Website) */ next: string; newsletterOption?: boolean }) {
  const lang = useLang();
  const d = useDict();
  const t = d.register;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accept, setAccept] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit() {
    const problems: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) problems.email = t.emailHint;
    if (password.length < 8) problems.password = t.passwordHint;
    if (!accept) problems.acceptTerms = t.acceptRequired;
    setFields(problems);
    setError(null);
    if (Object.keys(problems).length) return;
    setPending(true);
    try {
      await api('/auth/register', { body: { email: email.trim().toLowerCase(), password, acceptTerms: true, ...(newsletterOption && newsletter ? { newsletter: true } : {}) } });
      // Vollständiger Seitenwechsel: Die nächste Seite soll die neue Anmeldung sicher kennen
      window.location.assign(next);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFields(err.fields ?? {});
        setError(err.fields && Object.keys(err.fields).length ? null : err.message);
      } else setError(t.failed);
      setPending(false);
    }
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
      {error && <Alert tone="error">{error}</Alert>}
      <Field label={t.email} htmlFor="register-email" error={fields.email} hint={t.emailHint}>
        <input id="register-email" type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </Field>
      <Field label={t.password} htmlFor="register-password" error={fields.password} hint={t.passwordHint}>
        <input id="register-password" type="password" autoComplete="new-password" className="input" value={password} maxLength={200} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <div>
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-muted">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-1 size-4 shrink-0 accent-blue-600" />
          <span>
            {t.acceptBefore}
            <Link href={localePath(lang, 'terms')} target="_blank" className="text-gray-200 underline underline-offset-4 hover:text-white">
              {t.acceptTerms}
            </Link>
            {t.acceptAnd}
            <Link href={localePath(lang, 'privacy')} target="_blank" className="text-gray-200 underline underline-offset-4 hover:text-white">
              {t.acceptPrivacy}
            </Link>
            {t.acceptAfter}
          </span>
        </label>
        {fields.acceptTerms && <p className="mt-2 text-sm text-red-400">{fields.acceptTerms}</p>}
        {newsletterOption && (
          <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-muted">
            <input type="checkbox" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} className="mt-1 size-4 shrink-0 accent-blue-600" />
            <span>{d.newsletter.checkbox}</span>
          </label>
        )}
      </div>
      <Button type="submit" size="lg" loading={pending} className="w-full">
        {t.submit}
      </Button>
    </form>
  );
}
