import type { FastifyInstance, FastifyReply } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { chatLimits, isLocale, type AdminChatDTO, type ChatConversationDTO, type ChatMessageDTO, type ChatAction, type Locale } from '@chfree/shared';
import { ChatAiError, checkApiKey } from '../chat/ai';
import { chatAdminOverview, createConversation, findConversation, findConversationById, handleChatMessage, startHandoff, toConversationDTO } from '../chat/service';
import { getChatApiKey, saveChatApiKey, setChatError } from '../chat/store';
import { db } from '../db/client';
import { chatMessages } from '../db/schema';
import { cookieSecure, env } from '../env';
import { ApiError, Errors, L } from '../lib/errors';
import { currentUser, requireAdmin } from '../plugins/auth';
import { audit } from '../services/audit.service';
import { getSettings, invalidatePublicSite } from '../services/settings.service';

/** Cookie der Unterhaltung: technisch nötig, damit der Chat beim Seitenwechsel und nach der Discord-Verbindung weitergeht */
export const CHAT_COOKIE = 'chf_chat';
const strict = (max: number, timeWindow: string) => ({ config: { rateLimit: { max, timeWindow } } });

function setChatCookie(reply: FastifyReply, token: string) {
  // Ohne Ablaufdatum: Der Browser löscht das Cookie beim Schließen
  reply.setCookie(CHAT_COOKIE, token, { path: '/', httpOnly: true, secure: cookieSecure, sameSite: 'lax', domain: env.COOKIE_DOMAIN || undefined });
}

const disabled = () => Errors.notFound();

/** Support-Chat der Website (auch ohne Anmeldung nutzbar) */
export async function chatRoutes(app: FastifyInstance) {
  /** Laufende Unterhaltung dieses Browsers (null = noch keine) */
  app.get('/chat', async (request): Promise<{ conversation: ChatConversationDTO | null }> => {
    const settings = await getSettings();
    if (!settings.chat.enabled) return { conversation: null };
    return { conversation: await toConversationDTO(await findConversation(request.cookies[CHAT_COOKIE]), settings) };
  });

  /** Nachricht senden. Legt bei Bedarf eine Unterhaltung an. */
  app.post('/chat/message', strict(20, '5 minutes'), async (request, reply): Promise<{ conversation: ChatConversationDTO | null }> => {
    const settings = await getSettings();
    if (!settings.chat.enabled) throw disabled();
    const body = z.object({ text: z.string().trim().min(1).max(chatLimits.messageLength), lang: z.string().optional() }).parse(request.body);
    const lang: Locale = isLocale(body.lang) ? body.lang : request.lang;
    const user = request.user && request.user.status === 'active' ? request.user : null;
    let conversation = await findConversation(request.cookies[CHAT_COOKIE]);
    if (!conversation) {
      const created = await createConversation(lang, user, request.ip);
      conversation = created.conversation;
      setChatCookie(reply, created.token);
    }
    await handleChatMessage(conversation, body.text, user);
    return { conversation: await toConversationDTO(await findConversationById(conversation.id), settings) };
  });

  /** „Mit einem Mitarbeiter sprechen“ */
  app.post('/chat/handoff', strict(10, '5 minutes'), async (request, reply): Promise<{ conversation: ChatConversationDTO | null }> => {
    const settings = await getSettings();
    if (!settings.chat.enabled) throw disabled();
    const body = z.object({ lang: z.string().optional() }).parse(request.body ?? {});
    const user = request.user && request.user.status === 'active' ? request.user : null;
    let conversation = await findConversation(request.cookies[CHAT_COOKIE]);
    if (!conversation) {
      const created = await createConversation(isLocale(body.lang) ? body.lang : request.lang, user, request.ip);
      conversation = created.conversation;
      setChatCookie(reply, created.token);
    }
    await startHandoff(conversation, user);
    return { conversation: await toConversationDTO(await findConversationById(conversation.id), settings) };
  });

  /** Neue Unterhaltung beginnen (die alte bleibt bis zum Ablauf der Aufbewahrungsfrist gespeichert) */
  app.post('/chat/reset', strict(10, '5 minutes'), async (_request, reply) => {
    reply.clearCookie(CHAT_COOKIE, { path: '/', domain: env.COOKIE_DOMAIN || undefined });
    return { ok: true };
  });
}

/** Admin: API-Schlüssel, Verbrauch, Unterhaltungen */
export async function chatAdminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/chat', async (): Promise<{ chat: AdminChatDTO }> => ({ chat: await chatAdminOverview() }));

  /** API-Schlüssel speichern bzw. löschen – er wird nie zurückgegeben */
  app.post('/admin/chat/secrets', strict(20, '10 minutes'), async (request) => {
    const body = z.object({ apiKey: z.string().trim().max(300).optional(), clear: z.boolean().default(false) }).parse(request.body);
    if (body.clear) await saveChatApiKey(null);
    else if (body.apiKey) await saveChatApiKey(body.apiKey);
    await setChatError(null).catch(() => {});
    invalidatePublicSite();
    await audit({ userId: currentUser(request).id, actor: 'admin', action: 'chat.secrets', message: body.clear ? 'Support-Chat: API-Schlüssel gelöscht' : 'Support-Chat: API-Schlüssel geändert', ip: request.ip });
    return { chat: await chatAdminOverview() };
  });

  /** Schlüssel prüfen – kostet kein Guthaben */
  app.post('/admin/chat/test', strict(20, '10 minutes'), async () => {
    const apiKey = await getChatApiKey();
    if (!apiKey) throw new ApiError(400, 'no_api_key', L('Es ist noch kein API-Schlüssel hinterlegt.', 'No API key has been stored yet.'));
    try {
      const model = await checkApiKey(apiKey);
      await setChatError(null).catch(() => {});
      return { ok: true, model };
    } catch (err) {
      const message = err instanceof ChatAiError ? err.adminMessage : 'Die Prüfung ist fehlgeschlagen.';
      throw new ApiError(502, 'chat_ai_error', L(message, message));
    }
  });

  /** Verlauf einer Unterhaltung */
  app.get('/admin/chat/:id', async (request): Promise<{ messages: ChatMessageDTO[] }> => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const rows = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, id)).orderBy(asc(chatMessages.id)).limit(300);
    return { messages: rows.map((m) => ({ id: m.id, role: m.role, source: m.source, text: m.text, at: m.createdAt.toISOString(), actions: (m.actions ?? []) as ChatAction[] })) };
  });
}
