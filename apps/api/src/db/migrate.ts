/**
 * Wendet alle ausstehenden Migrationen aus ./drizzle an.
 * Idempotent – kann bei jedem Deployment ausgeführt werden.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { db, pool } from './client';

function findMigrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '../../drizzle'), resolve(here, '../drizzle'), resolve(process.cwd(), 'drizzle')];
  const found = candidates.find((c) => existsSync(resolve(c, 'meta/_journal.json')));
  if (!found) throw new Error(`Migrationsordner nicht gefunden (gesucht: ${candidates.join(', ')})`);
  return found;
}

async function main() {
  const migrationsFolder = findMigrationsFolder();
  console.log(`[migrate] Wende Migrationen aus ${migrationsFolder} an …`);
  await migrate(db, { migrationsFolder });
  console.log('[migrate] Fertig.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('[migrate] Fehlgeschlagen:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
