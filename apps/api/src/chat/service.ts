/**
 * Support-Chat der Website („Crafting AI“):
 *  1. vorgefertigte Antworten (kostenlos, sofort)
 *  2. sonst die KI – eingeschränkt auf Support-Fragen zu CraftingHosting.free, mit Kostenbremse
 *  3. Übergabe an das Team: Discord-Konto verbinden → Mitgliedschaft prüfen → Ticket auf Discord eröffnen
 * Der Besucher hält nur ein Cookie; die Unterhaltung liegt in der Datenbank und wird nach einigen Tagen gelöscht.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { and, asc, count, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { CHAT_MODEL, chatLimits, matchCanned, type AdminChatDTO, type ChatAction, type ChatConversationDTO, type ChatMessageDTO, type Locale, type Localized, type SiteSettings } from '@chfree/shared';
import { db } from '../db/client';
import { chatConversations, chatMessages, discordTickets, servers, users, type User } from '../db/schema';
import { discordErrorText } from '../discord/rest';
import { botRequest, discordConfig, fetchDiscordMember, inviteUrlOf } from '../discord/service';
import { getDiscordMaintenance, getDiscordState } from '../discord/store';
import { openTicket } from '../discord/tickets';
import { encryptField, generateToken, sha256, uuid } from '../lib/crypto';
import { audit } from '../services/audit.service';
import { getSettings, resolveBrand } from '../services/settings.service';
import { ChatAiError, askClaude } from './ai';
import { buildSystemPrompt } from './knowledge';
import { addChatUsage, getChatApiKey, getChatUsage, setChatError } from './store';

type Conversation = typeof chatConversations.$inferSelect;
type Source = ChatMessageDTO['source'];

const t = (lang: Locale, text: Localized) => text[lang];
/** Verlauf, der an die KI geht – ältere Nachrichten bringen selten etwas und kosten Tokens */
const HISTORY = 12;

/* ------------------------------------------------------------ Unterhaltungen */

export async function findConversation(token: string | undefined): Promise<Conversation | null> {
  if (!token) return null;
  const [row] = await db.select().from(chatConversations).where(eq(chatConversations.tokenHash, sha256(token))).limit(1);
  return row ?? null;
}

export async function findConversationById(id: string): Promise<Conversation | null> {
  const [row] = await db.select().from(chatConversations).where(eq(chatConversations.id, id)).limit(1);
  return row ?? null;
}

/** Neue Unterhaltung. Der zurückgegebene Token gehört ins Cookie – gespeichert wird nur sein Hash. */
export async function createConversation(lang: Locale, user: User | null, ip?: string): Promise<{ conversation: Conversation; token: string }> {
  const token = generateToken();
  const id = uuid();
  await db.insert(chatConversations).values({ id, tokenHash: sha256(token), lang, userId: user?.id ?? null, ip: encryptField(ip?.slice(0, 64)) });
  return { conversation: (await findConversationById(id))!, token };
}

async function addMessage(c: Conversation, role: 'user' | 'assistant', source: Source, text: string, actions: ChatAction[] = [], tokens = { in: 0, out: 0 }): Promise<void> {
  await db.insert(chatMessages).values({ conversationId: c.id, role, source, text: text.slice(0, 4000), actions, tokensIn: tokens.in, tokensOut: tokens.out });
  await db.update(chatConversations).set({ updatedAt: new Date() }).where(eq(chatConversations.id, c.id));
}

const say = (c: Conversation, source: Source, text: Localized, actions: ChatAction[] = []) => addMessage(c, 'assistant', source, t(c.lang, text), actions);

export async function toConversationDTO(c: Conversation | null, settings?: SiteSettings): Promise<ChatConversationDTO | null> {
  if (!c) return null;
  const s = settings ?? (await getSettings());
  const rows = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, c.id)).orderBy(asc(chatMessages.id)).limit(300);
  return {
    status: c.status,
    canSend: rows.filter((m) => m.role === 'user').length < s.chat.maxMessages,
    messages: rows.map((m) => ({ id: m.id, role: m.role, source: m.source, text: m.text, at: m.createdAt.toISOString(), actions: (m.actions ?? []) as ChatAction[] })),
  };
}

/* ------------------------------------------------------------ Nachricht verarbeiten */

