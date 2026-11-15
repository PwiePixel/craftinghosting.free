/**
 * Einstellungen des Support-Chats „Crafting AI“ (Admin → Chat).
 * Der API-Schlüssel steht NICHT hier – er liegt getrennt und zusätzlich verschlüsselt in der Datenbank.
 */
import type { Localized } from './i18n';

/** Vorgefertigte Antwort: wird ohne KI und ohne Kosten ausgegeben, wenn eine Frage dazu passt */
export interface ChatCannedAnswer {
  id: string;
  /** Frage, wie sie als Vorschlag im Chat steht */
  question: Localized;
  answer: Localized;
  /** Stichwörter bzw. kurze Wortfolgen (beide Sprachen gemischt), an denen die Frage erkannt wird */
  keywords: string[];
  /** Als Vorschlag („Schnellfrage“) unter der Begrüßung anzeigen */
  quick: boolean;
}

export interface ChatSettings {
  /** Chat auf der Website anzeigen */
  enabled: boolean;
  /** Fragen ohne vorgefertigte Antwort an die KI geben (braucht einen API-Schlüssel) */
  aiEnabled: boolean;
  /** auto = immer das günstigste Modell (Claude Haiku) */
  model: 'auto';
  /** Obergrenze für die KI-Kosten pro Kalendermonat in US-Dollar – danach antwortet nur noch der vorgefertigte Teil */
  monthlyBudgetUsd: number;
  /** Höchstzahl an Nachrichten eines Besuchers je Unterhaltung */
  maxMessages: number;
  /** Länge einer KI-Antwort (Tokens) – kürzer = günstiger */
  maxAnswerTokens: number;
  /** Name des Assistenten im Chat */
  name: string;
  /** Sprechblase, die kurz neben dem Chat-Symbol aufpoppt */
  teaser: Localized;
  /** Erste Nachricht im geöffneten Chat */
  welcome: Localized;
  canned: ChatCannedAnswer[];
  /** Zusätzliches Wissen für die KI (ergänzt die mitgelieferte Wissensdatei) */
  extraKnowledge: string;
  /** Weitergabe an einen Mitarbeiter über ein Discord-Ticket */
  handoff: {
    enabled: boolean;
    /** Kanal, in dem der Bot ein neues Ticket aus dem Chat meldet (leer = keine Meldung) */
    notifyChannelId: string;
  };
  /** Unterhaltungen werden nach so vielen Tagen gelöscht */
  retentionDays: number;
}

export const chatLimits = { canned: 40, keywords: 12, messageLength: 1000, extraKnowledge: 12_000 } as const;

/** Das günstigste Modell – „auto“ wählt immer dieses */
export const CHAT_MODEL = 'claude-haiku-5-5';
/** Preise in US-Dollar je Million Tokens (Stand der Preisliste; Grundlage für die Kostenschätzung im Admin-Bereich) */
export const CHAT_MODEL_PRICE = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 } as const;

/** Geschätzte Kosten einer Antwort in US-Dollar */
export function chatCostUsd(usage: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  const p = CHAT_MODEL_PRICE;
  return (usage.input * p.input + usage.output * p.output + usage.cacheRead * p.cacheRead + usage.cacheWrite * p.cacheWrite) / 1_000_000;
}

const c = (id: string, question: Localized, answer: Localized, keywords: string[], quick = true): ChatCannedAnswer => ({ id, question, answer, keywords, quick });

