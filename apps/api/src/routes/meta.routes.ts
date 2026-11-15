import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { allPlans, freeHostingConfig } from '@chfree/shared';
import { db, pingDb } from '../db/client';
import { consentLogs } from '../db/schema';
import { encryptField, uuid } from '../lib/crypto';
import { pterodactyl } from '../pterodactyl';
import { getAvailability } from '../services/server.service';
import { getLogo } from '../services/logo.service';
import { allowedHosts, getPublicSite, getSettings } from '../services/settings.service';
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
      // Pakete kommen aus dem Admin-Bereich (nur aktive)
      plans: allPlans(await getSettings())
        .filter((p) => p.enabled)
        .map(({ enabled: _enabled, reserved: _reserved, ...p }) => p),
      serverTypes: freeHostingConfig.serverTypes,
      fairUse: freeHostingConfig.fairUse,
      cycle: freeHostingConfig.cycle,
      limits: freeHostingConfig.limits,
      availability,
    };
  });

  /** Öffentliche Einstellungen (Wartung, Registrierungsmodus, Warteliste, Kennzahlen) */
  app.get('/site', async () => ({ site: await getPublicSite() }));

  /**
   * Cookie-Hinweis bestätigt: Zeitpunkt, IP-Adresse und Browser-Kennung werden als Nachweis gespeichert –
   * IP und Browser-Kennung ausschließlich verschlüsselt.
   */
  app.post('/consent', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request) => {
    const { choice } = z.object({ choice: z.enum(['essential', 'all']).default('essential') }).parse(request.body ?? {});
    await db.insert(consentLogs).values({
      id: uuid(),
      userId: request.user?.id ?? null,
      choice,
      ip: encryptField(request.ip?.slice(0, 64)),
      userAgent: encryptField(String(request.headers['user-agent'] ?? '').slice(0, 255) || null),
    });
    return { ok: true };
  });

  /**
   * Für Caddy („On-Demand TLS“): Darf für diese Domain ein Zertifikat geholt werden?
   * 200 = Domain ist die Hauptdomain oder im Admin-Bereich eingetragen · 404 = nein.
   */
  app.get('/internal/tls-check', async (request, reply) => {
    const domain = String((request.query as { domain?: string }).domain ?? '').toLowerCase();
    return allowedHosts(await getSettings()).has(domain) ? { ok: true } : reply.status(404).send({ ok: false });
  });

  /** Logo aus dem Admin-Bereich. Die Adresse trägt eine Versionsangabe (?v=…) – darum darf lange zwischengespeichert werden. */
  app.get('/brand/logo', async (request, reply) => {
    const logo = await getLogo();
    if (!logo) return reply.status(404).send({ error: { code: 'not_found', message: 'Kein Logo hinterlegt.' } });
    return reply
      .header('Content-Type', logo.mime)
      .header('Cache-Control', (request.query as { v?: string }).v ? 'public, max-age=31536000, immutable' : 'public, max-age=300')
      // Falls jemand die Datei direkt öffnet: nichts darin darf ausgeführt werden (SVG)
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .send(logo.bytes);
  });

  app.get('/status', async () => {
    return { status: await getStatus() };
  });
}
