import { writeFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

/**
 * Produktions-Build: alle Abhängigkeiten (außer libSQL, siehe unten) werden in dist/ gebündelt.
 * Zur Laufzeit werden nur die libSQL-Pakete aus node_modules benötigt.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    worker: 'src/worker.ts',
    migrate: 'src/db/migrate.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  // Alles bündeln – außer libSQL: das native Modul (libsql, @libsql/<plattform>) lässt sich nicht bündeln
  // und muss zur Laufzeit in node_modules liegen (npm ci --omit=dev).
  noExternal: [/^(?!libsql$|libsql\/|@libsql\/)/],
  // pino-pretty: nur in der Entwicklung genutzt (Transport)
  external: ['pino-pretty', 'libsql', /^libsql\//, /^@libsql\//],
  async onSuccess() {
    // dist/ ist eigenständig lauffähig – ESM-Markierung für Node
    writeFileSync('dist/package.json', JSON.stringify({ type: 'module' }) + '\n');
  },
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
