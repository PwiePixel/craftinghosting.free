/**
 * Zugang zum Admin-Bereich des Panels für automatische Umzüge (Tabelle `settings`, Schlüssel panel-web-login).
 * Passwort und Zwei-Faktor-Schlüssel sind zusätzlich feldverschlüsselt und gehen nie an den Browser.
 */
import { eq } from 'drizzle-orm';
import type { AdminPanelLoginDTO } from '@chfree/shared';
import { db } from '../db/client';
import { settings as settingsTable } from '../db/schema';
import { decryptField, encryptField } from '../lib/crypto';
import type { PanelWebLogin } from '../pterodactyl/web-transfer';

const KEY = 'panel-web-login';
interface Stored {
  username?: string;
  password?: string | null;
  totpSecret?: string | null;
  /** Ergebnis der letzten Prüfung bzw. des letzten Umzugs */
  lastCheck?: { at: string; ok: boolean; message: string } | null;
}

async function read(): Promise<Stored> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, KEY)).limit(1);
  return (row?.value as Stored | undefined) ?? {};
}
async function write(value: Stored): Promise<void> {
  await db.insert(settingsTable).values({ key: KEY, value }).onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

/** null = kein Zugang hinterlegt */
export async function getPanelWebLogin(): Promise<PanelWebLogin | null> {
  const s = await read().catch(() => ({}) as Stored);
  const password = decryptField(s.password) || null;
  if (!s.username || !password) return null;
  return { username: s.username, password, totpSecret: decryptField(s.totpSecret) || null };
}

export async function panelWebLoginStatus(): Promise<AdminPanelLoginDTO> {
  const s = await read();
  return { configured: !!s.username && !!s.password, username: s.username ?? '', hasTotp: !!s.totpSecret, lastCheck: s.lastCheck ?? null };
}

/** Leeres Passwort bzw. leerer Schlüssel = unverändert lassen; clearTotp entfernt den Schlüssel */
export async function savePanelWebLogin(input: { username: string; password?: string; totpSecret?: string; clearTotp?: boolean }): Promise<void> {
  const s = await read();
  await write({
    username: input.username.trim(),
    password: input.password ? encryptField(input.password) : (s.password ?? null),
    totpSecret: input.clearTotp ? null : input.totpSecret?.trim() ? encryptField(input.totpSecret.trim()) : (s.totpSecret ?? null),
    lastCheck: null,
  });
}

export async function clearPanelWebLogin(): Promise<void> {
  await write({});
}

export async function notePanelWebCheck(ok: boolean, message: string): Promise<void> {
  const s = await read();
  await write({ ...s, lastCheck: { at: new Date().toISOString(), ok, message: message.slice(0, 300) } });
}
