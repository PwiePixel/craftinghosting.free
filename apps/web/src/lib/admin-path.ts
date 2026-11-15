/**
 * Geheimer Pfad des Admin-Bereichs (ADMIN_PATH, z. B. /team-7f3k9). Nirgends verlinkt,
 * nicht in robots.txt/Sitemap, per X-Robots-Tag und Meta-Tag von der Indexierung ausgeschlossen.
 * Nur serverseitig verwenden – der Wert landet nie im Browser-Bundle.
 */
export function adminPath(): string {
  const p = (process.env.ADMIN_PATH ?? '/admin').trim().replace(/^\/+|\/+$/g, '');
  return p ? `/${p}` : '/admin';
}
