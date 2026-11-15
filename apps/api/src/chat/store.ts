/**
 * Ablage des Support-Chats in der Tabelle `settings`:
 *  – chat-secrets: API-Schlüssel für Claude, zusätzlich feldverschlüsselt (nie im Klartext, nie an den Browser)
 *  – chat-usage:   Verbrauch der KI im laufenden Kalendermonat (Grundlage für die Kostenbremse)
 */
import { eq } from 'drizzle-orm';
import { chatCostUsd } from '@chfree/shared';
import { db, writeTx } from '../db/client';
import { settings as settingsTable } from '../db/schema';
import { decryptField, encryptField } from '../lib/crypto';

const SECRETS = 'chat-secrets';
const USAGE = 'chat-usage';

async function readRow<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key)).limit(1);
  return (row?.value as T | undefined) ?? null;
}

let keyCache: { at: number; value: string | null } | null = null;

export async function getChatApiKey(): Promise<string | null> {
  if (keyCache && Date.now() - keyCache.at < 5_000) return keyCache.value;
  const row = await readRow<{ apiKey?: string | null }>(SECRETS).catch(() => null);
  const value = decryptField(row?.apiKey) || null;
  keyCache = { at: Date.now(), value };
  return value;
}

/** Leerer Text/null = löschen */
export async function saveChatApiKey(apiKey: string | null): Promise<void> {
  const value = { apiKey: encryptField(apiKey?.trim() || null) };
  await db.insert(settingsTable).values({ key: SECRETS, value }).onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
  keyCache = null;
}

export interface ChatUsage {
  /** Kalendermonat, z. B. 2026-11 */
  month: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  lastError: { at: string; message: string } | null;
}

const currentMonth = () => new Date().toISOString().slice(0, 7);
const emptyUsage = (): ChatUsage => ({ month: currentMonth(), requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, lastError: null });

export async function getChatUsage(): Promise<ChatUsage> {
  const row = await readRow<ChatUsage>(USAGE).catch(() => null);
  // Neuer Monat → der Zähler beginnt bei null (der letzte Fehler bleibt sichtbar)
  if (!row || row.month !== currentMonth()) return { ...emptyUsage(), lastError: row?.lastError ?? null };
  return { ...emptyUsage(), ...row };
}

async function patchUsage(change: (u: ChatUsage) => ChatUsage): Promise<void> {
  await writeTx(async (tx) => {
    const [row] = await tx.select().from(settingsTable).where(eq(settingsTable.key, USAGE)).limit(1);
    const stored = row?.value as ChatUsage | undefined;
    const base = stored && stored.month === currentMonth() ? { ...emptyUsage(), ...stored } : { ...emptyUsage(), lastError: stored?.lastError ?? null };
    const value = change(base);
    await tx.insert(settingsTable).values({ key: USAGE, value }).onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
  });
}

/** Verbrauch einer KI-Antwort verbuchen */
export async function addChatUsage(tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }): Promise<void> {
  await patchUsage((u) => ({
    ...u,
    requests: u.requests + 1,
    inputTokens: u.inputTokens + tokens.input + tokens.cacheRead + tokens.cacheWrite,
    outputTokens: u.outputTokens + tokens.output,
    costUsd: Math.round((u.costUsd + chatCostUsd(tokens)) * 1_000_000) / 1_000_000,
    lastError: null,
  }));
}

export async function setChatError(message: string | null): Promise<void> {
  await patchUsage((u) => ({ ...u, lastError: message ? { at: new Date().toISOString(), message: message.slice(0, 300) } : null }));
}
