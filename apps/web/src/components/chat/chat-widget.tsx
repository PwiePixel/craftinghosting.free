'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ExternalLink, Headset, MessageCircle, RotateCcw, SendHorizontal, X } from 'lucide-react';
import { chatLimits, localePath, type ChatAction, type ChatConversationDTO, type ChatMessageDTO, type PublicSiteDTO } from '@chfree/shared';
import { CubeMark, type CustomLogo } from '@/components/brand/logo';
import { buttonClasses } from '@/components/ui/button';
import { useDict, useLang } from '@/i18n/client';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type ChatInfo = NonNullable<PublicSiteDTO['chat']>;

/** Merkt sich je Browser-Sitzung, dass die Sprechblase schon gezeigt wurde */
const TEASER_KEY = 'chf_chat_teaser';

/** Logo aus dem Admin-Bereich – sonst die Würfel-Bildmarke */
function Avatar({ logo, className }: { logo: CustomLogo; className?: string }) {
  return (
    <span className={cn('grid shrink-0 place-items-center overflow-hidden rounded-full border border-line-strong bg-background', className)}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- kommt aus der eigenen API, Größe unbekannt
        <img src={logo.url} alt="" className="size-[68%] object-contain" />
      ) : (
        <CubeMark className="size-[62%]" />
      )}
    </span>
  );
}

/**
 * Support-Chat „Crafting AI“: Knopf unten rechts, Sprechblase, die kurz aufpoppt, und das Chat-Fenster.
 * Antworten kommen aus Vorlagen oder von der KI – beides ist an jeder Nachricht gekennzeichnet.
 */