/** Texte, die ohne KI auskommen */
const TEXT = {
  limit: {
    de: 'Wir haben in dieser Unterhaltung schon viel geschrieben. Wenn deine Frage noch offen ist, übergebe ich dich gern an einen Mitarbeiter.',
    en: 'We have already written a lot in this conversation. If your question is still open, I am happy to hand you over to a team member.',
  },
  noAnswer: {
    de: 'Dazu habe ich leider keine passende Antwort. Ich kann dich an einen Mitarbeiter weitergeben.',
    en: 'I am afraid I do not have a suitable answer to that. I can hand you over to a team member.',
  },
  aiDown: {
    de: 'Ich kann diese Frage gerade nicht beantworten. Ich kann dich aber an einen Mitarbeiter weitergeben.',
    en: 'I cannot answer this question right now. I can hand you over to a team member, though.',
  },
  handedOff: {
    de: 'Dein Anliegen liegt bereits beim Team – bitte schreib im Ticket auf Discord weiter. Dort meldet sich ein Mitarbeiter.',
    en: 'Your request is already with the team – please continue in the ticket on Discord. A team member will reply there.',
  },
} satisfies Record<string, Localized>;

const HANDOFF_ACTION: ChatAction[] = [{ type: 'handoff' }];

/** Verarbeitet eine Nachricht des Besuchers und schreibt die Antwort(en) in die Unterhaltung. */
export async function handleChatMessage(c: Conversation, text: string, user: User | null): Promise<void> {
  const settings = await getSettings();
  const chat = settings.chat;
  const handoffOn = chat.handoff.enabled;
  const [sent] = await db.select({ n: count() }).from(chatMessages).where(and(eq(chatMessages.conversationId, c.id), eq(chatMessages.role, 'user')));
  if (Number(sent?.n ?? 0) >= chat.maxMessages) return say(c, 'system', TEXT.limit, handoffOn ? HANDOFF_ACTION : []);

  await addMessage(c, 'user', 'user', text.slice(0, chatLimits.messageLength));
  // Angemeldet? Dann gehört die Unterhaltung zu diesem Account (für die Übergabe)
  if (user && !c.userId) {
    await db.update(chatConversations).set({ userId: user.id }).where(eq(chatConversations.id, c.id));
    c = { ...c, userId: user.id };
  }
  if (c.status === 'handed_off') return say(c, 'system', TEXT.handedOff, await ticketAction(c));

  // 1) Vorgefertigte Antwort
  const canned = matchCanned(text, chat.canned);
  if (canned) {
    const answer = t(c.lang, canned.answer).trim();
    // Ohne Antworttext (z. B. „Mit einem Mitarbeiter sprechen“) heißt: an das Team übergeben
    if (!answer) return handoffOn ? startHandoff(c, user) : say(c, 'system', await contactText(settings));
    return addMessage(c, 'assistant', 'canned', answer);
  }

  // 2) KI – nur mit Schlüssel und solange das Monatsbudget reicht
  const apiKey = chat.aiEnabled ? await getChatApiKey() : null;
  const usage = apiKey ? await getChatUsage() : null;
  if (!apiKey || !usage || (chat.monthlyBudgetUsd > 0 && usage.costUsd >= chat.monthlyBudgetUsd)) {
    return say(c, 'system', TEXT.noAnswer, handoffOn ? HANDOFF_ACTION : []);
  }
  try {
    const answer = await askClaude({ apiKey, system: await buildSystemPrompt(settings), messages: await historyFor(c), maxAnswerTokens: chat.maxAnswerTokens });
    await addChatUsage(answer.usage);
    if (answer.text) await addMessage(c, 'assistant', 'ai', answer.text, [], { in: answer.usage.input + answer.usage.cacheRead + answer.usage.cacheWrite, out: answer.usage.output });
    if (answer.handoff) {
      if (handoffOn) return startHandoff(c, user);
      if (!answer.text) return say(c, 'system', TEXT.noAnswer);
    }
  } catch (err) {
    const message = err instanceof ChatAiError ? err.adminMessage : 'Unerwarteter Fehler bei der KI-Anfrage.';
    console.warn(`[chat] ${message}`);
    await setChatError(message).catch(() => {});
    return say(c, 'system', TEXT.aiDown, handoffOn ? HANDOFF_ACTION : []);
  }
}

/** Die letzten Nachrichten im Format der Claude-API (beginnt immer mit einer Nachricht des Besuchers) */
async function historyFor(c: Conversation): Promise<Anthropic.MessageParam[]> {
  const rows = (await db.select().from(chatMessages).where(eq(chatMessages.conversationId, c.id)).orderBy(desc(chatMessages.id)).limit(HISTORY)).reverse();
  const first = rows.findIndex((m) => m.role === 'user');
  return rows.slice(Math.max(0, first)).map((m): Anthropic.MessageParam => ({ role: m.role, content: m.text }));
}

