'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { panelSetupSchema } from '@chfree/shared';
import { Button } from '@/components/ui/button';
import { Alert, Field } from '@/components/ui/primitives';
import { api } from '@/lib/api/client';
import { useDict } from '@/i18n/client';
import { useForm } from '@/lib/use-form';

export interface PanelSetupResult {
  existingPanelAccount: boolean;
  serversCreated: number;
  panelUrl: string;
  /** Der Server wartet noch auf die Discord-Verbindung (null = nichts offen) */
  discordBlocked?: 'not_linked' | 'not_member' | 'unavailable' | null;
}

function suggestUsername(email: string) {
  const local = email.split('@')[0] ?? '';
  const clean = local.toLowerCase().replace(/[^a-z0-9._-]/g, '').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  // Mindestens 3 Zeichen (z. B. „p1@…“ → „p1-mc“), damit der Vorschlag direkt gültig ist
  const base = clean.slice(0, 24);
  return base.length >= 3 ? base : base ? `${base}-mc` : '';
}

/** Legt den Zugang zum Pterodactyl-Panel fest. Das Passwort geht direkt an das Panel. */
export function PanelSetupForm({ email, onDone }: { email: string; onDone: (r: PanelSetupResult) => void }) {
  const [username, setUsername] = useState(suggestUsername(email));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const form = useForm(panelSetupSchema);
  const t = useDict().panelSetup;

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (password !== confirm) {
          form.setFieldErrors({ confirm: t.mismatch });
          return;
        }
        void form.submit({ username, password }, async (data) => {
          const res = await api<PanelSetupResult>('/panel/setup', { body: data });
          onDone(res);
        });
      }}
    >
      {form.error && <Alert tone="error">{form.error}</Alert>}
      <Field label={t.email} htmlFor="panel-email">
        <input id="panel-email" className="input opacity-70" value={email} readOnly />
      </Field>
      <Field label={t.username} htmlFor="username" error={form.fieldErrors.username} hint={t.usernameHint}>
        <input id="username" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
      </Field>
      <Field label={t.password} htmlFor="password" error={form.fieldErrors.password} hint={t.passwordHint}>
        <div className="relative">
          <input
            id="password"
            type={show ? 'text' : 'password'}
            className="input pr-11"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-subtle hover:text-white"
            aria-label={show ? t.hidePassword : t.showPassword}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>
      <Field label={t.confirm} htmlFor="confirm" error={form.fieldErrors.confirm}>
        <input id="confirm" type={show ? 'text' : 'password'} className="input" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <p className="text-[13px] leading-relaxed text-subtle">{t.note}</p>
      <Button type="submit" size="lg" loading={form.pending} className="w-full">
        {t.submit}
      </Button>
    </form>
  );
}
