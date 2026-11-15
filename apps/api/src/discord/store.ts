/**
 * Ablage der Discord-Anbindung in der Tabelle `settings`:
 *  – discord-secrets:     Bot-Token und Client-Secret, zusätzlich feldverschlüsselt (nie im Klartext, nie an den Browser)
 *  – discord-state:       Laufzeitdaten, die der Bot selbst pflegt (Einladungslink, Ticket-Kategorie, Verbindungsstatus)
 *  – discord-maintenance: Sicherung der Kanal-Berechtigungen, solange /wartung aktiv ist
 */
import { eq } from 'drizzle-orm';
import { db, writeTx } from '../db/client';
import { settings as settingsTable } from '../db/schema';
import { decryptField, encryptField } from '../lib/crypto';
import type { DiscordOverwrite } from './rest';

const SECRETS = 'discord-secrets';
const STATE = 'discord-state';
const MAINTENANCE = 'discord-maintenance';

async function readRow<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key)).limit(1);
  return (row?.value as T | undefined) ?? null;
}

async function writeRow(key: string, value: unknown): Promise<void> {
  await db.insert(settingsTable).values({ key, value }).onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

/* ------------------------------------------------------------ Geheimnisse */

export interface DiscordSecrets {
  botToken: string | null;
  clientSecret: string | null;
}

let secretsCache: { at: number; value: DiscordSecrets } | null = null;

export async function getDiscordSecrets(): Promise<DiscordSecrets> {
  if (secretsCache && Date.now() - secretsCache.at < 5_000) return secretsCache.value;
  const row = await readRow<{ botToken?: string | null; clientSecret?: string | null }>(SECRETS).catch(() => null);
  const value = { botToken: decryptField(row?.botToken) || null, clientSecret: decryptField(row?.clientSecret) || null };
  secretsCache = { at: Date.now(), value };
  return value;
}

/** undefined = unverändert lassen · leerer Text/null = löschen */
export async function saveDiscordSecrets(patch: { botToken?: string | null; clientSecret?: string | null }): Promise<void> {
  const current = await getDiscordSecrets();
  const next = {
    botToken: patch.botToken === undefined ? current.botToken : patch.botToken?.trim() || null,
    clientSecret: patch.clientSecret === undefined ? current.clientSecret : patch.clientSecret?.trim() || null,
  };
  await writeRow(SECRETS, { botToken: encryptField(next.botToken), clientSecret: encryptField(next.clientSecret) });
  secretsCache = null;
}

/* ------------------------------------------------------------ Laufzeitdaten */

export interface DiscordState {
  /** Vom Bot erstellte Einladung (Code) und der Kanal dazu */
  inviteCode: string | null;
  inviteChannelId: string | null;
  inviteCheckedAt: string | null;
  /** Vom Bot angelegte Kategorie für Tickets (falls im Admin keine eingetragen ist) */
  ticketCategoryId: string | null;
  bot: { id: string; username: string; avatar: string | null } | null;
  guild: { name: string; icon: string | null; memberCount: number | null } | null;
  /** Zeitpunkt, zu dem die Befehle zuletzt registriert wurden */
  commandsAt: string | null;
  setupAt: string | null;
  /** Letzter Fehler beim Vergeben der Customer-Rolle (null = zuletzt hat es geklappt) */
  roleError: { at: string; message: string } | null;
  /** Dauerverbindung des Bots (für Willkommensnachricht, Auto-Rollen, Befehle, Buttons) */
  gateway: { status: 'off' | 'connecting' | 'online' | 'error'; at: string; error: string | null };
}

const defaultState = (): DiscordState => ({
  inviteCode: null,
  inviteChannelId: null,
  inviteCheckedAt: null,
  ticketCategoryId: null,
  bot: null,
  guild: null,
  commandsAt: null,
  setupAt: null,
  roleError: null,
  gateway: { status: 'off', at: new Date(0).toISOString(), error: null },
});

let stateCache: { at: number; value: DiscordState } | null = null;

export async function getDiscordState(fresh = false): Promise<DiscordState> {
  if (!fresh && stateCache && Date.now() - stateCache.at < 3_000) return stateCache.value;
  const row = await readRow<Partial<DiscordState>>(STATE).catch(() => null);
  const value = { ...defaultState(), ...(row ?? {}) };
  stateCache = { at: Date.now(), value };
  return value;
}

/** Ändert einzelne Felder. API und Worker schreiben beide – deshalb Lesen und Schreiben in einer Transaktion. */
export async function patchDiscordState(patch: Partial<DiscordState>): Promise<DiscordState> {
  const value = await writeTx(async (tx) => {
    const [row] = await tx.select().from(settingsTable).where(eq(settingsTable.key, STATE)).limit(1);
    const next = { ...defaultState(), ...((row?.value as Partial<DiscordState> | undefined) ?? {}), ...patch };
    await tx.insert(settingsTable).values({ key: STATE, value: next }).onConflictDoUpdate({ target: settingsTable.key, set: { value: next, updatedAt: new Date() } });
    return next;
  });
  stateCache = { at: Date.now(), value };
  return value;
}

/* ------------------------------------------------------------ Wartung */

export interface DiscordMaintenance {
  active: boolean;
  startedAt: string;
  /** Discord-ID der Person, die /wartung an ausgeführt hat */
  by: string;
  reason: string;
  /** Rolle „Wartung“ und der Hinweis-Kanal, die der Bot angelegt hat */
  roleId: string | null;
  infoChannelId: string | null;
  /** Berechtigungen aller Kanäle vor der Wartung: Kanal-ID → Überschreibungen */
  snapshot: Record<string, DiscordOverwrite[]>;
}

export async function getDiscordMaintenance(): Promise<DiscordMaintenance | null> {
  const row = await readRow<DiscordMaintenance>(MAINTENANCE).catch(() => null);
  return row?.active ? row : null;
}

export async function saveDiscordMaintenance(value: DiscordMaintenance | null): Promise<void> {
  if (value) await writeRow(MAINTENANCE, value);
  else await db.delete(settingsTable).where(eq(settingsTable.key, MAINTENANCE));
}