export function ChatWidget({ chat, logo, adminPath }: { chat: ChatInfo; logo: CustomLogo; adminPath: string }) {
  const lang = useLang();
  const t = useDict().chat;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [teaser, setTeaser] = useState(false);
  const [conversation, setConversation] = useState<ChatConversationDTO | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Nach der Discord-Verbindung (…?chat=open) geht der Chat von selbst wieder auf
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('chat') !== 'open') return;
    url.searchParams.delete('chat');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    setOpen(true);
  }, []);

  // Sprechblase: poppt einmal je Sitzung kurz auf
  useEffect(() => {
    let seen = true;
    try {
      seen = sessionStorage.getItem(TEASER_KEY) === '1';
    } catch {
      /* Speicher gesperrt – dann keine Sprechblase */
    }
    if (seen) return;
    const show = setTimeout(() => {
      setTeaser(true);
      try {
        sessionStorage.setItem(TEASER_KEY, '1');
      } catch {
        /* unkritisch */
      }
    }, 2500);
    const hide = setTimeout(() => setTeaser(false), 11_000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, []);

  // Laufende Unterhaltung laden, sobald das Fenster zum ersten Mal aufgeht
  useEffect(() => {
    if (!open || loaded) return;
    let stop = false;
    api<{ conversation: ChatConversationDTO | null }>('/chat')
      .then((r) => !stop && setConversation(r.conversation))
      .catch(() => {})
      .finally(() => !stop && setLoaded(true));
    return () => {
      stop = true;
    };
  }, [open, loaded]);

  useEffect(() => {
    if (!open) return;
    setTeaser(false);
    inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Immer die neueste Nachricht zeigen
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversation, pending, busy, open, loaded]);

  const run = useCallback(
    async (path: '/chat/message' | '/chat/handoff', body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const r = await api<{ conversation: ChatConversationDTO | null }>(path, { body: { ...body, lang } });
        setConversation(r.conversation);
        return true;
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : t.error);
        return false;
      } finally {
        setBusy(false);
        setPending(null);
      }
    },
    [lang, t.error],
  );

  async function send(value: string) {
    const message = value.trim().slice(0, chatLimits.messageLength);
    if (!message || busy) return;
    setPending(message);
    setText('');
    if (!(await run('/chat/message', { text: message }))) setText(message);
    inputRef.current?.focus({ preventScroll: true });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(text);
    }
  }

  async function reset() {
    if (busy) return;
    await api('/chat/reset', { method: 'POST' }).catch(() => {});
    setConversation(null);
    setError(null);
    setText('');
  }

  // Im Admin-Bereich stört der Chat nur
  const plainPath = pathname.replace(/^\/(de|en)(?=\/|$)/, '');
  if (plainPath === adminPath || plainPath.startsWith(`${adminPath}/`)) return null;

  const messages = conversation?.messages ?? [];
  const status = conversation?.status ?? 'open';
  const canSend = (conversation?.canSend ?? true) && status === 'open';
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  // „Mit einem Mitarbeiter sprechen“ nur zeigen, solange nicht schon die letzte Nachricht diesen Knopf trägt
  const showHuman = chat.handoff && status === 'open' && !lastAssistant?.actions.some((a) => a.type === 'handoff');

  return (
    <div className="fixed right-3 bottom-[calc(0.75rem+var(--chf-cookie-h,0px))] z-50 flex flex-col items-end gap-3 sm:right-5 sm:bottom-[calc(1.25rem+var(--chf-cookie-h,0px))] print:hidden">
      {open && (
        <section
          role="dialog"
          aria-label={chat.name}
          className="flex h-[min(600px,calc(100dvh-6.5rem-var(--chf-cookie-h,0px)))] w-[min(392px,calc(100vw-1.5rem))] animate-fade-in flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-2xl shadow-black/60 [animation-duration:0.2s]"
        >
          <header className="flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-3">
            <Avatar logo={logo} className="size-10" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[15px] leading-tight font-semibold text-white">
                <span className="truncate">{chat.name}</span>
                <span className="shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-blue-300 uppercase">{chat.ai ? t.badgeAi : t.badgeAuto}</span>
              </p>
              <p className="mt-0.5 truncate text-xs text-muted">{t.subtitle}</p>
            </div>
            {messages.length > 0 && (
              <button type="button" onClick={reset} disabled={busy} title={t.reset} aria-label={t.reset} className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-40">
                <RotateCcw className="size-4" aria-hidden />
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} title={t.close} aria-label={t.close} className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-white">
              <X className="size-[18px]" aria-hidden />
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
            <Bubble source="system" label={null}>
              {chat.welcome[lang]}
            </Bubble>
            <p className="px-1 text-[11px] leading-relaxed text-subtle">
              {chat.ai ? t.noticeAi : t.noticeAuto}{' '}
              <Link href={localePath(lang, 'privacy')} className="underline underline-offset-2 hover:text-muted">
                {t.privacy}
              </Link>
            </p>

            {messages.length === 0 && !pending && chat.quick.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {chat.quick.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void send(q.question[lang])}
                    className="rounded-full border border-line-strong bg-white/[0.03] px-3 py-1.5 text-left text-[13px] text-foreground transition-colors hover:border-blue-400/50 hover:bg-blue-500/10 disabled:opacity-50"
                  >
                    {q.question[lang]}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m, i) => (
              <Message key={m.id} message={m} last={i === messages.length - 1} busy={busy} onHandoff={() => void run('/chat/handoff', {})} />
            ))}
            {pending && <Bubble source="user" label={null}>{pending}</Bubble>}
            {busy && (
              <div className="flex items-center gap-1.5 px-1 text-xs text-muted" role="status">
                <span className="flex gap-1" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="size-1.5 animate-bounce rounded-full bg-blue-400" style={{ animationDelay: `${i * 120}ms` }} />
                  ))}
                </span>
                {t.typing.replace('{name}', chat.name)}
              </div>
            )}
            {error && (
              <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-[13px] text-red-200">
                {error}
              </p>
            )}
          </div>

          <footer className="border-t border-line bg-surface-2 px-3 pt-3 pb-2.5">
            {canSend ? (
              <form onSubmit={onSubmit} className="flex items-end gap-2">
                <label htmlFor="chf-chat-input" className="sr-only">
                  {t.placeholder}
                </label>
                <textarea
                  id="chf-chat-input"
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKeyDown}
                  rows={1}
                  maxLength={chatLimits.messageLength}
                  placeholder={t.placeholder}
                  className="max-h-28 min-h-[42px] flex-1 resize-none rounded-lg border border-line-strong bg-background px-3 py-2.5 text-base text-white placeholder:text-subtle sm:text-sm focus:border-blue-400/60 focus:outline-none [field-sizing:content]"
                />
                <button type="submit" disabled={busy || !text.trim()} aria-label={t.send} title={t.send} className="grid size-[42px] shrink-0 place-items-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-500 disabled:opacity-40">
                  <SendHorizontal className="size-[18px]" aria-hidden />
                </button>
              </form>
            ) : (
              <div className="flex flex-col gap-2 px-1 pb-1 text-[13px] text-muted">
                <p>{status === 'open' ? t.limit : status === 'handed_off' ? t.handedOff : t.waitingDiscord}</p>
                <button type="button" onClick={reset} disabled={busy} className={buttonClasses('secondary', 'sm', 'self-start')}>
                  <RotateCcw aria-hidden />
                  {t.reset}
                </button>
              </div>
            )}
            {showHuman && (
              <button type="button" onClick={() => void run('/chat/handoff', {})} disabled={busy} className="mt-2 inline-flex items-center gap-1.5 px-1 text-xs text-muted transition-colors hover:text-white disabled:opacity-50">
                <Headset className="size-3.5" aria-hidden />
                {t.human}
              </button>
            )}
          </footer>
        </section>
      )}

      {!open && teaser && (
        <div className="flex max-w-[min(300px,calc(100vw-1.5rem))] animate-fade-in items-start gap-2 rounded-2xl rounded-br-sm border border-line-strong bg-surface-2 py-2.5 pr-2 pl-3.5 shadow-xl shadow-black/50">
          <button type="button" onClick={() => setOpen(true)} className="text-left text-sm leading-snug text-foreground">
            <span className="mb-0.5 block text-[11px] font-semibold tracking-[0.06em] text-blue-300 uppercase">{chat.name}</span>
            {chat.teaser[lang]}
          </button>
          <button type="button" onClick={() => setTeaser(false)} aria-label={t.dismiss} className="grid size-6 shrink-0 place-items-center rounded-md text-subtle hover:text-white">
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? t.close : t.open.replace('{name}', chat.name)}
        className="relative grid size-14 place-items-center rounded-full bg-blue-600 text-white shadow-lg shadow-black/50 transition-[transform,background-color] hover:scale-105 hover:bg-blue-500 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none"
      >
        {open ? <X className="size-6" aria-hidden /> : <MessageCircle className="size-6" aria-hidden />}
        {!open && <Avatar logo={logo} className="absolute -top-1 -left-1 size-6 border-blue-400/60" />}
      </button>
    </div>
  );
}

