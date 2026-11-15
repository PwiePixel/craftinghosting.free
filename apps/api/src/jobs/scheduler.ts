import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { jobRuns } from '../db/schema';
import { acquireLease, releaseLease } from './lock';
import type { JobDefinition, JobLogger } from './types';
import { allJobs } from './registry';

const OWNER = `${hostname()}-${process.pid}-${randomBytes(3).toString('hex')}`;

/** Führt einen Job genau einmal aus (sofern die Lease frei ist) und protokolliert den Lauf. */
export async function runJobOnce(job: JobDefinition, log: JobLogger): Promise<'ran' | 'locked' | 'failed'> {
  if (!(await acquireLease(job.name, OWNER, job.leaseMs))) return 'locked';
  const startedAt = new Date();
  let runId: number | undefined;
  try {
    const [res] = await db.insert(jobRuns).values({ job: job.name, status: 'running', startedAt }).returning({ id: jobRuns.id });
    runId = res?.id;
    const stats = await job.run({ now: new Date(), log });
    if (runId) await db.update(jobRuns).set({ status: 'success', finishedAt: new Date(), stats }).where(eq(jobRuns.id, runId));
    const changed = Object.entries(stats).filter(([, v]) => v > 0);
    if (changed.length) log.info({ job: job.name, stats }, `Job ${job.name} abgeschlossen`);
    return 'ran';
  } catch (err) {
    log.error({ err, job: job.name }, `Job ${job.name} fehlgeschlagen`);
    if (runId) {
      await db
        .update(jobRuns)
        .set({ status: 'failed', finishedAt: new Date(), error: String((err as Error)?.stack ?? err).slice(0, 5000) })
        .where(eq(jobRuns.id, runId))
        .catch(() => {});
    }
    return 'failed';
  } finally {
    await releaseLease(job.name, OWNER).catch(() => {});
  }
}

export function startScheduler(log: JobLogger, jobs: JobDefinition[] = allJobs) {
  let stopping = false;
  const timers = new Map<string, NodeJS.Timeout>();
  const running = new Set<Promise<unknown>>();

  const schedule = (job: JobDefinition, delay: number) => {
    const timer = setTimeout(async () => {
      if (stopping) return;
      const p = runJobOnce(job, log);
      running.add(p);
      await p.catch(() => {});
      running.delete(p);
      if (!stopping) schedule(job, job.intervalMs);
    }, delay);
    timers.set(job.name, timer);
  };

  // Versetzter Start, damit nicht alle Jobs gleichzeitig loslaufen
  jobs.forEach((job, i) => schedule(job, 2_000 + i * 1_500));

  return {
    async stop() {
      stopping = true;
      for (const t of timers.values()) clearTimeout(t);
      await Promise.race([Promise.allSettled([...running]), new Promise((r) => setTimeout(r, 15_000))]);
    },
  };
}
