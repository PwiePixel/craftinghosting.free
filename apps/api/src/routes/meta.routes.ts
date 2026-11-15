import type { FastifyInstance } from 'fastify';
import { freeHostingConfig } from '@chfree/shared';
import { pingDb } from '../db/client';
import { pterodactyl } from '../pterodactyl';
import { getAvailability } from '../services/server.service';
import { getPublicSite } from '../services/settings.service';
import { getStatus } from '../services/status.service';

export async function metaRoutes(app: FastifyInstance) {
  /** Liveness/Readiness für Docker & Reverse Proxy */
  app.get('/health', async (_request, reply) => {
    try {
      const dbMs = await pingDb();
      return { ok: true, db: dbMs, pterodactylMode: pterodactyl().mode };
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });

  /** Öffentliche Produktdaten + Verfügbarkeit für den Erstell-Assistenten */
  app.get('/meta', async () => {
    const availability = await getAvailability();
    return {
      plans: freeHostingConfig.plans,
      serverTypes: freeHostingConfig.serverTypes,
      fairUse: freeHostingConfig.fairUse,
      cycle: freeHostingConfig.cycle,
      limits: freeHostingConfig.limits,
      availability,
    };
  });

  /** Öffentliche Einstellungen (Wartung, Registrierungsmodus, Warteliste, Kennzahlen) */
  app.get('/site', async () => ({ site: await getPublicSite() }));

  app.get('/status', async () => {
    return { status: await getStatus() };
  });
}