/* ------------------------------------------------------------ Übergabe an das Team */

/** Kontaktwege, wenn keine Übergabe per Ticket möglich ist */
async function contactText(settings: SiteSettings): Promise<Localized> {
  const brand = resolveBrand(settings);
  const invite = inviteUrlOf((await getDiscordState().catch(() => null))?.inviteCode ?? null) ?? brand.discordUrl;
  return {
    de: `Unser Team erreichst du auf Discord (${invite}) oder per E-Mail an ${brand.supportEmail}.`,
    en: `You can reach our team on Discord (${invite}) or by email at ${brand.supportEmail}.`,
  };
}

async function ticketAction(c: Conversation): Promise<ChatAction[]> {
  if (!c.ticketId) return [];
  const [ticket] = await db.select().from(discordTickets).where(eq(discordTickets.id, c.ticketId)).limit(1);
  const { settings } = await discordConfig();
  return ticket?.channelId ? [{ type: 'open_ticket', url: `https://discord.com/channels/${settings.guildId}/${ticket.channelId}` }] : [];
}

/**
 * Übergabe: Dafür muss der Besucher auf unserem Discord-Server sein. Ist kein Discord-Konto bekannt, bekommt er
 * zuerst den Verbindungslink (nicht den Einladungslink) – nach der Zustimmung tritt er automatisch bei und
 * die Übergabe läuft von selbst weiter.
 */
