/**
 * Lease-basierte Job-Sperren in der Datenbank.
 * Funktionieren über mehrere Prozesse/Hosts hinweg und lösen sich nach
 * Ablauf der Lease automatisch (z. B. wenn ein Worker abstürzt).
 */
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { affectedRows, db } from '../db/client';
import { jobLocks } from '../db/schema';

export async function acquireLease(name: string, owner: string, ttlMs: number): Promise<boolean> {
  const now = new Date();
  await db.insert(jobLocks).values({ name, owner: null, lockedUntil: null, updatedAt: now }).onConflictDoNothing();
  const res = await db
    .update(jobLocks)
    .set({ owner, lockedUntil: new Date(now.getTime() + ttlMs), updatedAt: now })
    .where(and(eq(jobLocks.name, name), or(isNull(jobLocks.lockedUntil), lt(jobLocks.lockedUntil, now), eq(jobLocks.owner, owner))));
  return affectedRows(res) === 1;
}

export async function releaseLease(name: string, owner: string): Promise<void> {
  await db
    .update(jobLocks)
    .set({ lockedUntil: null, updatedAt: new Date() })
    .where(and(eq(jobLocks.name, name), eq(jobLocks.owner, owner)));
}
