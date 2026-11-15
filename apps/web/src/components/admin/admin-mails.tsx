'use client';

/**
 * Admin → E-Mails und Abuse:
 *  – Erinnerung an alle, deren Server noch auf die Discord-Verbindung wartet (mit Frist bis zum Löschen)
 *  – Nachricht an ausgewählte Nutzer
 *  – Abuse-Mails von Hand senden und alle Abuse-Mails ansehen
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChevronDown, Send } from 'lucide-react';
import type { AdminAbuseDTO, AdminDiscordWaitingDTO } from '@chfree/shared';
import { Labeled, NumberInput, Toggle } from '@/components/admin/admin-settings';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Message = { ok: boolean; text: string } | null;
const errorText = (err: unknown) => (err instanceof ApiClientError ? err.message : 'Das hat nicht geklappt.');
const dateTime = (iso: string) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function Note({ message }: { message: Message }) {
  return message ? <span className={cn('text-sm', message.ok ? 'text-emerald-300' : 'text-red-300')}>{message.text}</span> : null;
}

/** Erinnerung „Discord verbinden“ an alle, deren Anfrage nur noch daran hängt */
export function DiscordReminder({ initial }: { initial: AdminDiscordWaitingDTO }) {
  const router = useRouter();
  const [waiting, setWaiting] = useState(initial.users);
  const [days, setDays] = useState(7);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [open, setOpen] = useState(false);

  async function send() {
    if (!window.confirm(`Erinnerung an ${waiting.length} Nutzer senden? Wer sein Discord-Konto nicht innerhalb von ${days} Tagen verbindet, verliert seine Anfrage.`)) return;
    setPending(true);
    setMessage(null);
    try {
      const res = await api<{ sent: number; skipped: number; waiting: AdminDiscordWaitingDTO }>('/admin/mails/discord-reminder', { body: { days } });
      setWaiting(res.waiting.users);
      setMessage({ ok: true, text: `${res.sent} Erinnerungen werden versendet${res.skipped ? ` – ${res.skipped} Nutzer wurden heute schon erinnert` : ''}.` });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted">
        Schickt allen eine E-Mail, die schon ein Panel-Konto haben, deren Server aber noch auf die Discord-Verbindung wartet: „Verbinde dein Discord-Konto, damit dein Server
        erstellt wird.“ Die Mail nennt das Datum, bis zu dem das passieren muss – danach löscht das System die Anfrage automatisch und der Nutzer muss den Server neu
        beantragen. Eine bereits laufende Frist verlängert sich durch eine weitere Erinnerung nicht.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Labeled label="Frist in Tagen" className="w-32">
          <NumberInput value={days} min={1} max={30} onChange={setDays} className="max-w-none" />
        </Labeled>
        <Button icon={<Send />} loading={pending} disabled={waiting.length === 0} onClick={() => void send()}>
          Erinnerung an {waiting.length} {waiting.length === 1 ? 'Nutzer' : 'Nutzer'} senden
        </Button>
        <Note message={message} />
      </div>
      {waiting.length === 0 ? (
        <p className="text-sm text-subtle">Aktuell wartet niemand auf die Discord-Verbindung.</p>
      ) : (
        <div>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300">
            <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
            {open ? 'Liste ausblenden' : 'Wartende anzeigen'}
          </button>
          {open && (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line text-sm">
              {waiting.map((w) => (
                <li key={w.userId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
                  <span className="min-w-0">
                    <span className="text-gray-100">{w.email}</span>
                    <span className="block text-[12px] text-subtle">
                      {w.servers.join(', ')} · {w.reason === 'discord_not_member' ? 'verknüpft, aber kein Mitglied' : 'Discord nicht verbunden'}
                    </span>
                  </span>
                  <span className={cn('shrink-0 text-[13px]', w.deadline ? 'text-amber-200' : 'text-subtle')}>{w.deadline ? `Frist bis ${dateTime(w.deadline)}` : 'noch nicht erinnert'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Adressen aus einem Textfeld: getrennt durch Komma, Semikolon, Leerzeichen oder Zeilenumbruch */
const parseEmails = (text: string) => [...new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];

/** Nachricht an ausgewählte Nutzer */
export function AdminMessageForm() {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState({ de: '', en: '' });
  const [body, setBody] = useState({ de: '', en: '' });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const emails = parseEmails(to);
  const invalid = emails.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));

  async function send() {
    if (!window.confirm(`Nachricht an ${emails.length} ${emails.length === 1 ? 'Adresse' : 'Adressen'} senden?`)) return;
    setPending(true);
    setMessage(null);
    try {
      const res = await api<{ sent: number; unknown: string[] }>('/admin/mails/send', { body: { emails, subject, body } });
      setMessage({
        ok: res.unknown.length === 0,
        text: `${res.sent} ${res.sent === 1 ? 'Nachricht wird' : 'Nachrichten werden'} versendet.${res.unknown.length ? ` Kein Account zu: ${res.unknown.join(', ')}` : ''}`,
      });
      if (res.unknown.length === 0) setTo('');
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted">
        Schickt eine E-Mail nur an die angegebenen Nutzer. Die Nachricht erscheint zusätzlich unter „Meine Server“. Jeder bekommt den Text in seiner Sprache – bleibt das
        englische Feld leer, geht der deutsche Text an alle.
      </p>
      <Labeled label="Empfänger" hint={`E-Mail-Adressen registrierter Nutzer, getrennt durch Komma, Leerzeichen oder Zeilenumbruch (höchstens 500). ${emails.length} erkannt.`}>
        <textarea className="input min-h-[72px] py-2.5 font-mono text-[13px]" rows={2} value={to} placeholder="nutzer@example.com, weitere@example.com" onChange={(e) => setTo(e.target.value)} />
      </Labeled>
      {invalid.length > 0 && <p className="text-[13px] text-amber-300">Keine gültige Adresse: {invalid.slice(0, 5).join(', ')}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Labeled label="Betreff (Deutsch)">
          <input className="input" value={subject.de} maxLength={150} onChange={(e) => setSubject({ ...subject, de: e.target.value })} />
        </Labeled>
        <Labeled label="Betreff (Englisch)">
          <input className="input" value={subject.en} maxLength={150} onChange={(e) => setSubject({ ...subject, en: e.target.value })} />
        </Labeled>
        <Labeled label="Text (Deutsch)">
          <textarea className="input min-h-[140px] py-2.5 leading-relaxed" rows={6} value={body.de} maxLength={5000} onChange={(e) => setBody({ ...body, de: e.target.value })} />
        </Labeled>
        <Labeled label="Text (Englisch)">
          <textarea className="input min-h-[140px] py-2.5 leading-relaxed" rows={6} value={body.en} maxLength={5000} onChange={(e) => setBody({ ...body, en: e.target.value })} />
        </Labeled>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={<Send />} loading={pending} disabled={emails.length === 0 || invalid.length > 0 || !(subject.de.trim() || subject.en.trim()) || !(body.de.trim() || body.en.trim())} onClick={() => void send()}>
          Nachricht senden
        </Button>
        <Note message={message} />
      </div>
    </div>
  );
}

const AUTO_LABEL: Record<string, string> = {
  'fair_use.bot_cpu_stop': 'automatisch · Bot wegen CPU-Last gestoppt',
  'fair_use.bot_suspended': 'automatisch · Bot gesperrt',
  'fair_use.pause_violation': 'automatisch · Start während einer Pause',
};

/** Abuse-Bereich: Abuse-Mail senden und alle Abuse-Mails ansehen */
export function AbuseManager({ initial }: { initial: AdminAbuseDTO }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState(initial.reasons[0]?.id ?? 'other');
  const [note, setNote] = useState({ de: '', en: '' });
  const [suspend, setSuspend] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const needsNote = reason === 'other';
  const shown = data.mails.filter((m) => !filter.trim() || m.userEmail.includes(filter.trim().toLowerCase()));

  async function send() {
    if (!window.confirm(`Abuse-Mail an ${email} senden${suspend ? ' und alle Server dieses Nutzers sperren' : ''}?`)) return;
    setPending(true);
    setMessage(null);
    try {
      const res = await api<{ suspended: number; abuse: AdminAbuseDTO }>('/admin/abuse', { body: { email: email.trim(), reason, note, suspend } });
      setData(res.abuse);
      setMessage({ ok: true, text: `Abuse-Mail wird versendet${res.suspended ? ` – ${res.suspended} Server gesperrt` : ''}.` });
      setNote({ de: '', en: '' });
      setSuspend(false);
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="surface p-5 sm:p-6">
        <h2 className="text-[15px] font-semibold text-white">Abuse-Mail senden</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
          Verwarnt einen Nutzer per E-Mail (und unter „Meine Server“). Der Text zum gewählten Grund ist vorbereitet und geht in der Sprache des Nutzers raus; dein eigener
          Text wird darunter angefügt. Auf Wunsch werden gleichzeitig alle Server des Nutzers gesperrt.
        </p>
        <div className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Labeled label="E-Mail-Adresse des Nutzers">
              <input className="input" type="email" value={email} placeholder="nutzer@example.com" onChange={(e) => setEmail(e.target.value)} />
            </Labeled>
            <Labeled label="Grund">
              <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
                {data.reasons.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label={`Eigener Text (Deutsch)${needsNote ? '' : ' – optional'}`}>
              <textarea className="input min-h-[96px] py-2.5 leading-relaxed" rows={4} value={note.de} maxLength={3000} onChange={(e) => setNote({ ...note, de: e.target.value })} />
            </Labeled>
            <Labeled label="Eigener Text (Englisch) – optional" hint="Leer = der deutsche Text geht auch an englischsprachige Nutzer.">
              <textarea className="input min-h-[96px] py-2.5 leading-relaxed" rows={4} value={note.en} maxLength={3000} onChange={(e) => setNote({ ...note, en: e.target.value })} />
            </Labeled>
          </div>
          <Toggle checked={suspend} onChange={setSuspend} label="Alle Server dieses Nutzers sofort sperren" hint="Die Mail nennt dann die Sperre. Entsperren geht im Reiter „Server“." />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="danger" icon={<Send />} loading={pending} disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) || (needsNote && !note.de.trim() && !note.en.trim())} onClick={() => void send()}>
              Abuse-Mail senden
            </Button>
            <Note message={message} />
          </div>
        </div>
      </section>

      <section className="surface p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-white">Versendete Abuse-Mails</h2>
            <p className="mt-1 text-sm text-muted">Die letzten 200 – von Hand verschickte und die automatischen des Fair-Use-Systems. Ein Klick zeigt den Text.</p>
          </div>
          <input className="input max-w-xs" value={filter} placeholder="Nach E-Mail filtern" onChange={(e) => setFilter(e.target.value)} aria-label="Nach E-Mail filtern" />
        </div>
        {shown.length === 0 ? (
          <p className="mt-5 text-sm text-subtle">{data.mails.length === 0 ? 'Noch keine Abuse-Mails.' : 'Keine Treffer.'}</p>
        ) : (
          <ul className="mt-5 divide-y divide-line rounded-lg border border-line">
            {shown.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-3 text-left hover:bg-white/[0.03]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-100">{m.title}</span>
                    <span className="mt-0.5 block text-[12px] text-subtle">
                      {dateTime(m.createdAt)} · {m.userEmail}
                      {m.serverName ? ` · Server „${m.serverName}“` : ''}
                    </span>
                  </span>
                  <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px]', m.manual ? 'bg-red-400/15 text-red-200' : 'bg-white/[0.06] text-muted')}>{m.manual ? 'von Hand' : (AUTO_LABEL[m.type] ?? 'automatisch')}</span>
                  <span className={cn('w-24 shrink-0 text-right text-[12px]', m.emailStatus === 'sent' ? 'text-emerald-300' : m.emailStatus === 'failed' ? 'text-red-300' : 'text-amber-300')}>
                    {m.emailStatus === 'sent' ? 'zugestellt' : m.emailStatus === 'failed' ? 'fehlgeschlagen' : m.emailStatus === 'pending' ? 'wird gesendet' : 'ohne E-Mail'}
                  </span>
                </button>
                {open === m.id && (
                  <div className="border-t border-line bg-black/20 px-3.5 py-3 text-sm leading-relaxed whitespace-pre-wrap text-gray-200">
                    {m.body}
                    {m.emailLastError && <p className="mt-2 text-[13px] text-red-300">Fehler beim Versand: {m.emailLastError}</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
