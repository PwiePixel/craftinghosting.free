'use client';

/**
 * Admin → Pterodactyl → „Automatischer Umzug“: Zugang zu einem Admin-Konto des Panels.
 * Das klassische Pterodactyl bietet den Umzug eines Servers auf eine andere Node nicht über seine Schnittstelle
 * an. Mit diesem Zugang meldet sich das System wie ein Browser im Panel an und startet den Umzug selbst.
 */
import { useEffect, useState } from 'react';
import { KeyRound, Save, Trash2 } from 'lucide-react';
import type { AdminPanelLoginDTO } from '@chfree/shared';
import { Labeled, Section } from '@/components/admin/admin-settings';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const errorText = (err: unknown) => (err instanceof ApiClientError ? err.message : 'Das hat nicht geklappt.');
const dateTime = (iso: string) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function PanelLoginSection() {
  const [status, setStatus] = useState<AdminPanelLoginDTO | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [pending, setPending] = useState<'save' | 'test' | 'delete' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api<{ login: AdminPanelLoginDTO }>('/admin/panel/transfer-login')
      .then((r) => {
        setStatus(r.login);
        setUsername(r.login.username);
      })
      .catch(() => {});
  }, []);

  async function run(kind: 'save' | 'test' | 'delete') {
    setPending(kind);
    setMessage(null);
    try {
      if (kind === 'save' || (kind === 'test' && (password || totp || username !== status?.username))) {
        const r = await api<{ login: AdminPanelLoginDTO }>('/admin/panel/transfer-login', { body: { username, ...(password ? { password } : {}), ...(totp ? { totpSecret: totp } : {}) } });
        setStatus(r.login);
        setPassword('');
        setTotp('');
        if (kind === 'save') setMessage({ ok: true, text: 'Gespeichert. Mit „Zugang testen“ prüfst du, ob die Anmeldung klappt.' });
      }
      if (kind === 'test') {
        const r = await api<{ login: AdminPanelLoginDTO }>('/admin/panel/transfer-login/test', { body: {} });
        setStatus(r.login);
        setMessage(r.login.lastCheck ? { ok: r.login.lastCheck.ok, text: r.login.lastCheck.message } : null);
      }
      if (kind === 'delete') {
        const r = await api<{ login: AdminPanelLoginDTO }>('/admin/panel/transfer-login/delete', { body: {} });
        setStatus(r.login);
        setUsername('');
        setMessage({ ok: true, text: 'Zugang gelöscht.' });
      }
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setPending(null);
    }
  }

  return (
    <Section
      title="Automatischer Umzug"
      description="Damit ein Server auf Knopfdruck auf eine andere Node umzieht (Admin → Server → „Upgrade / Umzug“). Pelican startet den Umzug über seine Schnittstelle – dann brauchst du hier nichts. Das klassische Pterodactyl bietet das nicht an: Dafür meldet sich das System mit diesem Konto im Admin-Bereich des Panels an und startet den Umzug dort selbst."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Labeled label="Benutzername oder E-Mail (Panel-Admin)">
          <input className="input" value={username} autoComplete="off" onChange={(e) => setUsername(e.target.value)} />
        </Labeled>
        <Labeled label="Passwort">
          <input className="input" type="password" value={password} autoComplete="new-password" placeholder={status?.configured ? '•••••••• (gespeichert)' : ''} onChange={(e) => setPassword(e.target.value)} />
        </Labeled>
        <Labeled label="Zwei-Faktor-Schlüssel (nur falls aktiv)">
          <input className="input font-mono" value={totp} autoComplete="off" placeholder={status?.hasTotp ? '•••••••• (gespeichert)' : 'geheimer Schlüssel (Base32)'} onChange={(e) => setTotp(e.target.value)} />
        </Labeled>
      </div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-subtle">
        <li>Am besten ein eigenes Admin-Konto im Panel nur für diesen Zweck anlegen. Passwort und Schlüssel werden verschlüsselt gespeichert und nie wieder angezeigt.</li>
        <li>
          Im Panel muss reCAPTCHA für die Anmeldung ausgeschaltet sein (Panel → Settings → Advanced → reCAPTCHA: Disabled), sonst kann sich das System nicht anmelden.
        </li>
        <li>Ist am Konto die Zwei-Faktor-Anmeldung aktiv, wird der geheime Schlüssel gebraucht, den das Panel beim Einrichten neben dem QR-Code zeigt – nicht der sechsstellige Code.</li>
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" icon={<Save />} loading={pending === 'save'} disabled={pending !== null || !username.trim() || (!status?.configured && !password)} onClick={() => run('save')}>
          Zugang speichern
        </Button>
        <Button variant="secondary" size="sm" icon={<KeyRound />} loading={pending === 'test'} disabled={pending !== null || (!status?.configured && !password)} onClick={() => run('test')}>
          Zugang testen
        </Button>
        {status?.configured && (
          <Button variant="secondary" size="sm" icon={<Trash2 />} loading={pending === 'delete'} disabled={pending !== null} onClick={() => run('delete')}>
            Löschen
          </Button>
        )}
        <span className="text-[13px] text-subtle">
          {status?.configured ? `Zugang gespeichert (${status.username}${status.hasTotp ? ', mit Zwei-Faktor-Schlüssel' : ''}).` : 'Kein Zugang gespeichert – beim klassischen Pterodactyl musst du Server dann im Panel selbst verschieben.'}
        </span>
      </div>
      {message ? (
        <p className={cn('mt-3 text-sm leading-relaxed', message.ok ? 'text-emerald-300' : 'text-red-300')}>{message.text}</p>
      ) : (
        status?.lastCheck && (
          <p className={cn('mt-3 text-[13px] leading-relaxed', status.lastCheck.ok ? 'text-emerald-300/90' : 'text-red-300')}>
            Zuletzt am {dateTime(status.lastCheck.at)}: {status.lastCheck.message}
          </p>
        )
      )}
    </Section>
  );
}
