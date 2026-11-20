'use client';

/**
 * Admin → E-Mails und Abuse:
 *  – Erinnerung an ausgewählte Nutzer, deren Server noch auf die Discord-Verbindung wartet (mit Frist bis zum Löschen)
 *  – Erinnerung an ausgewählte Nutzer ohne Panel-Zugang (mit Frist bis zum Löschen des Kontos)
 *  – Einladung mit Ein-Klick-Link an verknüpfte Nutzer, die nicht auf dem Discord-Server sind
 *  – Nachricht an ausgewählte Nutzer
 *  – Abuse-Mails von Hand senden und alle Abuse-Mails ansehen
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import type { AdminAbuseDTO, AdminDiscordJoinWaitingDTO, AdminDiscordWaitingDTO, AdminPanelWaitingDTO } from '@chfree/shared';
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

interface WaitingRow {
  userId: string;
  email: string;
  detail: string;
  deadline: string | null;
  lastRemindedAt: string | null;
}

/**
 * Erinnerung mit Frist an ausgewählte Nutzer. Vorausgewählt sind alle, die noch keine Erinnerung dieser Art bekommen
 * haben – so geht eine zweite Runde nicht wieder an alle.
 */
function ReminderPanel({
  rows,
  defaultDays,
  endpoint,
  empty,
  consequence,
  onSent,
}: {
  rows: WaitingRow[];
  /** null = ohne Frist (reine Einladung) */
  defaultDays: number | null;
  endpoint: string;
  empty: string;
  /** Folge nach Ablauf der Frist, für die Rückfrage: „… verliert seine Anfrage“ */
  consequence: (days: number) => string;
  onSent: (res: unknown) => void;
}) {
  const router = useRouter();
  const [days, setDays] = useState(defaultDays ?? 0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const notReminded = (list: WaitingRow[]) => new Set(list.filter((r) => !r.lastRemindedAt).map((r) => r.userId));
  const [selected, setSelected] = useState<Set<string>>(() => notReminded(rows));
  // Nach dem Senden bzw. Neuladen: Auswahl auf die noch vorhandenen Nutzer beschränken
  const ids = new Set(rows.map((r) => r.userId));
  const chosen = [...selected].filter((id) => ids.has(id));
  const remindedCount = rows.length - notReminded(rows).size;

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function send() {
    if (chosen.length === 0) return;
    if (!window.confirm(`E-Mail an ${chosen.length} ${chosen.length === 1 ? 'Nutzer' : 'Nutzer'} senden? ${consequence(days)}`)) return;
    setPending(true);
    setMessage(null);
    try {
      const res = await api<{ sent: number; skipped: number }>(endpoint, { body: defaultDays === null ? { userIds: chosen } : { days, userIds: chosen } });
      onSent(res);
      setSelected(new Set());
      setMessage({ ok: true, text: `${res.sent} ${res.sent === 1 ? 'E-Mail wird' : 'E-Mails werden'} versendet${res.skipped ? ` – ${res.skipped} wurden heute schon erinnert` : ''}.` });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setPending(false);
    }
  }

  if (rows.length === 0) return <p className="text-sm text-subtle">{empty}</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        {defaultDays !== null && (
          <Labeled label="Frist in Tagen" className="w-32">
            <NumberInput value={days} min={1} max={30} onChange={setDays} className="max-w-none" />
          </Labeled>
        )}
        <Button icon={<Send />} loading={pending} disabled={chosen.length === 0} onClick={() => void send()}>
          E-Mail an {chosen.length} {chosen.length === 1 ? 'Nutzer' : 'Nutzer'} senden
        </Button>
        <Note message={message} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        <span className="text-subtle">
          {chosen.length} von {rows.length} ausgewählt · {remindedCount} schon erinnert
        </span>
        <button type="button" className="text-blue-400 hover:text-blue-300" onClick={() => setSelected(new Set(rows.map((r) => r.userId)))}>
          Alle
        </button>
        <button type="button" className="text-blue-400 hover:text-blue-300" onClick={() => setSelected(notReminded(rows))}>
          Nur noch nicht erinnerte
        </button>
        <button type="button" className="text-blue-400 hover:text-blue-300" onClick={() => setSelected(new Set())}>
          Keine
        </button>
      </div>
      <ul className="max-h-[420px] divide-y divide-line overflow-y-auto rounded-lg border border-line text-sm">
        {rows.map((r) => (
          <li key={r.userId}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-white/[0.03]">
              <input type="checkbox" className="size-4 shrink-0 accent-blue-500" checked={selected.has(r.userId)} onChange={() => toggle(r.userId)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-gray-100">{r.email}</span>
                <span className="block text-[12px] text-subtle">{r.detail}</span>
              </span>
              <span className="shrink-0 text-right text-[12px] leading-snug">
                <span className={cn('block', r.lastRemindedAt ? 'text-gray-300' : 'text-subtle')}>{r.lastRemindedAt ? `erinnert am ${dateTime(r.lastRemindedAt)}` : 'noch nicht erinnert'}</span>
                {r.deadline && <span className="block text-amber-200">Frist bis {dateTime(r.deadline)}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Erinnerung „Discord verbinden“ an ausgewählte Nutzer, deren Anfrage nur noch daran hängt */
export function DiscordReminder({ initial }: { initial: AdminDiscordWaitingDTO }) {
  const [waiting, setWaiting] = useState(initial.users);
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted">
        E-Mail an die ausgewählten Nutzer, die schon ein Panel-Konto haben, deren Server aber noch auf die Discord-Verbindung wartet: „Verbinde dein Discord-Konto, damit dein
        Server erstellt wird.“ Die Mail nennt das Datum, bis zu dem das passieren muss – danach löscht das System die Anfrage automatisch und der Nutzer muss den Server neu
        beantragen. Eine bereits laufende Frist verlängert sich durch eine weitere Erinnerung nicht.
      </p>
      <ReminderPanel
        rows={waiting.map((w) => ({
          ...w,
          detail: `${w.servers.join(', ')} · ${w.reason === 'discord_not_member' ? 'verknüpft, aber kein Mitglied' : 'Discord nicht verbunden'}`,
        }))}
        defaultDays={7}
        endpoint="/admin/mails/discord-reminder"
        empty="Aktuell wartet niemand auf die Discord-Verbindung."
        consequence={(days) => `Wer sein Discord-Konto nicht innerhalb von ${days} Tagen verbindet, verliert seine Anfrage.`}
        onSent={(res) => setWaiting((res as { waiting: AdminDiscordWaitingDTO }).waiting.users)}
      />
    </div>
  );
}

/** Einladung „Discord-Server beitreten“ mit Ein-Klick-Link an verknüpfte Konten, die der Bot nicht selbst hinzufügen kann */
export function DiscordJoinReminder({ initial }: { initial: AdminDiscordJoinWaitingDTO }) {
  const [waiting, setWaiting] = useState(initial.users);
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted">
        Diese Nutzer haben ihr Discord-Konto verknüpft, sind aber nicht auf eurem Discord-Server – und der Bot darf sie nicht selbst hinzufügen, weil Discord dafür ihre
        Erlaubnis verlangt (sie haben vor dem automatischen Beitritt verknüpft oder die Erlaubnis zurückgezogen). Die E-Mail enthält einen Link: ein Klick bei Discord auf
        „Autorisieren“, und der Bot holt sie sofort auf den Server – ohne Anmeldung auf der Website. Der Link gilt 30 Tage und nur für das schon verknüpfte Discord-Konto.
      </p>
      <ReminderPanel
        rows={waiting.map((w) => ({
          ...w,
          deadline: null,
          detail: `Discord: ${w.discordUsername || '–'}${w.linkedAt ? ` · verknüpft am ${dateTime(w.linkedAt)}` : ''}`,
        }))}
        defaultDays={null}
        endpoint="/admin/mails/discord-join-reminder"
        empty="Alle verknüpften Konten sind auf dem Discord-Server (oder werden vom Bot automatisch hinzugefügt)."
        consequence={() => 'Sie bekommen einen Link, mit dem sie mit einem Klick dem Discord-Server beitreten.'}
        onSent={(res) => setWaiting((res as { waiting: AdminDiscordJoinWaitingDTO }).waiting.users)}
      />
    </div>
  );
}

/** Erinnerung „Panel-Zugang einrichten“ – nach Ablauf der Frist wird das Konto gelöscht */
export function PanelReminder({ initial }: { initial: AdminPanelWaitingDTO }) {
  const [waiting, setWaiting] = useState(initial.users);
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted">
        E-Mail an die ausgewählten Nutzer, die ihr Konto bestätigt, aber noch keinen Panel-Zugang eingerichtet haben: „Richte deinen Panel-Zugang ein – sonst wird dein Konto
        gelöscht.“ Die Mail nennt das Datum. Ist bis dahin kein Panel-Zugang eingerichtet, löscht das System das Konto samt offener Anfragen automatisch (Admins und
        Partner-Konten sind ausgenommen). Eine bereits laufende Frist verlängert sich durch eine weitere Erinnerung nicht.
      </p>
      <ReminderPanel
        rows={waiting.map((w) => ({
          ...w,
          detail: `registriert am ${dateTime(w.createdAt)}${w.servers.length ? ` · wartet: ${w.servers.join(', ')}` : ' · noch keine Server-Anfrage'}`,
        }))}
        defaultDays={3}
        endpoint="/admin/mails/panel-reminder"
        empty="Alle bestätigten Konten haben ihren Panel-Zugang eingerichtet."
        consequence={(days) => `Wer seinen Panel-Zugang nicht innerhalb von ${days} Tagen einrichtet, dessen Konto wird gelöscht.`}
        onSent={(res) => setWaiting((res as { waiting: AdminPanelWaitingDTO }).waiting.users)}
      />
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

type AbuseServer = { id: string; name: string; kind: string; status: string; flagged: boolean };
type WarningEffect = { count: number; sanction: 'none' | 'timeout' | 'ban' };
type AbusePreview = { title: { de: string; en: string }; body: { de: string; en: string }; locale: 'de' | 'en' | null; warning: WarningEffect | null };
/** Was eine Verwarnung auslöst – in Worten */
const effectText = (w: WarningEffect, rules: AdminAbuseDTO['warnings']['rules']) =>
  w.sanction === 'ban'
    ? `Das wird die ${w.count}. Verwarnung: Das Konto wird dauerhaft gesperrt (Ban), die Server werden nach ${rules.banDeleteDays} Tagen gelöscht.`
    : w.sanction === 'timeout'
      ? `Das wird die ${w.count}. Verwarnung: Alle Dienste des Nutzers gehen für ${rules.timeoutHours} Stunden offline.`
      : `Das wird die ${w.count}. Verwarnung (noch ohne Folge).`;
const validEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());
const SERVER_STATUS: Record<string, string> = { active: 'aktiv', expiring: 'läuft ab', suspended: 'gesperrt', provisioning: 'wird eingerichtet', provisioning_failed: 'Einrichtung fehlgeschlagen' };

/** Abuse-Bereich: Abuse-Mail senden (mit Vorschau und betroffenem Server), markierte Server und alle Abuse-Mails */
export function AbuseManager({ initial }: { initial: AdminAbuseDTO }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState(initial.reasons[0]?.id ?? 'other');
  const [note, setNote] = useState({ de: '', en: '' });
  const [suspend, setSuspend] = useState(false);
  // Verwarnungs-System: Jede Abuse-Mail zählt als Verwarnung – abwählbar („nur ein Hinweis“)
  const [warning, setWarning] = useState(true);
  const [manual, setManual] = useState({ email: '', note: '' });
  const [warnMessage, setWarnMessage] = useState<Message>(null);
  const [warnBusy, setWarnBusy] = useState<string | null>(null);
  // Wer den Verstoß festgestellt hat – Standard: das System
  const [source, setSource] = useState<'system' | 'manual'>('system');
  const [toggling, setToggling] = useState<string | null>(null);
  const [serverId, setServerId] = useState('');
  const [servers, setServers] = useState<AbuseServer[] | null>(null);
  const [preview, setPreview] = useState<AbusePreview | null>(null);
  const [previewLang, setPreviewLang] = useState<'de' | 'en'>('de');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const needsNote = reason === 'other';
  const shown = data.mails.filter((m) => !filter.trim() || m.userEmail.includes(filter.trim().toLowerCase()));
  const noteDe = note.de;
  const noteEn = note.en;

  // Server des Nutzers laden, sobald eine gültige Adresse eingegeben ist
  useEffect(() => {
    setServerId('');
    if (!validEmail(email)) return void setServers(null);
    let stop = false;
    const timer = setTimeout(() => {
      api<{ servers: AbuseServer[] }>(`/admin/abuse/servers?email=${encodeURIComponent(email.trim())}`)
        .then((r) => !stop && setServers(r.servers))
        .catch(() => !stop && setServers(null));
    }, 400);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [email]);

  // Vorschau: genau der Text, den die Mail enthält – neu geladen, sobald sich etwas ändert
  useEffect(() => {
    let stop = false;
    const timer = setTimeout(() => {
      api<{ preview: AbusePreview }>('/admin/abuse/preview', {
        body: { email: validEmail(email) ? email.trim() : 'vorschau@example.com', reason, note: { de: noteDe, en: noteEn }, suspend, serverId: serverId || null, warning },
      })
        .then((r) => {
          if (stop) return;
          setPreview(r.preview);
          if (r.preview.locale) setPreviewLang(r.preview.locale);
        })
        .catch(() => !stop && setPreview(null));
    }, 300);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [email, reason, noteDe, noteEn, suspend, serverId, warning]);

  async function send() {
    const target = servers?.find((x) => x.id === serverId);
    const effect = warning && preview?.warning ? `\n\n${effectText(preview.warning, data.warnings.rules)}` : warning ? '' : '\n\nZählt NICHT als Verwarnung (nur ein Hinweis).';
    if (!window.confirm(`Abuse-Mail an ${email} senden${target ? ` – Server „${target.name}“ wird als Abuse markiert` : ''}${suspend ? (target ? ' und gesperrt' : ' und alle Server dieses Nutzers werden gesperrt') : ''}?${effect}`)) return;
    setPending(true);
    setMessage(null);
    try {
      const res = await api<{ suspended: number; warning: (WarningEffect & { until: string | null }) | null; abuse: AdminAbuseDTO }>('/admin/abuse', { body: { email: email.trim(), reason, note, suspend, serverId: serverId || null, source, warning } });
      setData(res.abuse);
      setMessage({ ok: true, text: `Abuse-Mail wird versendet${target ? ' – Server ist als Abuse markiert' : ''}${res.suspended ? ` – ${res.suspended} Server gesperrt` : ''}${res.warning ? ` – ${res.warning.count}. Verwarnung${res.warning.sanction === 'timeout' ? `, Auszeit bis ${res.warning.until ? dateTime(res.warning.until) : ''}` : res.warning.sanction === 'ban' ? ', Konto gebannt' : ''}` : ' – ohne Verwarnung'}.` });
      setNote({ de: '', en: '' });
      setSuspend(false);
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setPending(false);
    }
  }

  /** Aktion im Verwarnungs-System ausführen und die Liste neu laden */
  async function warnAction(key: string, path: string, body: unknown, done: string, ask?: string): Promise<boolean> {
    if (ask && !window.confirm(ask)) return false;
    setWarnBusy(key);
    setWarnMessage(null);
    try {
      setData((await api<{ abuse: AdminAbuseDTO }>(path, { body })).abuse);
      setWarnMessage({ ok: true, text: done });
      router.refresh();
      return true;
    } catch (err) {
      setWarnMessage({ ok: false, text: errorText(err) });
      return false;
    } finally {
      setWarnBusy(null);
    }
  }

  async function clearFlag(id: string) {
    try {
      setData((await api<{ abuse: AdminAbuseDTO }>(`/admin/abuse/${id}/clear`, { body: {} })).abuse);
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    }
  }

  return (
    <div className="space-y-5">
      <section className="surface p-5 sm:p-6">
        <h2 className="text-[15px] font-semibold text-white">Abuse-Mail senden</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
          Verwarnt einen Nutzer per E-Mail (und unter „Meine Server“). Wählst du den betroffenen Server aus, wird er dort rot als „Abuse“ markiert – mit dem Hinweis, ein
          Ticket auf Discord zu öffnen. Rechts siehst du genau den Text, den die Mail enthält.
        </p>
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <Labeled label="E-Mail-Adresse des Nutzers">
              <input className="input" type="email" value={email} placeholder="nutzer@example.com" onChange={(e) => setEmail(e.target.value)} />
            </Labeled>
            <Labeled
              label="Betroffener Server"
              hint={
                !validEmail(email)
                  ? 'Erst die E-Mail-Adresse eingeben – dann erscheinen hier die Server des Nutzers.'
                  : servers === null
                    ? 'Server werden geladen …'
                    : servers.length === 0
                      ? 'Zu dieser Adresse gibt es keinen Account oder keinen Server.'
                      : 'Der ausgewählte Server wird unter „Meine Server“ als Abuse markiert.'
              }
            >
              <select className="input" value={serverId} disabled={!servers || servers.length === 0} onChange={(e) => setServerId(e.target.value)}>
                <option value="">kein bestimmter Server</option>
                {(servers ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} – {x.kind === 'discord' ? 'Discord-Bot' : 'Minecraft'}, {SERVER_STATUS[x.status] ?? x.status}
                    {x.flagged ? ' (bereits markiert)' : ''}
                  </option>
                ))}
              </select>
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
              <textarea className="input min-h-[84px] py-2.5 leading-relaxed" rows={3} value={note.de} maxLength={3000} onChange={(e) => setNote({ ...note, de: e.target.value })} />
            </Labeled>
            <Labeled label="Eigener Text (Englisch) – optional" hint="Leer = der deutsche Text geht auch an englischsprachige Nutzer.">
              <textarea className="input min-h-[84px] py-2.5 leading-relaxed" rows={3} value={note.en} maxLength={3000} onChange={(e) => setNote({ ...note, en: e.target.value })} />
            </Labeled>
            <Labeled label="Festgestellt" hint="Steht so in der Liste unten und lässt sich dort nachträglich umschalten.">
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Festgestellt">
                {(['system', 'manual'] as const).map((v) => (
                  <label key={v} className={cn('cursor-pointer rounded-lg border px-3 py-2 text-center text-sm transition-colors', source === v ? 'border-blue-500 bg-blue-500/[0.08] text-white' : 'border-line-strong text-muted hover:border-white/25')}>
                    <input type="radio" name="abuse-source" className="sr-only" checked={source === v} onChange={() => setSource(v)} />
                    {v === 'system' ? 'vom System' : 'von Hand'}
                  </label>
                ))}
              </div>
            </Labeled>
            <Toggle
              checked={suspend}
              onChange={setSuspend}
              label={serverId ? 'Diesen Server sofort sperren' : 'Alle Server dieses Nutzers sofort sperren'}
              hint="Die Mail nennt dann die Sperre. Entsperren geht im Reiter „Server“."
            />
            <Toggle
              checked={warning}
              onChange={setWarning}
              label="Als Verwarnung zählen"
              hint={
                warning
                  ? (preview?.warning ? effectText(preview.warning, data.warnings.rules) : `Ab der ${data.warnings.rules.timeoutFrom}. Verwarnung: ${data.warnings.rules.timeoutHours} Stunden offline, bei der ${data.warnings.rules.banAt}.: Ban.`) + ' Die Mail nennt das.'
                  : 'Nur ein Hinweis: Die Mail geht raus, zählt aber nicht als Verwarnung.'
              }
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-gray-200">Vorschau der Mail</p>
              <div className="flex gap-1 text-[12px]">
                {(['de', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setPreviewLang(l)}
                    aria-pressed={previewLang === l}
                    className={cn('rounded-md border px-2 py-1', previewLang === l ? 'border-blue-400/60 bg-blue-500/10 text-white' : 'border-line-strong text-muted hover:text-white')}
                  >
                    {l === 'de' ? 'Deutsch' : 'Englisch'}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 rounded-lg border border-line bg-black/25 p-4">
              {preview ? (
                <>
                  <p className="text-[12px] text-subtle">Betreff</p>
                  <p className="text-sm font-semibold text-white">{preview.title[previewLang]}</p>
                  <p className="mt-3 text-[12px] text-subtle">Text</p>
                  <div className="mt-1 space-y-2 text-sm leading-relaxed text-gray-200">
                    {preview.body[previewLang].split('\n').map((line, i) => (
                      <p key={i} className="break-words">
                        {line}
                      </p>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-subtle">{needsNote && !note.de.trim() && !note.en.trim() ? 'Bei „Sonstiger Verstoß“ bitte einen eigenen Text eingeben.' : 'Vorschau wird geladen …'}</p>
              )}
            </div>
            <p className="mt-2 text-[13px] text-subtle">
              {preview?.locale ? `Dieser Nutzer bekommt die Mail auf ${preview.locale === 'de' ? 'Deutsch' : 'Englisch'}.` : 'Jeder Nutzer bekommt die Mail in seiner Sprache.'} Darunter steht in der
              Mail der Knopf „Meine Server“.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="danger" icon={<Send />} loading={pending} disabled={!validEmail(email) || (needsNote && !note.de.trim() && !note.en.trim())} onClick={() => void send()}>
            Abuse-Mail senden
          </Button>
          <Note message={message} />
        </div>
      </section>

      <section className="surface p-5 sm:p-6">
        <h2 className="text-[15px] font-semibold text-white">Verwarnungen</h2>
        <p className="mt-1 text-sm text-muted">
          Jede Abuse-Mail zählt als eine Verwarnung (oben abwählbar). Ab der {data.warnings.rules.timeoutFrom}. aktiven Verwarnung gehen alle Dienste des Nutzers für {data.warnings.rules.timeoutHours} Stunden offline, bei der{' '}
          {data.warnings.rules.banAt}. wird das Konto dauerhaft gesperrt und die Server werden nach {data.warnings.rules.banDeleteDays} Tagen gelöscht. Verwarnungen verfallen nach {data.warnings.rules.expireDays} Tagen. Eine
          zurückgenommene Verwarnung hebt eine laufende Auszeit oder einen Ban nicht von selbst auf – dafür gibt es die Knöpfe beim Nutzer.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end">
          <Labeled label="Verwarnung ohne Abuse-Mail">
            <input className="input" type="email" placeholder="E-Mail-Adresse des Nutzers" value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} />
          </Labeled>
          <Labeled label="Grund (steht so in der Nachricht an den Nutzer – auch bei englischsprachigen)">
            <input className="input" maxLength={500} value={manual.note} onChange={(e) => setManual({ ...manual, note: e.target.value })} />
          </Labeled>
          <Button
            variant="secondary"
            loading={warnBusy === 'manual'}
            disabled={!validEmail(manual.email) || !manual.note.trim()}
            onClick={() =>
              void warnAction('manual', '/admin/warnings', { email: manual.email.trim(), note: { de: manual.note.trim(), en: '' } }, 'Verwarnung eingetragen – der Nutzer wird benachrichtigt.', `${manual.email} verwarnen? Der Nutzer bekommt eine Nachricht; je nach Stand folgt eine Auszeit oder der Ban.`).then((ok) => ok && setManual({ email: '', note: '' }))
            }
          >
            Verwarnen
          </Button>
        </div>
        <div className="mt-3">
          <Note message={warnMessage} />
        </div>
        {data.warnings.users.length === 0 ? (
          <p className="mt-4 text-sm text-subtle">Noch keine Verwarnungen.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {data.warnings.users.map((u) => (
              <li key={u.userId} className="py-3.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <p className="min-w-0 break-all text-sm font-medium text-white">{u.email}</p>
                  <span className={cn('rounded px-1.5 py-0.5 text-[11px]', u.active >= data.warnings.rules.timeoutFrom ? 'bg-red-400/15 text-red-200' : u.active > 0 ? 'bg-amber-400/15 text-amber-200' : 'bg-white/5 text-subtle')}>
                    {u.active} von {data.warnings.rules.banAt} aktiv
                  </span>
                  {u.bannedAt && <span className="rounded bg-red-500 px-1.5 py-0.5 text-[11px] text-white">gebannt seit {dateTime(u.bannedAt)}</span>}
                  {u.bannedAt && u.banDeleteAt && <span className="text-[12px] text-subtle">Server werden gelöscht am {dateTime(u.banDeleteAt)}</span>}
                  {u.suspendedUntil && <span className="rounded bg-red-400/15 px-1.5 py-0.5 text-[11px] text-red-200">Auszeit bis {dateTime(u.suspendedUntil)}</span>}
                  <span className="ml-auto flex flex-wrap gap-2">
                    {u.suspendedUntil && (
                      <Button variant="secondary" size="sm" loading={warnBusy === `t:${u.userId}`} onClick={() => void warnAction(`t:${u.userId}`, `/admin/users/${u.userId}/timeout/end`, {}, 'Auszeit beendet – die Server sind wieder freigegeben.', `Auszeit von ${u.email} jetzt beenden?`)}>
                        Auszeit beenden
                      </Button>
                    )}
                    {u.bannedAt && (
                      <Button variant="secondary" size="sm" loading={warnBusy === `b:${u.userId}`} onClick={() => void warnAction(`b:${u.userId}`, `/admin/users/${u.userId}/unban`, {}, 'Ban aufgehoben – Konto und Server sind wieder freigegeben.', `Ban von ${u.email} aufheben? Konto und Server werden wieder freigegeben. Bleiben ${data.warnings.rules.banAt} Verwarnungen aktiv, führt schon die nächste wieder zum Ban.`)}>
                        Ban aufheben
                      </Button>
                    )}
                  </span>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {u.items.map((w) => (
                    <li key={w.id} className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px]', w.state === 'active' ? 'text-gray-200' : 'text-subtle line-through decoration-white/20')}>
                      <span>{dateTime(w.at)}</span>
                      <span>· {w.reason}</span>
                      {w.serverName && <span>· Server „{w.serverName}“</span>}
                      {w.note && <span className="break-words">· {w.note}</span>}
                      {w.by && <span>· von {w.by}</span>}
                      <span className="no-underline">· {w.state === 'active' ? `verfällt am ${dateTime(w.expiresAt)}` : w.state === 'revoked' ? 'zurückgenommen' : 'verfallen'}</span>
                      {w.state === 'active' && (
                        <button type="button" className="text-blue-300 underline-offset-2 hover:underline disabled:opacity-50" disabled={warnBusy === w.id} onClick={() => void warnAction(w.id, `/admin/warnings/${w.id}/revoke`, {}, 'Verwarnung zurückgenommen.', 'Diese Verwarnung zurücknehmen? Sie zählt dann nicht mehr mit.')}>
                          zurücknehmen
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="surface p-5 sm:p-6">
        <h2 className="text-[15px] font-semibold text-white">Als Abuse markierte Server</h2>
        <p className="mt-1 text-sm text-muted">Diese Server sind beim Nutzer rot markiert – dort steht auch, ob der Verstoß vom System oder vom Team festgestellt wurde (Klick auf die Kennzeichnung schaltet um). Hebe die Markierung auf, sobald das Ticket geklärt ist.</p>
        {data.flagged.length === 0 ? (
          <p className="mt-4 text-sm text-subtle">Aktuell ist kein Server markiert.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-lg border border-red-400/25">
            {data.flagged.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3.5 py-3">
                <span className="min-w-0">
                  <span className="text-sm font-medium text-white">{f.name}</span>
                  <span className="ml-2 rounded bg-red-400/15 px-1.5 py-0.5 text-[11px] text-red-200">Abuse</span>
                  <span className="mt-0.5 block text-[12px] text-subtle">
                    {f.ownerEmail} · {f.reason} · seit {dateTime(f.at)} · {SERVER_STATUS[f.status] ?? f.status}
                  </span>
                </span>
                {/* Wird dem Nutzer in der roten Karte unter „Meine Server“ angezeigt – per Klick umschalten */}
                <button
                  type="button"
                  disabled={toggling !== null}
                  title="Klicken zum Umschalten – der Nutzer sieht diese Angabe unter „Meine Server“"
                  onClick={async () => {
                    setToggling(f.id);
                    try {
                      setData((await api<{ abuse: AdminAbuseDTO }>(`/admin/abuse/${f.id}/source`, { body: { source: f.source === 'manual' ? 'system' : 'manual' } })).abuse);
                      router.refresh();
                    } catch (err) {
                      setMessage({ ok: false, text: errorText(err) });
                    } finally {
                      setToggling(null);
                    }
                  }}
                  className={cn('shrink-0 rounded border px-2 py-1 text-[11px] transition-colors disabled:opacity-50', f.source === 'manual' ? 'border-red-400/40 bg-red-400/15 text-red-200 hover:bg-red-400/25' : 'border-blue-400/40 bg-blue-400/10 text-blue-200 hover:bg-blue-400/20')}
                >
                  {toggling === f.id ? '…' : f.source === 'manual' ? 'von Hand' : 'vom System'}
                </button>
                <Button variant="secondary" size="sm" onClick={() => void clearFlag(f.id)}>
                  Markierung aufheben
                </Button>
              </li>
            ))}
          </ul>
        )}
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
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pr-3.5">
                <button type="button" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-3 text-left hover:bg-white/[0.03]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-100">{m.title}</span>
                    <span className="mt-0.5 block text-[12px] text-subtle">
                      {dateTime(m.createdAt)} · {m.userEmail}
                      {m.serverName ? ` · Server „${m.serverName}“` : ''}
                    </span>
                  </span>
                  <span className={cn('w-24 shrink-0 text-right text-[12px]', m.emailStatus === 'sent' ? 'text-emerald-300' : m.emailStatus === 'failed' ? 'text-red-300' : 'text-amber-300')}>
                    {m.emailStatus === 'sent' ? 'zugestellt' : m.emailStatus === 'failed' ? 'fehlgeschlagen' : m.emailStatus === 'pending' ? 'wird gesendet' : 'ohne E-Mail'}
                  </span>
                </button>
                {/* Kennzeichnung: per Klick umschalten zwischen „vom System“ und „von Hand“ */}
                <button
                  type="button"
                  disabled={toggling !== null}
                  title="Klicken zum Umschalten: vom System oder von Hand festgestellt"
                  aria-label={`Festgestellt ${m.manual ? 'von Hand' : 'vom System'} – umschalten`}
                  onClick={async () => {
                    setToggling(m.id);
                    try {
                      setData((await api<{ abuse: AdminAbuseDTO }>(`/admin/abuse/mail/${m.id}/source`, { body: { source: m.manual ? 'system' : 'manual' } })).abuse);
                    } catch (err) {
                      setMessage({ ok: false, text: errorText(err) });
                    } finally {
                      setToggling(null);
                    }
                  }}
                  className={cn('shrink-0 rounded border px-2 py-1 text-[11px] transition-colors disabled:opacity-50', m.manual ? 'border-red-400/40 bg-red-400/15 text-red-200 hover:bg-red-400/25' : 'border-blue-400/40 bg-blue-400/10 text-blue-200 hover:bg-blue-400/20')}
                >
                  {toggling === m.id ? '…' : m.manual ? 'von Hand' : m.type.startsWith('abuse.') ? 'vom System' : `vom System · ${AUTO_LABEL[m.type] ?? 'automatisch'}`}
                </button>
                </div>
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
