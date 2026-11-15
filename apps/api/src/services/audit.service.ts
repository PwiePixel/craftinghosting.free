import { db } from '../db/client';
import { auditLogs } from '../db/schema';

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
      ip: input.ip ?? null,
    });
  } catch (err) {
    console.error('[audit] Schreiben fehlgeschlagen', err);
  }
}