function Bubble({ source, label, children }: { source: ChatMessageDTO['source']; label: string | null; children: ReactNode }) {
  const mine = source === 'user';
  return (
    <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap',
          mine ? 'rounded-br-sm bg-blue-600 text-white' : 'rounded-bl-sm border border-line bg-surface-2 text-foreground',
        )}
      >
        {children}
      </div>
      {label && <span className="mt-1 px-1 text-[10px] tracking-[0.04em] text-subtle uppercase">{label}</span>}
    </div>
  );
}

/** Adressen im Text anklickbar machen (nur http/https) */
function withLinks(text: string) {
  return text.split(/(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)])/g).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-300 underline underline-offset-2 hover:text-blue-200">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

function Message({ message, last, busy, onHandoff }: { message: ChatMessageDTO; last: boolean; busy: boolean; onHandoff: () => void }) {
  const lang = useLang();
  const t = useDict().chat;
  const label = message.source === 'ai' ? t.sourceAi : message.source === 'canned' ? t.sourceCanned : null;
  return (
    <div className="space-y-2">
      <Bubble source={message.source} label={label}>
        {message.role === 'assistant' ? withLinks(message.text) : message.text}
      </Bubble>
      {/* Knöpfe gelten nur für die neueste Nachricht – ältere wären überholt */}
      {last && message.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {message.actions.map((a, i) => (
            <ActionButton key={i} action={a} busy={busy} onHandoff={onHandoff} label={a.type === 'link' ? a.label[lang] : a.type === 'handoff' ? t.human : a.type === 'connect_discord' ? t.connectDiscord : t.openTicket} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActionButton({ action, label, busy, onHandoff }: { action: ChatAction; label: string; busy: boolean; onHandoff: () => void }) {
  if (action.type === 'handoff') {
    return (
      <button type="button" onClick={onHandoff} disabled={busy} className={buttonClasses('secondary', 'sm')}>
        <Headset aria-hidden />
        {label}
      </button>
    );
  }
  // Verbindungslink: im selben Fenster – Discord schickt danach hierher zurück und der Chat geht wieder auf
  if (action.type === 'connect_discord') {
    return (
      <a href={action.url} className={buttonClasses('primary', 'sm')}>
        {label}
      </a>
    );
  }
  return (
    <a href={action.url} target="_blank" rel="noopener noreferrer" className={buttonClasses(action.type === 'open_ticket' ? 'primary' : 'secondary', 'sm')}>
      {label}
      <ExternalLink aria-hidden />
    </a>
  );
}
