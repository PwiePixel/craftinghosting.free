/**
 * Datenbank: verschlüsselte SQLite-Datei (libSQL). API und Worker sind zwei Prozesse,
 * die dieselbe Datei öffnen – WAL-Modus + busy_timeout sorgen dafür, dass sie sich nicht blockieren.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { env } from '../env';
import * as schema from './schema';

/** Wartezeit auf eine Schreibsperre des jeweils anderen Prozesses */
const BUSY_TIMEOUT_MS = 5000;
/** Feste, kleine Zahl an Verbindungen – jede bekommt beim Start ihre PRAGMAs */
const CONNECTIONS = 4;

mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });

const client = createClient({
  url: `file:${env.DATABASE_PATH}`,
  encryptionKey: env.DATABASE_ENCRYPTION_KEY,
  // = busy_timeout jeder Verbindung
  timeout: BUSY_TIMEOUT_MS,
  concurrency: CONNECTIONS,
});

async function configure(): Promise<void> {
  // journal_mode wird in der Datei gespeichert; lässt sich WAL nicht aktivieren, bleibt der Standard-Journal-Modus (+ busy_timeout)
  try {
    await client.execute('PRAGMA journal_mode=WAL');
  } catch (err) {
    console.warn('[db] WAL-Modus nicht verfügbar – Standard-Journal-Modus wird verwendet', err);
  }
  // Verbindungsbezogene PRAGMAs: parallele Aufrufe öffnen alle Verbindungen des Pools, jede wird einmal konfiguriert
  await Promise.all(
    Array.from({ length: CONNECTIONS }, async () => {
      await client.executeMultiple(`PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;`);
    }),
  );
}
await configure();

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

let txQueue: Promise<unknown> = Promise.resolve();

/**
 * Schreib-Transaktion (BEGIN IMMEDIATE): Schreiber werden serialisiert – ersetzt die Zeilensperren (SELECT … FOR UPDATE)
 * aus MySQL. Innerhalb des Prozesses laufen Transaktionen nacheinander; der andere Prozess wartet per busy_timeout.
 * Im Callback nur `tx` verwenden und nicht auf Netzwerk/Timer warten.
 */
export function writeTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const run = txQueue.then(() => db.transaction(fn, { behavior: 'immediate' }));
  txQueue = run.catch(() => {});
  return run;
}

/** Anzahl betroffener Zeilen aus einem INSERT/UPDATE/DELETE-Ergebnis. */
export function affectedRows(result: unknown): number {
  return (result as { rowsAffected?: number } | null | undefined)?.rowsAffected ?? 0;
}

/** Verstoß gegen einen Unique-Index / Primärschlüssel (Drizzle verpackt den libSQL-Fehler in `cause`) */
export function isUniqueViolation(err: unknown): boolean {
  for (let e = err as { code?: string; message?: string; cause?: unknown } | undefined, i = 0; e && i < 5; e = e.cause as typeof e, i++) {
    if (typeof e.code === 'string' && (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY')) return true;
    if (typeof e.message === 'string' && e.message.includes('UNIQUE constraint failed')) return true;
  }
  return false;
}

export async function pingDb(): Promise<number> {
  const started = performance.now();
  await client.execute('SELECT 1');
  return Math.round(performance.now() - started);
}

export async function closeDb(): Promise<void> {
  client.close();
}
