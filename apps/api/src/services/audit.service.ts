import { db } from '../db/client';
import { auditLogs } from '../db/schema';
import { encryptField } from '../lib/crypto';

export interface AuditInput {
  userId?: string | null;
  serverId?: string | null;
  actor: 'user' | 'system' | 'admin';
  action: string;
  message: string;
  meta?: Record<string, unknown>;
  ip?: string | null;
}

/** Schreibt einen Audit-Log-Eintrag. Fehler werden geloggt, aber nie weitergeworfen. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId: input.userId ?? null,
      serverId: input.serverId ?? null,
      actor: input.actor,
      action: input.action,
      message: input.message.slice(0, 500),
      meta: input.meta ?? null,
      // IP-Adressen werden nur verschlüsselt gespeichert
      ip: encryptField(input.ip?.slice(0, 64)),
    });
  } catch (err) {
    console.error('[audit] Schreiben fehlgeschlagen', err);
  }
}
