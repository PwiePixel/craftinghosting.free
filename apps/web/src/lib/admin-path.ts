/**
 * Pfad des Admin-Bereichs: /admin – optional zusätzlich ein eigener Pfad über ADMIN_PATH.
 * Der Bereich ist nirgends verlinkt, nicht in robots.txt/Sitemap und von der Indexierung ausgeschlossen.
 * Erreichbar ist er NUR für angemeldete Admins (Rolle im Backend); alle anderen sehen eine 404-Seite (siehe proxy.ts).
 */
export function adminPath(): string {
  const p = (process.env.ADMIN_PATH ?? '/admin').trim().replace(/^\/+|\/+$/g, '');
  return p ? `/${p}` : '/admin';
}
