'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Check, Copy, LogOut, RotateCcw, Trash2, UserRound } from 'lucide-react';
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
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    await api('/auth/logout', { body: {} }).catch(() => {});
    // Vollständiger Seitenwechsel: So kennt keine vorgeladene Seite mehr die alte Anmeldung
    window.location.assign(home);
  }

  return (
    <section className="surface divide-y divide-line" aria-label={t.accountTitle}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong bg-white/[0.03] text-muted">
          <UserRound className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-white">{t.accountTitle}</p>
          <p className="mt-0.5 truncate text-sm text-muted">
            {t.signedInAs} <span className="text-gray-200">{email}</span>
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={<LogOut />} loading={loggingOut} onClick={logout}>
          {t.logout}
        </Button>
      </div>

      <div className="p-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 basis-64">
            <p className="text-sm font-medium text-white">{t.deleteAccount}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-subtle">{t.deleteAccountHint}</p>
          </div>
          {!open && (
            <Button variant="danger" size="sm" icon={<Trash2 />} onClick={() => setOpen(true)}>
              {t.deleteAccount}
            </Button>
          )}
        </div>
        {open && (
          <form
            className="mt-4 rounded-lg border border-red-400/25 bg-red-400/[0.05] p-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setError(null);
              try {
                await api('/account/delete', { body: { confirmEmail: confirm } });
                window.location.assign(home);
              } catch (err) {
                setError(err instanceof ApiClientError ? (err.fields?.confirmEmail ?? err.message) : t.deleteFailed);
                setPending(false);
              }
            }}
          >
            <label htmlFor="delete-account-email" className="block text-sm leading-relaxed text-gray-200">
              {t.deleteAccountText}
            </label>
            <input id="delete-account-email" className="input mt-3 max-w-md" type="email" autoComplete="off" placeholder={email} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus />
            {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="submit" variant="danger" size="sm" icon={<Trash2 />} loading={pending} disabled={!confirm}>
                {t.deleteAccountConfirm}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setConfirm('');
                  setError(null);
                }}
              >
                {t.deleteAccountCancel}
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
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
