import type { FastifyInstance } from 'fastify';
import { assertNotMaintenance } from '../lib/maintenance';
import { z } from 'zod';
import { createServerSchema, deleteServerSchema } from '@chfree/shared';
import { currentUser, requireAuth } from '../plugins/auth';
import { createServerForUser, deleteServer, listServers, reactivateServer } from '../services/server.service';

const idParams = z.object({ id: z.string().uuid() });

/**
 * Bewusst schlank: Starten, Stoppen, Konsole, Dateien usw. passieren im
 * Pterodactyl-Panel. Die Website kann nur erstellen, reaktivieren und löschen.
 */
export async function serverRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/servers', async (request) => {
    return { servers: await listServers(currentUser(request)) };
  });

  app.post('/servers', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request, reply) => {
    await assertNotMaintenance(request);
    const input = createServerSchema.parse(request.body);
    const server = await createServerForUser(currentUser(request), input, request.ip);
    return reply.status(201).send({ server });
  });

  app.post('/servers/:id/reactivate', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request) => {
    await assertNotMaintenance(request);
    const { id } = idParams.parse(request.params);
    return { server: await reactivateServer(currentUser(request), id, request.ip) };
  });

  app.post('/servers/:id/delete', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request) => {
    await assertNotMaintenance(request);
    const { id } = idParams.parse(request.params);
    const { confirmName } = deleteServerSchema.parse(request.body);
    await deleteServer(currentUser(request), id, confirmName, request.ip);
    return { ok: true };
  });
}
