import { defineConfig } from 'drizzle-kit';

/**
 * Nur für `drizzle-kit generate` (Migrationen aus dem Schema erzeugen) – dafür ist keine Datenbank nötig.
 * Angewendet werden Migrationen mit `npm run db:migrate` (öffnet die verschlüsselte Datei über libSQL).
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
