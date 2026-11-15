'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Check, Copy, RotateCcw } from 'lucide-react';
import type { ServerDTO } from '@chfree/shared';
import { localePath } from '@chfree/shared';
import { Button } from '@/components/ui/button';
import { useDict, useLang } from '@/i18n/client';
import { api, ApiClientError } from '@/lib/api/client';
import { PanelSetupForm } from '@/components/start/panel-setup-form';

/** Lädt die Seite neu, solange sich ein Zustand ändert (z. B. Installation). */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => document.visibilityState === 'visible' && router.refresh(), 5000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}

export function CopyText({ value }: { value: string }) {
  const t = useDict().my;
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* ignorieren */
        }
      }}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md text-left font-mono text-[12px] [overflow-wrap:anywhere] text-gray-300 hover:text-white sm:text-[13px]"
      title={t.copyAddress}
    >
      {/* Umbruch bevorzugt vor dem Port statt mitten in der Zahl */}
      <span>
        {value.includes(':') ? (
          <>
            {value.slice(0, value.lastIndexOf(':'))}
            <wbr />
            {value.slice(value.lastIndexOf(':'))}
          </>
        ) : (
          value
        )}
      </span>
      {done ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5 text-subtle" />}
    </button>
  );
}

export function ReactivateButton({ server }: { server: ServerDTO }) {
  const t = useDict().my;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Button
        icon={<RotateCcw />}
        loading={pending}
        disabled={!server.reactivation.allowed}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            await api(`/servers/${server.id}/reactivate`, { body: {} });
            router.refresh();
          } catch (err) {
            setError(err instanceof ApiClientError ? err.message : t.reactivateFailed);
          } finally {
            setPending(false);
          }
        }}
      >
        {server.cycle.unlimited ? t.reactivateBot : t.reactivate}
      </Button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}

export function DeleteServer({ server }: { server: ServerDTO }) {
  const dict = useDict();
  const t = dict.my;
  const waitlist = server.status === 'waitlist';
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[13px] text-subtle hover:text-red-300">
        {waitlist ? dict.early.leave : server.status === 'pending' ? t.discardRequest : t.deleteServer}
      </button>
    );
  }
  return (
    <form
      className="w-full space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        try {
          await api(`/servers/${server.id}/delete`, { body: { confirmName: confirm } });
          router.refresh();
        } catch (err) {
          setError(err instanceof ApiClientError ? (err.fields?.confirmName ?? err.message) : t.deleteFailed);
          setPending(false);
        }
      }}
    >
      <p className="text-sm text-muted">
        {waitlist ? dict.early.leaveText : t.deleteText}
        <span className="text-white">{server.name}</span>
        {t.deleteTextAfter}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="input sm:max-w-xs" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label={t.confirmName} />
        <Button type="submit" variant="danger" loading={pending} disabled={confirm.trim() !== server.name}>
          {waitlist ? dict.early.leave : t.deleteFinal}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t.cancel}
        </Button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}

export function PanelSetupCard({ email }: { email: string }) {
  const t = useDict().my;
  const router = useRouter();
  return (
    <div className="surface p-6 sm:p-8">
      <h2 className="text-lg font-semibold text-white">{t.setupTitle}</h2>
      <p className="mt-2 max-w-xl text-muted">{t.setupText}</p>
      <div className="mt-6 max-w-md">
        <PanelSetupForm email={email} onDone={() => router.refresh()} />
      </div>
    </div>
  );
}

export function AccountActions({ email }: { email: string }) {
  const t = useDict().my;
  const lang = useLang();
  const home = localePath(lang, 'home');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    await api('/auth/logout', { body: {} }).catch(() => {});
    router.replace(home);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
        <button type="button" onClick={logout} className="text-muted hover:text-white">
          {t.logout}
        </button>
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-subtle hover:text-red-300">
          {t.deleteAccount}
        </button>
      </div>
      {open && (
        <form
          className="max-w-lg space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            setError(null);
            try {
              await api('/account/delete', { body: { confirmEmail: confirm } });
              router.replace(home);
              router.refresh();
            } catch (err) {
              setError(err instanceof ApiClientError ? (err.fields?.confirmEmail ?? err.message) : t.deleteFailed);
              setPending(false);
            }
          }}
        >
          <p className="text-sm text-muted">{t.deleteAccountText}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input className="input" type="email" placeholder={email} value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label={t.confirmEmail} />
            <Button type="submit" variant="danger" loading={pending} disabled={!confirm}>
              {t.deleteAccount}
            </Button>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </form>
      )}
    </div>
  );
}

/** „Erneut prüfen“: Wer inzwischen dem Discord-Server beigetreten ist, bekommt seine wartenden Server */
export function DiscordRecheck() {
  const t = useDict().discord;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        size="sm"
        icon={<RotateCcw />}
        loading={pending}
        onClick={async () => {
          setPending(true);
          setMessage(null);
          try {
            const res = await api<{ ok: boolean }>('/discord/check', { body: {} });
            setMessage({ ok: res.ok, text: res.ok ? t.recheckOk : t.recheckFail });
            router.refresh();
          } catch (err) {
            setMessage({ ok: false, text: err instanceof ApiClientError ? err.message : t.failed });
          } finally {
            setPending(false);
          }
        }}
      >
        {t.recheck}
      </Button>
      {message && <span className={message.ok ? 'text-sm text-emerald-300' : 'text-sm text-amber-300'}>{message.text}</span>}
    </span>
  );
}

export function DiscordUnlink() {
  const t = useDict().discord;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        className="text-[13px] text-subtle underline decoration-line-strong underline-offset-4 hover:text-white disabled:opacity-50"
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            await api('/discord/unlink', { body: {} });
            router.refresh();
          } catch (err) {
            setError(err instanceof ApiClientError ? err.message : t.failed);
          } finally {
            setPending(false);
          }
        }}
      >
        {t.unlink}
      </button>
      {error && <span className="text-[13px] text-red-300">{error}</span>}
    </span>
  );
}