export function defaultChatCanned(): ChatCannedAnswer[] {
  return [
    c(
      'create',
      { de: 'Wie erstelle ich einen Server?', en: 'How do I create a server?' },
      {
        de: 'Klicke oben auf „Server erstellen“, wähle Paket und Namen und gib deine E-Mail-Adresse an. Wir schicken dir einen sechsstelligen Code – nach der Eingabe legst du dein Passwort für das Panel fest, und der Server wird automatisch erstellt.',
        en: 'Click “Create server” at the top, choose a plan and a name and enter your email address. We send you a six-digit code – after entering it you set your password for the panel, and the server is created automatically.',
      },
      ['server erstellen', 'erstelle ich', 'create a server', 'create server', 'neuen server', 'new server'],
    ),
    c(
      'cost',
      { de: 'Kostet das etwas?', en: 'Does it cost anything?' },
      {
        de: 'Nein. CraftingHosting.free ist kostenlos – ohne Zahlungsdaten, ohne Testphase und ohne versteckte Kosten. Wer mehr Leistung braucht, findet bei Crafting Hosting bezahlte Pakete.',
        en: 'No. CraftingHosting.free is free – no payment details, no trial period and no hidden costs. If you need more power, Crafting Hosting offers paid plans.',
      },
      ['kostet', 'kosten', 'kostenlos', 'preis', 'bezahlen', 'cost', 'price', 'pay', 'is it free'],
    ),
    c(
      'login',
      { de: 'Wie melde ich mich an?', en: 'How do I sign in?' },
      {
        de: 'Unter „Meine Server“ gibst du deine E-Mail-Adresse ein. Wir schicken dir einen sechsstelligen Code, den du auf der Website eintippst – ein Passwort brauchst du dafür nicht. Kommt keine E-Mail an, schau bitte im Spam-Ordner nach.',
        en: 'Under “My servers” you enter your email address. We send you a six-digit code that you type in on the website – you do not need a password for that. If no email arrives, please check your spam folder.',
      },
      ['anmelden', 'einloggen', 'login', 'log in', 'sign in', 'kein code', 'keine mail', 'no email'],
    ),
    c(
      'nostart',
      { de: 'Mein Server startet nicht', en: 'My server does not start' },
      {
        de: 'Öffne deinen Server im Panel und sieh in der Konsole nach – dort steht der Grund, meist eine Fehlermeldung beim Start (z. B. ein Plugin, eine falsche Version oder ein Fehler in deinem Code). Unter „Meine Server“ siehst du außerdem, ob gerade eine Fair-Use-Pause läuft; dann lässt sich der Server erst danach wieder starten.',
        en: 'Open your server in the panel and check the console – the reason is shown there, usually an error message during start-up (for example a plugin, a wrong version or an error in your code). Under “My servers” you can also see whether a fair-use break is in progress; the server can only be started again afterwards.',
      },
      ['startet nicht', 'geht nicht an', 'server offline', 'crasht', 'does not start', "doesn't start", 'wont start', "won't start", 'not starting'],
    ),
    c(
      'panel',
      { de: 'Wo verwalte ich meinen Server?', en: 'Where do I manage my server?' },
      {
        de: 'Im Pterodactyl-Panel: starten und stoppen, Konsole, Dateien, Backups und Einstellungen. Den Link findest du unter „Meine Server“. Du meldest dich dort mit deiner E-Mail-Adresse und dem Panel-Passwort an, das du beim Erstellen festgelegt hast.',
        en: 'In the Pterodactyl panel: start and stop, console, files, backups and settings. You find the link under “My servers”. You sign in there with your email address and the panel password you set when creating the server.',
      },
      ['panel', 'verwalten', 'konsole', 'dateien', 'manage', 'console', 'files'],
    ),
    c(
      'human',
      { de: 'Ich möchte mit einem Mitarbeiter sprechen', en: 'I want to talk to a team member' },
      { de: '', en: '' },
      ['mitarbeiter', 'mensch', 'support team', 'echte person', 'human', 'team member', 'real person', 'agent'],
    ),
  ];
}

export function defaultChatSettings(): ChatSettings {
  return {
    enabled: false,
    aiEnabled: true,
    model: 'auto',
    monthlyBudgetUsd: 50,
    maxMessages: 40,
    maxAnswerTokens: 500,
    name: 'Crafting AI',
    teaser: { de: 'Fragen? Ich helfe dir gern weiter 👋', en: 'Questions? I am happy to help 👋' },
    welcome: {
      de: 'Hi, ich bin Crafting AI, der KI-Assistent von CraftingHosting.free. Frag mich alles rund um deinen Server, deinen Discord-Bot oder dein Konto.',
      en: 'Hi, I am Crafting AI, the AI assistant of CraftingHosting.free. Ask me anything about your server, your Discord bot or your account.',
    },
    canned: defaultChatCanned(),
    extraKnowledge: '',
    handoff: { enabled: true, notifyChannelId: '' },
    retentionDays: 30,
  };
}

