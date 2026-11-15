'use client';

/**
 * Admin → Discord → Social Ping: Konten (YouTube-Kanäle oder Feeds) hinterlegen, deren neue Videos der Bot
 * in einem Kanal meldet. Die Einstellungen gehören zu den Discord-Einstellungen („Speichern“ dort).
 */
import { useEffect, useState } from 'react';
import { ExternalLink, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { discordLimits, socialPingPlaceholders, type AdminDiscordDTO, type AdminSocialDTO, type DiscordSettings, type SocialAccount } from '@chfree/shared';
import { Labeled, Section, Toggle } from '@/components/admin/admin-settings';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Message = { ok: boolean; text: string } | null;
const errorText = (err: unknown) => (err instanceof ApiClientError ? err.message : 'Das hat nicht geklappt.');
const onlyDigits = (v: string) => v.replace(/\D/g, '').slice(0, 22);
const dateTime = (iso: string) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function Note({ message }: { message: Message }) {
  return message ? <span className={cn('text-sm', message.ok ? 'text-emerald-300' : 'text-red-300')}>{message.text}</span> : null;
}

export function SocialSection({ d, set, status, dirty }: { d: DiscordSettings; set: (patch: Partial<DiscordSettings>) => void; status: AdminDiscordDTO; dirty: boolean }) {
  const s = d.socialPing;
  const setS = (patch: Partial<DiscordSettings['socialPing']>) => set({ socialPing: { ...s, ...patch } });
  const [link, setLink] = useState('');
  const [pending, setPending] = useState<'add' | 'check' | string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [state, setState] = useState<AdminSocialDTO | null>(null);

  // Stand der Konten (letzte Prüfung, letztes Video, Fehler)
  useEffect(() => {
    api<{ social: AdminSocialDTO }>('/admin/discord/social')
      .then((r) => setState(r.social))
      .catch(() => {});
  }, []);

  async function add() {
    setPending('add');
    setMessage(null);
    try {
      const { account } = await api<{ account: { url: string; feedUrl: string; name: string; latest: { title: string } | null } }>('/admin/discord/social/resolve', { body: { url: link.trim() } });
      if (s.accounts.some((a) => a.feedUrl === account.feedUrl)) {
        setMessage({ ok: false, text: `„${account.name}“ ist schon in der Liste.` });
        return;
      }
      const entry: SocialAccount = { id: `konto-${Date.now().toString(36)}`, url: account.url, feedUrl: account.feedUrl, name: account.name };
      setS({ accounts: [...s.accounts, entry] });
      setLink('');
      setMessage({ ok: true, text: `„${account.name}“ gefunden${account.latest ? ` – neuestes Video: ${account.latest.title}` : ''}. Jetzt noch speichern.` });
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setPending(null);
    }
  }

  async function check() {
    setPending('check');
    setMessage(null);
    try {
      const res = await api<{ result: { accounts: number; posted: number; errors: number }; social: AdminSocialDTO }>('/admin/discord/social/check', { body: {} });
      setState(res.social);
      setMessage({ ok: res.result.errors === 0, text: `${res.result.accounts} Konten geprüft, ${res.result.posted} neue Videos gepostet${res.result.errors ? `, ${res.result.errors} Fehler` : ''}.` });
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setPending(null);
    }
  }

  async function test(accountId: string) {
    setPending(accountId);
    setMessage(null);
    try {
      await api('/admin/discord/social/test', { body: { accountId } });
      setMessage({ ok: true, text: 'Testnachricht mit dem neuesten Video gesendet.' });
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setPending(null);
    }
  }

  return (
    <Section
      title="Social Ping (neue Videos)"
      description="Hinterlege Konten per Link – der Bot prüft alle 5 Minuten, ob dort ein neues Video erschienen ist, und postet es mit Link in den Kanal. Unterstützt werden YouTube-Kanäle (youtube.com/@name), TikTok-Profile (tiktok.com/@name) und beliebige RSS-/Atom-Feeds. Beim Hinzufügen merkt sich der Bot die vorhandenen Videos; gemeldet wird alles, was danach neu erscheint."
    >
      <Toggle checked={s.enabled} onChange={(enabled) => setS({ enabled })} label="Social Ping einschalten" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Labeled label="Kanal für die Meldungen" hint="Kanal-ID. Der Bot braucht dort „Nachrichten senden“ und „Links einbetten“.">
          <input type="text" inputMode="numeric" className="input font-mono text-[13px]" value={s.channelId} placeholder="Kanal-ID" onChange={(e) => setS({ channelId: onlyDigits(e.target.value) })} />
        </Labeled>
        <Labeled label="Rolle erwähnen (optional)" hint="Rollen-ID, z. B. eine „Videos“-Rolle aus dem Rollen-Panel.">
          <input type="text" inputMode="numeric" className="input font-mono text-[13px]" value={s.pingRoleId} placeholder="Rollen-ID" onChange={(e) => setS({ pingRoleId: onlyDigits(e.target.value) })} />
        </Labeled>
      </div>
      <Labeled
        label="Text der Nachricht"
        hint={
          <>
            Platzhalter: {socialPingPlaceholders.map(([p, what]) => `${p} = ${what}`).join(' · ')}. Der Link ({'{url}'}) muss enthalten sein – daraus macht Discord die Vorschau mit
            Player.
          </>
        }
      >
        <textarea className="input min-h-[120px] py-2.5 font-mono text-[13px] leading-relaxed" rows={5} value={s.message} maxLength={1000} onChange={(e) => setS({ message: e.target.value })} />
      </Labeled>

      <div>
        <p className="text-sm font-medium text-gray-200">
          Konten ({s.accounts.length} von {discordLimits.socialAccounts})
        </p>
        {s.accounts.length === 0 ? (
          <p className="mt-2 text-sm text-subtle">Noch kein Konto hinterlegt.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {s.accounts.map((a) => {
              const st = state?.accounts.find((x) => x.id === a.id);
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-3">
                  <div className="min-w-0 flex-1 basis-72">
                    <input className="input block h-9 max-w-sm text-sm" value={a.name} maxLength={80} aria-label="Anzeigename" onChange={(e) => setS({ accounts: s.accounts.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)) })} />
                    <p className="mt-1.5">
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-[12px] text-blue-400 hover:text-blue-300">
                        <span className="truncate">{a.url}</span> <ExternalLink className="size-3 shrink-0" aria-hidden />
                      </a>
                    </p>
                    <p className="mt-0.5 text-[12px] text-subtle">
                      {st?.error ? (
                        <span className="text-red-300">Fehler: {st.error}</span>
                      ) : st?.checkedAt ? (
                        <>
                          Geprüft {dateTime(st.checkedAt)} · {st.posted} gepostet{st.latest ? ` · neuestes Video: ${st.latest.title}` : ''}
                        </>
                      ) : (
                        'Wird nach dem Speichern beim nächsten Lauf zum ersten Mal geprüft.'
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="secondary" size="sm" icon={<Send />} loading={pending === a.id} disabled={pending !== null || dirty || !status.botReady || !s.channelId} onClick={() => void test(a.id)}>
                      Testen
                    </Button>
                    <Button variant="ghost" size="sm" icon={<Trash2 />} onClick={() => setS({ accounts: s.accounts.filter((x) => x.id !== a.id) })}>
                      Entfernen
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className="input max-w-md"
            value={link}
            placeholder="https://www.youtube.com/@name oder https://www.tiktok.com/@name"
            aria-label="Link zum Konto"
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && link.trim().length > 3) {
                e.preventDefault();
                void add();
              }
            }}
          />
          <Button variant="secondary" size="sm" icon={<Plus />} loading={pending === 'add'} disabled={pending !== null || link.trim().length < 4 || s.accounts.length >= discordLimits.socialAccounts} onClick={() => void add()}>
            Konto hinzufügen
          </Button>
          <Button variant="secondary" size="sm" icon={<RefreshCw />} loading={pending === 'check'} disabled={pending !== null || dirty || !s.enabled || s.accounts.length === 0} onClick={() => void check()}>
            Jetzt prüfen
          </Button>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-subtle">
          TikTok bietet keinen offiziellen Feed. Der Bot liest dafür die öffentliche Profilseite (die letzten zehn Videos) – das funktioniert nur bei öffentlichen Konten und kann
          ausfallen, wenn TikTok die Seite ändert oder Abrufe vom Server blockiert. Ein Fehler steht dann beim Konto.
        </p>
        <div className="mt-2 min-h-5">
          {message ? <Note message={message} /> : dirty && s.accounts.length > 0 && <span className="text-[13px] text-amber-300">„Testen“ und „Jetzt prüfen“ arbeiten mit dem gespeicherten Stand – bitte zuerst speichern.</span>}
        </div>
      </div>
    </Section>
  );
}
