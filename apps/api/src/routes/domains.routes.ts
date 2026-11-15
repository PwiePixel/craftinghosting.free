import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser, requireAdmin } from '../plugins/auth';
import { addDomain, domainsOverview, removeDomain, updateDomain } from '../services/domains.service';
import { exportCsv, EXPORTS } from '../services/export.service';
import { audit } from '../services/audit.service';
import { disconnectTunnel, restartTunnelProcess, setupTunnel, startTunnelLogin, tunnelStatus } from '../services/tunnel.service';

const host = z.string().trim().min(4).max(253);

/** Admin: Domains, Cloudflare Tunnel und CSV-Exporte */
export async function domainAdminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/domains', async () => ({ domains: await domainsOverview() }));
  app.post('/admin/domains', async (request) => {
    const body = z.object({ host, redirect: z.boolean().default(true) }).parse(request.body);
    await addDomain(currentUser(request), body.host, body.redirect, request.ip);
    return { ok: true };
  });
  app.post('/admin/domains/update', async (request) => {
    const body = z.object({ host, redirect: z.boolean() }).parse(request.body);
    await updateDomain(currentUser(request), body.host, body.redirect, request.ip);
    return { ok: true };
  });
  app.post('/admin/domains/remove', async (request) => {
    const body = z.object({ host }).parse(request.body);
    await removeDomain(currentUser(request), body.host, request.ip);
    return { ok: true };
  });

  /* ------------------------------------------------------------- Tunnel */
  app.get('/admin/tunnel', async () => ({ tunnel: await tunnelStatus() }));
  /** Liefert den Link, mit dem die Domain bei Cloudflare freigegeben wird */
  app.post('/admin/tunnel/login', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request) => {
    const { renew } = z.object({ renew: z.boolean().default(false) }).parse(request.body ?? {});
    return { tunnel: await startTunnelLogin(currentUser(request), { renew }, request.ip) };
  });
  app.post('/admin/tunnel/setup', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request) => {
    const { hosts } = z.object({ hosts: z.array(host).min(1).max(50) }).parse(request.body);
    return setupTunnel(currentUser(request), hosts, request.ip);
  });
  app.post('/admin/tunnel/restart', async () => ({ ok: restartTunnelProcess(), tunnel: await tunnelStatus() }));
  app.post('/admin/tunnel/disconnect', async (request) => ({ tunnel: await disconnectTunnel(currentUser(request), request.ip) }));

  /* ------------------------------------------------------------- Export */
  app.get('/admin/export/:type', async (request, reply) => {
    const type = z.enum(EXPORTS).parse((request.params as { type: string }).type);
    const csv = await exportCsv(type);
    await audit({ actor: 'admin', action: 'admin.export', message: `CSV-Export „${type}“ (durch ${currentUser(request).email})`, ip: request.ip });
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="chfree-${type}-${new Date().toISOString().slice(0, 10)}.csv"`)
      .header('Cache-Control', 'no-store')
      .send(csv);
  });
}
