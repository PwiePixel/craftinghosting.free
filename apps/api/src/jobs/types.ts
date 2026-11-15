import type { FastifyBaseLogger } from 'fastify';

export type JobLogger = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error' | 'debug'>;

export interface JobContext {
  now: Date;
  log: JobLogger;
}

export type JobStats = Record<string, number>;

export interface JobDefinition {
  name: string;
  /** Abstand zwischen zwei Läufen */
  intervalMs: number;
  /** Maximale Laufzeit – danach verfällt die Lease automatisch */
  leaseMs: number;
  run(ctx: JobContext): Promise<JobStats>;
}

/** Führt `fn` für alle Elemente mit begrenzter Parallelität aus. Fehler einzelner Elemente werden gesammelt. */
export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<{ failed: number }> {
  let index = 0;
  let failed = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++]!;
      try {
        await fn(item);
      } catch {
        failed++;
      }
    }
  });
  await Promise.all(workers);
  return { failed };
}