export async function startHandoff(c: Conversation, user: User | null): Promise<void> {
  const settings = await getSettings();
  const cfg = await discordConfig();
  if (c.status === 'handed_off') return say(c, 'system', TEXT.handedOff, await ticketAction(c));
  if (!settings.chat.handoff.enabled || !cfg.botReady) return say(c, 'system', await contactText(settings));
  if (await getDiscordMaintenance()) {
    return say(c, 'system', {
      de: 'Auf unserem Discord-Server laufen gerade Wartungsarbeiten, deshalb kann ich im Moment kein Ticket eröffnen. Bitte versuche es etwas später noch einmal.',
      en: 'Our Discord server is under maintenance right now, so I cannot open a ticket at the moment. Please try again a little later.',
    });
  }

  // Welches Discord-Konto? Aus dem Chat verbunden – oder das des angemeldeten Accounts
  const account = user ?? (c.userId ? ((await db.select().from(users).where(eq(users.id, c.userId)).limit(1))[0] ?? null) : null);
  const identity = c.discordId ? { id: c.discordId, username: c.discordUsername ?? 'user' } : account?.discordId ? { id: account.discordId, username: account.discordUsername ?? 'user' } : null;
  const connect: ChatAction[] = cfg.linkReady ? [{ type: 'connect_discord', url: `/api/v1/discord/connect?chat=1&lang=${c.lang}` }] : [];

  if (!identity) {
    if (!cfg.linkReady) return say(c, 'system', await contactText(settings));
    await db.update(chatConversations).set({ status: 'handoff_pending' }).where(eq(chatConversations.id, c.id));
    return say(
      c,
      'system',
      {
        de: 'Ich gebe dich an einen Mitarbeiter weiter. Dafür brauche ich dein Discord-Konto: Verbinde es über den Button – du trittst dabei automatisch unserem Discord-Server bei. Danach eröffne ich sofort ein Ticket für dich.',
        en: 'I will hand you over to a team member. For that I need your Discord account: connect it using the button – you join our Discord server automatically in the process. Then I will open a ticket for you right away.',
      },
      connect,
    );
  }

  let member: boolean;
  try {
    member = (await fetchDiscordMember(identity.id)) !== null;
  } catch {
    return say(c, 'system', {
      de: 'Ich kann Discord gerade nicht erreichen und deshalb kein Ticket eröffnen. Bitte versuche es gleich noch einmal.',
      en: 'I cannot reach Discord right now and therefore cannot open a ticket. Please try again in a moment.',
    }, HANDOFF_ACTION);
  }
  if (!member) {
    await db.update(chatConversations).set({ status: 'handoff_pending' }).where(eq(chatConversations.id, c.id));
    return say(
      c,
      'system',
      {
        de: 'Du bist noch nicht auf unserem Discord-Server. Verbinde dein Discord-Konto über den Button – dabei trittst du automatisch bei, und ich eröffne danach dein Ticket.',
        en: 'You are not on our Discord server yet. Connect your Discord account using the button – you join automatically, and I will open your ticket afterwards.',
      },
      connect,
    );
  }

  // Mitglied bestätigt → Ticket eröffnen
  try {
    const rows = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, c.id)).orderBy(asc(chatMessages.id)).limit(60);
    const questions = rows.filter((m) => m.role === 'user');
    const subject = (questions[0]?.text ?? 'Anfrage aus dem Website-Chat').replace(/\s+/g, ' ').slice(0, 90);
    const owned = account ? await db.select().from(servers).where(and(eq(servers.userId, account.id), inArray(servers.status, ['provisioning', 'provisioning_failed', 'active', 'expiring', 'suspended']))).limit(5) : [];
    // Verlauf für das Team: die letzten Nachrichten, gekürzt auf die Länge eines Embeds
    const transcript = rows
      .filter((m) => m.source !== 'system')
      .slice(-16)
      .map((m) => `**${m.role === 'user' ? 'Nutzer' : m.source === 'ai' ? `${settings.chat.name} (KI)` : `${settings.chat.name} (Vorlage)`}:** ${m.text.replace(/\s+/g, ' ').slice(0, 500)}`)
      .join('\n');
    const ticket = await openTicket({
      settings: cfg.settings,
      discordUser: identity,
      user: account,
      // Genau ein Server → gleich als betroffenes Produkt eintragen; bei mehreren stehen sie im Text
      server: owned.length === 1 ? owned[0]! : null,
      subject,
      text: `${(questions[questions.length - 1]?.text ?? subject).slice(0, 1500)}${owned.length > 1 ? `\n\nServer dieses Accounts: ${owned.map((s) => `${s.name} (\`${s.id}\`)`).join(', ')}` : ''}`,
      german: c.lang === 'de',
      note: `🤖 **Übergabe von ${settings.chat.name}:** Ich habe es im Website-Chat versucht, konnte dem Nutzer aber nicht weiterhelfen. Bitte helft hier weiter.`,
      extraEmbeds: transcript ? [{ title: 'Verlauf aus dem Website-Chat', description: transcript.slice(-3900), color: 0x6b7280 }] : [],
    });
    await db.update(chatConversations).set({ status: 'handed_off', ticketId: ticket.id, discordId: identity.id, discordUsername: identity.username }).where(eq(chatConversations.id, c.id));
    // Meldung im Team-Kanal
    const notify = settings.chat.handoff.notifyChannelId;
    if (notify) {
      await botRequest('POST', `/channels/${notify}/messages`, {
        json: {
          embeds: [
            {
              title: '🎫 Neues Support-Ticket aus dem Website-Chat',
              description: `${settings.chat.name} konnte nicht weiterhelfen und hat an das Team übergeben. Bitte lest das Ticket durch und übernehmt.`,
              color: 0x2563eb,
              fields: [
                { name: 'Ticket', value: `<#${ticket.channelId}> (#${ticket.number})`, inline: true },
                { name: 'Nutzer', value: `<@${identity.id}>`, inline: true },
                { name: 'Anliegen', value: subject || '–' },
              ],
              timestamp: new Date().toISOString(),
            },
          ],
          allowed_mentions: { parse: [] },
        },
      }).catch((err) => console.warn(`[chat] Meldung im Team-Kanal fehlgeschlagen: ${discordErrorText(err)}`));
    }
    await audit({ userId: account?.id ?? null, actor: 'user', action: 'chat.handoff', message: `Support-Chat an das Team übergeben (Ticket #${ticket.number})` });
    return say(
      c,
      'system',
      {
        de: '✅ Ich habe geprüft, dass du auf unserem Discord-Server bist, und ein Ticket für dich eröffnet. Ein Mitarbeiter meldet sich dort – den bisherigen Verlauf habe ich mitgegeben.',
        en: '✅ I have verified that you are on our Discord server and opened a ticket for you. A team member will reply there – I have passed on our conversation so far.',
      },
      [{ type: 'open_ticket', url: ticket.url }],
    );
  } catch (err) {
    console.warn(`[chat] Ticket konnte nicht eröffnet werden: ${discordErrorText(err)}`);
    return say(c, 'system', await contactText(settings));
  }
}

