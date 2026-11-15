// Kopiert statische Dateien in den Standalone-Build, damit
// `node .next/standalone/apps/web/server.js` direkt lauffähig ist (z. B. mit systemd).
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const target = resolve(root, '.next/standalone/apps/web');
if (!existsSync(target)) {
  console.log('[standalone] Kein Standalone-Build gefunden – übersprungen.');
  process.exit(0);
}
cpSync(resolve(root, '.next/static'), resolve(target, '.next/static'), { recursive: true });
if (existsSync(resolve(root, 'public'))) cpSync(resolve(root, 'public'), resolve(target, 'public'), { recursive: true });
console.log('[standalone] Statische Dateien kopiert.');
