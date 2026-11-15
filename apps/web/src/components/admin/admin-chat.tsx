'use client';

/**
 * Admin → Chat: Support-Chat „Crafting AI“ ein- und ausschalten, API-Schlüssel für Claude, Kostenbremse,
 * vorgefertigte Antworten, Zusatzwissen, Weitergabe an Mitarbeiter und die letzten Unterhaltungen.
 * Der API-Schlüssel wird nur gesendet, nie zurückgegeben – ein leeres Feld lässt den gespeicherten Wert unverändert.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CheckCircle2, ChevronDown, KeyRound, Plus, Save, Trash2, XCircle } from 'lucide-react';
import { chatLimits, type AdminChatDTO, type ChatCannedAnswer, type ChatMessageDTO, type ChatSettings, type Localized, type SiteSettings } from '@chfree/shared';
import { Labeled, NumberInput, Section, Toggle } from '@/components/admin/admin-settings';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Message = { ok: boolean; text: string } | null;

const errorText = (err: unknown) => (err instanceof ApiClientError ? err.message : 'Das hat nicht geklappt.');
const usd = (v: number) => `${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: v > 0 && v < 1 ? 4 : 2 })} $`;
const dateTime = (iso: string) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Stichwörter aus einem Textfeld: getrennt durch Komma oder Zeilenumbruch */
const parseKeywords = (text: string) => [...new Set(text.split(/[,\n]+/).map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 2))].slice(0, chatLimits.keywords);

const STATUS: Record<AdminChatDTO['conversations'][number]['status'], { label: string; cls: string }> = {
  open: { label: 'Chat', cls: 'bg-white/[0.06] text-muted' },
  handoff_pending: { label: 'wartet auf Discord', cls: 'bg-amber-400/15 text-amber-200' },
  handed_off: { label: 'Ticket eröffnet', cls: 'bg-emerald-500/15 text-emerald-300' },
};

const SOURCE: Record<ChatMessageDTO['source'], string> = { user: 'Besucher', ai: 'KI', canned: 'Vorlage', system: 'Ablauf' };

function Note({ message }: { message: Message }) {
  return message ? <span className={cn('text-sm', message.ok ? 'text-emerald-300' : 'text-red-300')}>{message.text}</span> : null;
}

/** Zwei Felder nebeneinander: Deutsch und Englisch */
function Bilingual({ label, value, onChange, area, maxLength, hint }: { label: string; value: Localized; onChange: (v: Localized) => void; area?: boolean; maxLength: number; hint?: string }) {
  const field = (lang: 'de' | 'en') =>
    area ? (
      <textarea className="input min-h-[88px] py-2.5 leading-relaxed" rows={3} value={value[lang]} maxLength={maxLength} onChange={(e) => onChange({ ...value, [lang]: e.target.value })} />
    ) : (
      <input type="text" className="input" value={value[lang]} maxLength={maxLength} onChange={(e) => onChange({ ...value, [lang]: e.target.value })} />
    );
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Labeled label={`${label} (Deutsch)`}>{field('de')}</Labeled>
        <Labeled label={`${label} (Englisch)`}>{field('en')}</Labeled>
      </div>
      {hint && <p className="mt-1.5 text-[13px] text-subtle">{hint}</p>}
    </div>
  );
}

