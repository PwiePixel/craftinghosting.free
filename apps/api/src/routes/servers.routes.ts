import { bonusSlotsFor } from '../discord/rewards';
import type { FastifyInstance } from 'fastify';
import { assertNotMaintenance } from '../lib/maintenance';
import { z } from 'zod';
import { createServerSchema, deleteServerSchema } from '@chfree/shared';
import { currentUser, requireAuth } from '../plugins/auth';
import { createServerForUser, deleteServer, listServers, reactivateServer } from '../services/server.service';
import { warningStatus } from '../services/warnings.service';
import { addServerPort, getServerDetail, removeServerPort, serverCommand, serverPower, streamWebConsole } from '../services/server-manage.service';

const idParams = z.object({ id: z.string().uuid() });

const powerBody = z.object({ action: z.enum(['start', 'stop', 'restart', 'kill']), acceptEula: z.boolean().optional() });
const commandBody = z.object({ command: z.string().trim().min(1).max(300).regex(/^[^\r\n]+$/) });
const portParams = z.object({ id: z.string().uuid(), portId: z.coerce.number().int().positive() });

/**
 * Server der Website: erstellen, reaktivieren, löschen – und verwalten (Live-Zustand, Starten/Stoppen, Konsole,
 * Ports). Dateien, Plugins und Backups bleiben im Pterodactyl-Panel. Regeln und Grenzen siehe server-manage.service.
 */
export async function serverRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/servers', async (request) => {
    const user = currentUser(request);
    // bonusSlots: zusätzliche Slots aus Belohnungen (Einladungen, Server-Boosts) – für die Anzeige der Grenzen
    return { servers: await listServers(user), bonusSlots: await bonusSlotsFor(user).catch(() => []), warnings: await warningStatus(user) };
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

  app.get('/servers/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return getServerDetail(currentUser(request), id);
  });

  app.post('/servers/:id/power', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    await assertNotMaintenance(request);
    const { id } = idParams.parse(request.params);
    const { action, acceptEula } = powerBody.parse(request.body);
    return serverPower(currentUser(request), id, action, { acceptEula }, request.ip);
  });

  app.post('/servers/:id/command', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request) => {
    await assertNotMaintenance(request);
    const { id } = idParams.parse(request.params);
    const { command } = commandBody.parse(request.body);
    await serverCommand(currentUser(request), id, command);
    return { ok: true };
  });

  app.get('/servers/:id/console', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await streamWebConsole(currentUser(request), id, request, reply);
  });

  app.post('/servers/:id/ports', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request) => {
    await assertNotMaintenance(request);
    const { id } = idParams.parse(request.params);
    return addServerPort(currentUser(request), id, request.ip);
  });

  app.post('/servers/:id/ports/:portId/delete', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request) => {
    await assertNotMaintenance(request);
    const { id, portId } = portParams.parse(request.params);
    return removeServerPort(currentUser(request), id, portId, request.ip);
  });

  app.post('/servers/:id/delete', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request) => {
    await assertNotMaintenance(request);
    const { id } = idParams.parse(request.params);
    const { confirmName } = deleteServerSchema.parse(request.body);
    await deleteServer(currentUser(request), id, confirmName, request.ip);
    return { ok: true };
  });
}