/** Hinweis im Chat, wenn die Verbindung mit Discord nicht geklappt hat */
export async function chatNote(c: Conversation, reason: string): Promise<void> {
  const cfg = await discordConfig();
  const connect: ChatAction[] = cfg.linkReady ? [{ type: 'connect_discord', url: `/api/v1/discord/connect?chat=1&lang=${c.lang}` }] : [];
  const texts: Record<string, Localized> = {
    denied: { de: 'Du hast die Anfrage bei Discord abgebrochen. Ohne die Verbindung kann ich kein Ticket für dich eröffnen – du kannst es jederzeit noch einmal versuchen.', en: 'You cancelled the request at Discord. Without the connection I cannot open a ticket for you – you can try again at any time.' },
    taken: { de: 'Dieses Discord-Konto ist bereits mit einem anderen Account verknüpft. Bitte verbinde das Discord-Konto, das zu deinem Account gehört.', en: 'This Discord account is already linked to another account. Please connect the Discord account that belongs to your account.' },
    too_new: { de: 'Dein Discord-Konto ist noch zu neu. Zum Schutz vor Missbrauch muss es schon etwas länger bestehen.', en: 'Your Discord account is too new. To prevent abuse it has to exist for a while.' },
    bot_account: { de: 'Bot-Konten können nicht verbunden werden. Bitte verbinde dein persönliches Discord-Konto.', en: 'Bot accounts cannot be connected. Please connect your personal Discord account.' },
  };
  return say(c, 'system', texts[reason] ?? { de: 'Die Verbindung mit Discord hat nicht geklappt. Bitte versuche es noch einmal.', en: 'Connecting with Discord did not work. Please try again.' }, connect);
}

/** Nach der Verbindung über Discord (ohne Website-Account): Konto an der Unterhaltung merken */
export async function attachDiscordToConversation(c: Conversation, discordUser: { id: string; username: string }): Promise<Conversation> {
  // Gehört das Discord-Konto zu einem Website-Account, kennt das Ticket auch dessen Server
  const [linked] = await db.select({ id: users.id }).from(users).where(eq(users.discordId, discordUser.id)).limit(1);
  await db
    .update(chatConversations)
    .set({ discordId: discordUser.id, discordUsername: discordUser.username.slice(0, 64), ...(linked && !c.userId ? { userId: linked.id } : {}) })
    .where(eq(chatConversations.id, c.id));
  return (await findConversationById(c.id))!;
}

/* ------------------------------------------------------------ Admin und Pflege */

export async function chatAdminOverview(): Promise<AdminChatDTO> {
  const [settings, apiKey, usage] = await Promise.all([getSettings(), getChatApiKey(), getChatUsage()]);
  const rows = await db.select().from(chatConversations).orderBy(desc(chatConversations.updatedAt)).limit(30);
  const stats = rows.length
    ? await db
        .select({ id: chatMessages.conversationId, n: count(), ai: sql<number>`sum(case when ${chatMessages.source} = 'ai' then 1 else 0 end)`, first: sql<string>`min(case when ${chatMessages.role} = 'user' then ${chatMessages.id} end)` })
        .from(chatMessages)
        .where(inArray(chatMessages.conversationId, rows.map((r) => r.id)))
        .groupBy(chatMessages.conversationId)
    : [];
  const firstIds = stats.map((s) => Number(s.first)).filter((n) => Number.isFinite(n) && n > 0);
  const firsts = firstIds.length ? await db.select({ id: chatMessages.id, text: chatMessages.text }).from(chatMessages).where(inArray(chatMessages.id, firstIds)) : [];
  return {
    hasApiKey: !!apiKey,
    model: CHAT_MODEL,
    usage: { month: usage.month, requests: usage.requests, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd },
    budgetReached: settings.chat.monthlyBudgetUsd > 0 && usage.costUsd >= settings.chat.monthlyBudgetUsd,
    lastError: usage.lastError,
    conversations: rows
      .map((r) => {
        const s = stats.find((x) => x.id === r.id);
        return {
          id: r.id,
          startedAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          messages: Number(s?.n ?? 0),
          ai: Number(s?.ai ?? 0),
          status: r.status,
          firstMessage: (firsts.find((f) => f.id === Number(s?.first))?.text ?? '').slice(0, 140),
        };
      })
      .filter((r) => r.messages > 0),
  };
}

/** Unterhaltungen nach Ablauf der Aufbewahrungsfrist löschen (die Nachrichten hängen daran) */
export async function pruneChats(): Promise<number> {
  const days = (await getSettings()).chat.retentionDays;
  const old = await db.select({ id: chatConversations.id }).from(chatConversations).where(lt(chatConversations.updatedAt, new Date(Date.now() - days * 86_400_000))).limit(500);
  if (old.length === 0) return 0;
  const ids = old.map((o) => o.id);
  await db.delete(chatMessages).where(inArray(chatMessages.conversationId, ids));
  await db.delete(chatConversations).where(inArray(chatConversations.id, ids));
  return ids.length;
}
