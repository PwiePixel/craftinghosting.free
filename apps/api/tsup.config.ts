import { writeFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

/**
 * Produktions-Build: alle Abhängigkeiten werden in dist/ gebündelt.
 * Das Docker-Image braucht dadurch keine node_modules.
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
  noExternal: [/.*/],
  // Nur in der Entwicklung genutzt (pino-pretty-Transport)
  external: ['pino-pretty'],
  async onSuccess() {
    // dist/ ist eigenständig lauffähig – ESM-Markierung für Node
    writeFileSync('dist/package.json', JSON.stringify({ type: 'module' }) + '\n');
  },
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