export function ChatAdmin({ settings, status: initialStatus }: { settings: SiteSettings; status: AdminChatDTO }) {
  const router = useRouter();
  const [c, setC] = useState<ChatSettings>(settings.chat);
  const [baseline, setBaseline] = useState(() => JSON.stringify(settings.chat));
  const [status, setStatus] = useState(initialStatus);
  const [apiKey, setApiKey] = useState('');
  // Stichwörter als freier Text je Antwort – sonst ließe sich kein Komma tippen
  const [keywordText, setKeywordText] = useState<Record<string, string>>(() => Object.fromEntries(settings.chat.canned.map((a) => [a.id, a.keywords.join(', ')])));
  const [pending, setPending] = useState<'save' | 'test' | 'clear' | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [keyMessage, setKeyMessage] = useState<Message>(null);

  const set = (patch: Partial<ChatSettings>) => setC((v) => ({ ...v, ...patch }));
  const setCanned = (id: string, patch: Partial<ChatCannedAnswer>) => setC((v) => ({ ...v, canned: v.canned.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  const dirty = JSON.stringify(c) !== baseline || !!apiKey.trim();
  const discordReady = settings.discord.enabled && !!settings.discord.guildId;

  async function save(): Promise<boolean> {
    setPending('save');
    setMessage(null);
    try {
      if (apiKey.trim()) {
        setStatus((await api<{ chat: AdminChatDTO }>('/admin/chat/secrets', { body: { apiKey: apiKey.trim() } })).chat);
        setApiKey('');
      }
      // Aktuellen Stand holen, damit Änderungen aus anderen Reitern nicht überschrieben werden
      const current = (await api<{ settings: SiteSettings }>('/admin/settings')).settings;
      const saved = (await api<{ settings: SiteSettings }>('/admin/settings', { body: { ...current, chat: c } })).settings.chat;
      setC(saved);
      setBaseline(JSON.stringify(saved));
      setKeywordText(Object.fromEntries(saved.canned.map((a) => [a.id, a.keywords.join(', ')])));
      setStatus((await api<{ chat: AdminChatDTO }>('/admin/chat')).chat);
      setMessage({ ok: true, text: 'Gespeichert. Die Website übernimmt Änderungen innerhalb von etwa einer Minute.' });
      router.refresh();
      return true;
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
      return false;
    } finally {
      setPending(null);
    }
  }

  async function testKey() {
    if (apiKey.trim() && !(await save())) return;
    setPending('test');
    setKeyMessage(null);
    try {
      const res = await api<{ ok: boolean; model: string }>('/admin/chat/test', { body: {} });
      setKeyMessage({ ok: true, text: `Schlüssel funktioniert – Modell: ${res.model}.` });
    } catch (err) {
      setKeyMessage({ ok: false, text: errorText(err) });
    } finally {
      setPending(null);
    }
  }

  async function clearKey() {
    if (!window.confirm('Den gespeicherten API-Schlüssel wirklich löschen? Der Chat antwortet danach nur noch mit vorgefertigten Antworten.')) return;
    setPending('clear');
    setKeyMessage(null);
    try {
      setStatus((await api<{ chat: AdminChatDTO }>('/admin/chat/secrets', { body: { clear: true } })).chat);
      setKeyMessage({ ok: true, text: 'Schlüssel gelöscht.' });
      router.refresh();
    } catch (err) {
      setKeyMessage({ ok: false, text: errorText(err) });
    } finally {
      setPending(null);
    }
  }

  function addCanned() {
    const id = `antwort-${Date.now().toString(36)}`;
    setC((v) => ({ ...v, canned: [...v.canned, { id, question: { de: '', en: '' }, answer: { de: '', en: '' }, keywords: [], quick: false }] }));
    setKeywordText((v) => ({ ...v, [id]: '' }));
  }

  const aiActive = c.enabled && c.aiEnabled && (status.hasApiKey || !!apiKey.trim()) && !status.budgetReached;
  const budgetShare = c.monthlyBudgetUsd > 0 ? Math.min(100, (status.usage.costUsd / c.monthlyBudgetUsd) * 100) : 0;

  return (
    <div className="space-y-5">
      {c.enabled && c.aiEnabled && !status.hasApiKey && !apiKey.trim() && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/[0.08] p-4 text-sm leading-relaxed text-amber-100">
          <p className="font-semibold text-white">Die KI ist eingeschaltet, aber es ist kein API-Schlüssel hinterlegt</p>
          <p className="mt-1">Der Chat antwortet im Moment nur mit den vorgefertigten Antworten und bietet sonst die Weitergabe an einen Mitarbeiter an.</p>
        </div>
      )}
      {status.budgetReached && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/[0.08] p-4 text-sm leading-relaxed text-amber-100">
          <p className="font-semibold text-white">Das Monatsbudget der KI ist aufgebraucht</p>
          <p className="mt-1">Bis zum Monatswechsel antwortet der Chat nur noch mit vorgefertigten Antworten. Du kannst das Budget unten erhöhen.</p>
        </div>
      )}
      {status.lastError && (
        <div className="rounded-xl border border-red-400/40 bg-red-400/[0.08] p-4 text-sm leading-relaxed text-red-200">
          <p className="font-semibold text-white">Letzter Fehler der KI-Anbindung ({dateTime(status.lastError.at)})</p>
          <p className="mt-1">{status.lastError.message}</p>
        </div>
      )}
      {c.enabled && c.handoff.enabled && !discordReady && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/[0.08] p-4 text-sm leading-relaxed text-amber-100">
          <p className="font-semibold text-white">Die Weitergabe an Mitarbeiter braucht die Discord-Anbindung</p>
          <p className="mt-1">Unter „Discord“ ist die Anbindung noch nicht eingerichtet. Solange zeigt der Chat keinen Knopf „Mit einem Mitarbeiter sprechen“.</p>
        </div>
      )}

      <Section
        title="Support-Chat „Crafting AI“"
        description="Der Chat erscheint unten rechts auf der Website – mit eurem Logo aus Einstellungen → Logo. Er ist für Besucher klar als KI bzw. automatischer Assistent gekennzeichnet und beantwortet ausschließlich Fragen zu CraftingHosting.free."
      >
        <Toggle checked={c.enabled} onChange={(enabled) => set({ enabled })} label="Chat auf der Website anzeigen" hint="Ausgeschaltet verschwindet das Chat-Symbol vollständig." />
        <Labeled label="Name des Assistenten" className="max-w-sm">
          <input type="text" className="input" value={c.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} />
        </Labeled>
        <Bilingual label="Sprechblase" value={c.teaser} onChange={(teaser) => set({ teaser })} maxLength={120} hint="Poppt einmal je Besuch kurz neben dem Chat-Symbol auf." />
        <Bilingual label="Begrüßung im Chat" value={c.welcome} onChange={(welcome) => set({ welcome })} maxLength={500} area />
      </Section>

      <Section
        title="KI-Antworten (Claude)"
        description="Fragen, zu denen es keine vorgefertigte Antwort gibt, beantwortet die KI. Sie kennt nur das öffentliche Wissen über die Website (siehe „Wissen“ unten) – keine Konten, keine Server und nichts aus dem Admin-Bereich."
      >
        <Toggle checked={c.aiEnabled} onChange={(aiEnabled) => set({ aiEnabled })} label="KI-Antworten einschalten" hint="Ausgeschaltet gibt es nur vorgefertigte Antworten und die Weitergabe an Mitarbeiter – ganz ohne Kosten." />
        <div>
          <Labeled
            label="API-Schlüssel von Anthropic"
            hint={
              <>
                Erstellen unter{' '}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" className="text-blue-400 hover:text-blue-300">
                  console.anthropic.com → API Keys
                </a>
                . Der Schlüssel wird verschlüsselt gespeichert und nie wieder angezeigt. Leer lassen = gespeicherten Schlüssel behalten.
              </>
            }
          >
            <input
              type="password"
              className="input max-w-xl font-mono text-[13px]"
              value={apiKey}
              maxLength={300}
              autoComplete="new-password"
              placeholder={status.hasApiKey ? '•••••••• (gespeichert)' : 'sk-ant-…'}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Labeled>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={cn('inline-flex items-center gap-1.5 text-sm', status.hasApiKey ? 'text-emerald-300' : 'text-subtle')}>
              {status.hasApiKey ? <CheckCircle2 className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
              {status.hasApiKey ? 'Schlüssel hinterlegt' : 'Kein Schlüssel hinterlegt'}
            </span>
            <Button variant="secondary" size="sm" icon={<KeyRound />} loading={pending === 'test'} disabled={pending !== null || (!status.hasApiKey && !apiKey.trim())} onClick={testKey}>
              Schlüssel prüfen
            </Button>
            {status.hasApiKey && (
              <Button variant="danger" size="sm" icon={<Trash2 />} loading={pending === 'clear'} disabled={pending !== null} onClick={clearKey}>
                Schlüssel löschen
              </Button>
            )}
            <Note message={keyMessage} />
          </div>
          <p className="mt-1.5 text-[13px] text-subtle">Die Prüfung kostet kein Guthaben.</p>
        </div>

        <div className="rounded-lg border border-line bg-black/20 p-4 text-sm leading-relaxed text-muted">
          <p>
            <span className="font-medium text-gray-100">Modell: automatisch das günstigste</span> – aktuell <code className="text-gray-200">{status.model}</code> (Claude Haiku). Eine
            Antwort kostet damit im Schnitt deutlich weniger als einen Zehntel Cent.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <Labeled label="Monatsbudget in US-Dollar" hint="Ist es erreicht, antwortet bis zum Monatswechsel nur noch der vorgefertigte Teil. 0 = keine Grenze (nicht empfohlen).">
            <NumberInput value={c.monthlyBudgetUsd} onChange={(monthlyBudgetUsd) => set({ monthlyBudgetUsd })} min={0} max={10000} step={1} />
          </Labeled>
          <Labeled label="Länge einer KI-Antwort (Tokens)" hint="150–2000. 500 reicht für etwa 300 Wörter – kürzer ist günstiger.">
            <NumberInput value={c.maxAnswerTokens} onChange={(maxAnswerTokens) => set({ maxAnswerTokens })} min={150} max={2000} step={50} />
          </Labeled>
          <Labeled label="Nachrichten je Unterhaltung" hint="5–200. Danach muss der Besucher eine neue Unterhaltung beginnen.">
            <NumberInput value={c.maxMessages} onChange={(maxMessages) => set({ maxMessages })} min={5} max={200} />
          </Labeled>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-200">Verbrauch im laufenden Monat ({status.usage.month})</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-4">
            {[
              ['Kosten (geschätzt)', usd(status.usage.costUsd)],
              ['KI-Antworten', status.usage.requests.toLocaleString('de-DE')],
              ['Eingabe-Tokens', status.usage.inputTokens.toLocaleString('de-DE')],
              ['Ausgabe-Tokens', status.usage.outputTokens.toLocaleString('de-DE')],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-line bg-black/20 px-3.5 py-3">
                <p className="text-[12px] text-subtle">{label}</p>
                <p className="mt-0.5 text-[15px] font-semibold text-white tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          {c.monthlyBudgetUsd > 0 && (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                <div className={cn('h-full rounded-full', budgetShare >= 100 ? 'bg-red-400' : budgetShare >= 80 ? 'bg-amber-400' : 'bg-blue-500')} style={{ width: `${Math.max(budgetShare, status.usage.costUsd > 0 ? 1 : 0)}%` }} />
              </div>
              <p className="mt-1.5 text-[13px] text-subtle">
                {usd(status.usage.costUsd)} von {usd(c.monthlyBudgetUsd)} · {aiActive ? 'KI antwortet' : 'KI antwortet derzeit nicht'}. Maßgeblich für die Abrechnung ist die Übersicht bei Anthropic.
              </p>
            </div>
          )}
        </div>
      </Section>

      <Section
        title="Vorgefertigte Antworten"
        description="Diese Antworten kommen sofort und ohne Kosten – wenn ein Besucher einen Vorschlag anklickt oder eine kurze Frage eines der Stichwörter enthält. Ohne Antworttext gibt der Chat direkt an einen Mitarbeiter weiter."
      >
        <div className="space-y-4">
          {c.canned.map((a, index) => (
            <div key={a.id} className="rounded-lg border border-line bg-black/20 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-gray-100">
                  {index + 1}. {a.question.de || 'Neue Antwort'}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 />}
                  onClick={() => setC((v) => ({ ...v, canned: v.canned.filter((x) => x.id !== a.id) }))}
                >
                  Entfernen
                </Button>
              </div>
              <div className="space-y-4">
                <Bilingual label="Frage" value={a.question} onChange={(question) => setCanned(a.id, { question })} maxLength={160} />
                <Bilingual label="Antwort" value={a.answer} onChange={(answer) => setCanned(a.id, { answer })} maxLength={1500} area />
                <Labeled label="Stichwörter" hint={`Mit Komma getrennt, höchstens ${chatLimits.keywords}, Deutsch und Englisch gemischt. Es zählen ganze Wörter bzw. Wortfolgen, z. B. „startet nicht“.`}>
                  <input
                    type="text"
                    className="input"
                    value={keywordText[a.id] ?? ''}
                    onChange={(e) => {
                      setKeywordText((v) => ({ ...v, [a.id]: e.target.value }));
                      setCanned(a.id, { keywords: parseKeywords(e.target.value) });
                    }}
                  />
                </Labeled>
                <Toggle checked={a.quick} onChange={(quick) => setCanned(a.id, { quick })} label="Als Vorschlag unter der Begrüßung anzeigen" />
              </div>
            </div>
          ))}
        </div>
        <Button variant="secondary" size="sm" icon={<Plus />} disabled={c.canned.length >= chatLimits.canned} onClick={addCanned}>
          Antwort hinzufügen
        </Button>
      </Section>

      <Section
        title="Wissen der KI"
        description={
          <>
            Grundlage ist die Datei <code className="text-gray-200">apps/api/knowledge/support.md</code> auf dem Server – dort steht, wie das Angebot funktioniert. Pakete, Regeln
            und Links ergänzt das System automatisch aus den Einstellungen. Hier kannst du zusätzlich eigenes Wissen hinterlegen, ohne die Datei zu bearbeiten.
          </>
        }
      >
        <Labeled label="Zusatzwissen" hint={`Nur Dinge, die Besucher wissen dürfen – keine Zugangsdaten, keine internen Abläufe. ${c.extraKnowledge.length.toLocaleString('de-DE')} / ${chatLimits.extraKnowledge.toLocaleString('de-DE')} Zeichen.`}>
          <textarea
            className="input min-h-[160px] py-2.5 font-mono text-[13px] leading-relaxed"
            rows={7}
            value={c.extraKnowledge}
            maxLength={chatLimits.extraKnowledge}
            placeholder="z. B. Aktuell gibt es Lieferverzögerungen bei neuen Servern am Standort Frankfurt …"
            onChange={(e) => set({ extraKnowledge: e.target.value })}
          />
        </Labeled>
      </Section>

      <Section
        title="Weitergabe an einen Mitarbeiter"
        description="Kann die KI nicht helfen oder möchte der Besucher mit einem Menschen sprechen, schickt der Chat den Verbindungslink zu Discord. Nach der Zustimmung tritt der Besucher automatisch eurem Discord-Server bei, der Bot eröffnet ein Ticket mit dem bisherigen Verlauf und meldet es im Team-Kanal."
      >
        <Toggle checked={c.handoff.enabled} onChange={(enabled) => set({ handoff: { ...c.handoff, enabled } })} label="Weitergabe über ein Discord-Ticket anbieten" hint="Braucht die eingerichtete Discord-Anbindung (Reiter „Discord“) samt Ticketsystem." />
        <Labeled label="Kanal für die Meldung an das Team" hint="Kanal-ID. Der Bot postet dort „Es wurde ein Support-Ticket erstellt“ mit Link zum Ticket. Leer = keine Meldung." className="max-w-sm">
          <input
            type="text"
            inputMode="numeric"
            className="input font-mono text-[13px]"
            value={c.handoff.notifyChannelId}
            placeholder="z. B. 123456789012345678"
            onChange={(e) => set({ handoff: { ...c.handoff, notifyChannelId: e.target.value.replace(/\D/g, '').slice(0, 22) } })}
          />
        </Labeled>
        <Labeled label="Unterhaltungen aufbewahren (Tage)" hint="1–365. Danach werden Unterhaltungen automatisch gelöscht." className="max-w-sm">
          <NumberInput value={c.retentionDays} onChange={(retentionDays) => set({ retentionDays })} min={1} max={365} />
        </Labeled>
      </Section>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-line-strong bg-surface-2/95 px-4 py-3 shadow-xl shadow-black/40 backdrop-blur">
        <Button icon={<Save />} loading={pending === 'save'} disabled={!dirty || pending !== null} onClick={() => void save()}>
          Speichern
        </Button>
        {dirty && !message && <span className="text-sm text-amber-200">Ungespeicherte Änderungen</span>}
        <Note message={message} />
      </div>

      <Section title="Letzte Unterhaltungen" description="Die 30 neuesten Unterhaltungen. Ein Klick zeigt den Verlauf.">
        {status.conversations.length === 0 ? (
          <p className="text-sm text-subtle">Noch keine Unterhaltungen.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {status.conversations.map((conversation) => (
              <ConversationRow key={conversation.id} conversation={conversation} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function ConversationRow({ conversation }: { conversation: AdminChatDTO['conversations'][number] }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessageDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const badge = STATUS[conversation.status];

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || messages) return;
    try {
      setMessages((await api<{ messages: ChatMessageDTO[] }>(`/admin/chat/${conversation.id}`)).messages);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <li>
      <button type="button" onClick={() => void toggle()} aria-expanded={open} className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.03]">
        <ChevronDown className={cn('size-4 shrink-0 text-subtle transition-transform', open && 'rotate-180')} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-gray-100">{conversation.firstMessage || '–'}</span>
          <span className="mt-0.5 block text-[12px] text-subtle">
            {dateTime(conversation.updatedAt)} · {conversation.messages} Nachrichten · {conversation.ai} von der KI
          </span>
        </span>
        <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px]', badge.cls)}>{badge.label}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line bg-black/20 px-3.5 py-3">
          {error && <p className="text-sm text-red-300">{error}</p>}
          {!messages && !error && <p className="text-sm text-subtle">Lädt …</p>}
          {messages?.map((m) => (
            <div key={m.id} className="text-sm leading-relaxed">
              <span className={cn('mr-2 rounded px-1.5 py-0.5 text-[11px]', m.source === 'user' ? 'bg-blue-500/15 text-blue-300' : m.source === 'ai' ? 'bg-indigo-500/15 text-indigo-300' : 'bg-white/[0.06] text-muted')}>
                {SOURCE[m.source]}
              </span>
              <span className="break-words whitespace-pre-wrap text-gray-200">{m.text}</span>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