/* ------------------------------------------------------------------ Prüfung */

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
const text = (v: unknown, def: string, max: number) => (typeof v === 'string' ? v.slice(0, max) : def);
const num = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const localized = (v: unknown, def: Localized, max: number): Localized => {
  const o = obj(v);
  const de = text(o.de, '', max).trim() || def.de;
  const en = text(o.en, '', max).trim() || def.en;
  return { de: de || en, en: en || de };
};

export function normalizeChatSettings(input: unknown): ChatSettings {
  const i = obj(input);
  const d = defaultChatSettings();
  const h = obj(i.handoff);
  const used = new Set<string>();
  const canned: ChatCannedAnswer[] = (Array.isArray(i.canned) ? i.canned : d.canned)
    .slice(0, chatLimits.canned)
    .map((raw, index): ChatCannedAnswer | null => {
      const a = obj(raw);
      const question = localized(a.question, { de: '', en: '' }, 160);
      if (!question.de) return null;
      let id = /^[a-z0-9][a-z0-9-]{0,23}$/.test(String(a.id ?? '')) ? String(a.id) : `antwort-${index + 1}`;
      for (let n = 2; used.has(id); n++) id = `${id.replace(/-\d+$/, '').slice(0, 20)}-${n}`;
      used.add(id);
      const keywords = [
        ...new Set(
          (Array.isArray(a.keywords) ? a.keywords : [])
            .map((k) => (typeof k === 'string' ? k.trim().toLowerCase().slice(0, 60) : ''))
            .filter((k) => k.length >= 2),
        ),
      ].slice(0, chatLimits.keywords);
      return { id, question, answer: localized(a.answer, { de: '', en: '' }, 1500), keywords, quick: bool(a.quick, true) };
    })
    .filter((a): a is ChatCannedAnswer => a !== null);
  const channel = typeof h.notifyChannelId === 'string' && /^\d{15,22}$/.test(h.notifyChannelId.trim()) ? h.notifyChannelId.trim() : '';
  return {
    enabled: bool(i.enabled, d.enabled),
    aiEnabled: bool(i.aiEnabled, d.aiEnabled),
    model: 'auto',
    monthlyBudgetUsd: Math.round(num(i.monthlyBudgetUsd, d.monthlyBudgetUsd, 0, 10_000) * 100) / 100,
    maxMessages: Math.round(num(i.maxMessages, d.maxMessages, 5, 200)),
    maxAnswerTokens: Math.round(num(i.maxAnswerTokens, d.maxAnswerTokens, 150, 2000)),
    name: text(i.name, d.name, 40).trim() || d.name,
    teaser: localized(i.teaser, d.teaser, 120),
    welcome: localized(i.welcome, d.welcome, 500),
    canned,
    extraKnowledge: text(i.extraKnowledge, '', chatLimits.extraKnowledge),
    handoff: { enabled: bool(h.enabled, d.handoff.enabled), notifyChannelId: channel },
    retentionDays: Math.round(num(i.retentionDays, d.retentionDays, 1, 365)),
  };
}

/** Vereinheitlicht einen Text für den Vergleich mit Stichwörtern (klein, ohne Satzzeichen) */
export function chatNormalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sucht die passende vorgefertigte Antwort. Trifft zu, wenn die Nachricht genau einer Frage entspricht
 * (Klick auf einen Vorschlag) oder – bei kurzen Nachrichten – eines der Stichwörter enthält.
 * Lange, ausführliche Nachrichten gehen an die KI: Dort wäre ein einzelnes Stichwort zu grob.
 */
export function matchCanned(message: string, canned: ChatCannedAnswer[], opts: { maxWords?: number } = {}): ChatCannedAnswer | null {
  const text = chatNormalize(message);
  if (!text) return null;
  const exact = canned.find((a) => chatNormalize(a.question.de) === text || chatNormalize(a.question.en) === text);
  if (exact) return exact;
  if (text.split(' ').length > (opts.maxWords ?? 12)) return null;
  const padded = ` ${text} `;
  let best: { answer: ChatCannedAnswer; length: number } | null = null;
  for (const a of canned) {
    for (const k of a.keywords) {
      // Ganze Wörter bzw. Wortfolgen – „start“ soll nicht in „startseite“ treffen
      if (padded.includes(` ${chatNormalize(k)} `) && (!best || k.length > best.length)) best = { answer: a, length: k.length };
    }
  }
  return best?.answer ?? null;
}
