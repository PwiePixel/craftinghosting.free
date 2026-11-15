'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Play } from 'lucide-react';
import type { AdminServerDTO, AdminUserDTO } from '@chfree/shared';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

/** Kleiner Aktions-Button mit optionaler Zwei-Klick-Bestätigung (ohne Browser-Dialoge). */
export function ActionButton({
  label,
  confirm,
  danger,
  run,
}: {
  label: string;
  confirm?: string;
  danger?: boolean;
  run: () => Promise<void>;
}) {
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function click() {
    if (confirm && !armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 4000);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await run();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Aktion fehlgeschlagen.');
    } finally {
      setPending(false);
      setArmed(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={click}
        disabled={pending}
        className={cn(
          'rounded-md border px-2 py-1 text-xs whitespace-nowrap transition-colors disabled:opacity-50',
          armed
            ? 'border-red-500/60 bg-red-500/15 text-red-200'
            : danger
              ? 'border-line-strong text-red-300 hover:border-red-500/50 hover:bg-red-500/10'
              : 'border-line-strong text-gray-200 hover:border-white/30 hover:bg-white/5',
        )}
      >
        {pending ? '…' : armed ? (confirm ?? 'Sicher?') : label}
      </button>
      {error && <span className="mt-1 max-w-[220px] text-[11px] text-red-400">{error}</span>}
    </span>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

export function ServerActions({ server }: { server: AdminServerDTO }) {
  const router = useRouter();
  const act = (action: string) => async () => {
    await api(`/admin/servers/${server.id}/${action}`, { body: {} });
    router.refresh();
  };
  const s = server.status;
  const paused = !!server.pausedUntil && new Date(server.pausedUntil) > new Date();
  return (
    <Actions>
      {(s === 'active' || s === 'expiring' || (s === 'suspended' && server.suspensionReason === 'cycle_expired')) && (
        <ActionButton label="+30 Tage" run={act('extend')} />
      )}
      {paused && s === 'active' && <ActionButton label="Pause aufheben" run={act('clear-pause')} />}
      {s === 'provisioning_failed' && <ActionButton label="Erneut versuchen" run={act('retry')} />}
      {(s === 'active' || s === 'expiring') && <ActionButton label="Sperren" confirm="Wirklich sperren?" danger run={act('suspend')} />}
      {s === 'suspended' && <ActionButton label="Entsperren" run={act('unsuspend')} />}
      {s !== 'provisioning' && <ActionButton label="Löschen" confirm="Endgültig löschen?" danger run={act('delete')} />}
    </Actions>
  );
}

export function UserActions({ user, self }: { user: AdminUserDTO; self: boolean }) {
  const router = useRouter();
  const act = (action: string) => async () => {
    await api(`/admin/users/${user.id}/${action}`, { body: {} });
    router.refresh();
  };
  if (self) return <span className="text-xs text-subtle">du</span>;
  return (
    <Actions>
      {user.status === 'active' ? (
        <ActionButton label="Sperren" confirm="Wirklich sperren?" danger run={act('lock')} />
      ) : (
        <ActionButton label="Entsperren" run={act('unlock')} />
      )}
      {user.role === 'admin' ? <ActionButton label="Admin entfernen" confirm="Sicher?" run={act('remove-admin')} /> : <ActionButton label="Zum Admin" confirm="Sicher?" run={act('make-admin')} />}
    </Actions>
  );
}

export function RunJobButton({ name }: { name: string }) {
  const router = useRouter();
  const [result, setResult] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <ActionButton
        label="Jetzt ausführen"
        run={async () => {
          const res = await api<{ result: string }>(`/admin/jobs/${name}/run`, { body: {} });
          setResult(res.result === 'ran' ? 'ok' : res.result === 'locked' ? 'läuft gerade' : 'fehlgeschlagen');
          router.refresh();
        }}
      />
      {result && <span className="text-[11px] text-subtle">{result}</span>}
    </span>
  );
}

export function MailTestForm({ defaultTo }: { defaultTo: string }) {
  const [to, setTo] = useState(defaultTo);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-start"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setResult(null);
        try {
          const res = await api<{ ok: boolean; error?: string }>('/admin/mail-test', { body: { to } });
          setResult(res.ok ? { ok: true, text: `Testmail an ${to} wurde vom Mailserver angenommen.` } : { ok: false, text: res.error ?? 'Versand fehlgeschlagen.' });
        } catch (err) {
          setResult({ ok: false, text: err instanceof ApiClientError ? err.message : 'Versand fehlgeschlagen.' });
        } finally {
          setPending(false);
        }
      }}
    >
      <input className="input sm:max-w-xs" type="email" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Empfänger" />
      <Button type="submit" variant="secondary" loading={pending} icon={<Play />}>
        Testmail senden
      </Button>
      {result && <p className={cn('text-sm sm:self-center', result.ok ? 'text-emerald-300' : 'text-red-300')}>{result.text}</p>}
    </form>
  );
}
