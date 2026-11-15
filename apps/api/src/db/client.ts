import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { env } from '../env';
import * as schema from './schema';

export const pool = mysql.createPool({
  uri: env.DATABASE_URL,
  connectionLimit: env.DATABASE_POOL_SIZE,
  // Alle Zeitstempel in UTC
  timezone: 'Z',
  dateStrings: false,
  enableKeepAlive: true,
});

export const db = drizzle(pool, { schema, mode: 'default' });
export type Db = typeof db;

/** Anzahl betroffener Zeilen aus einem UPDATE/DELETE-Ergebnis. */
export function affectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  return (header as { affectedRows?: number })?.affectedRows ?? 0;
}

export async function pingDb(): Promise<number> {
  const started = performance.now();
  await pool.query('SELECT 1');
  return Math.round(performance.now() - started);
}
