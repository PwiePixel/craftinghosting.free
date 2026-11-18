/**
 * Partner-API (für Partner wie einen Minecraft-Launcher) und ihre Verwaltung im Admin-Bereich.
 *
 * Zugang: `Authorization: Bearer <API-Key>` (oder `X-API-Key`). Der Key gehört auf den Server des Partners –
 * nicht in ein Programm, das an Endnutzer ausgeliefert wird.
 * Dokumentation: docs/partner-api.md
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { partnerPlayers, type Partner } from '../db/schema';
import { sha256 } from '../lib/crypto';
import { ApiError, Errors, L } from '../lib/errors';
import { currentUser, requireAdmin } from '../plugins/auth';
import {
  commandPartnerServer,
  createPartner,
  createPartnerServer,
  deletePartner,
  deletePartnerServer,
  getPartnerServer,
  heartbeatMany,
  heartbeatPartnerServer,
  listPartnerServers,
  listPartners,
  partnerByKey,
  partnerInfo,
  rotatePartnerKey,
  startPartnerServer,
  stopPartnerServer,
  updatePartner,
  upsertPlayer,
} from '../services/partner.service';
import { getSettings } from '../services/settings.service';

declare module 'fastify' {
  interface FastifyRequest {
    partner: Partner | null;
  }
}

const keyOf = (request: FastifyRequest): string | undefined => {
  const auth = request.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const header = request.headers['x-api-key'];
  return typeof header === 'string' ? header.trim() : undefined;
};

/** Anfragen werden je API-Key begrenzt (nicht je IP): Der Partner bündelt die Anfragen vieler Nutzer */
const limit = (max: number) => ({
  config: {
    rateLimit: {
      max,
      timeWindow: '1 minute',
      keyGenerator: (request: FastifyRequest) => {
        const key = keyOf(request);
        return key?.startsWith('chp_') ? `partner:${sha256(key).slice(0, 24)}` : `partner-ip:${request.ip}`;
      },
    },
  },
});

const idParam = z.object({ id: z.string().uuid() });
const playerSchema = z.object({ externalId: z.string().trim().min(1).max(80), name: z.string().trim().max(60).nullish() });

export async function partnerRoutes(app: FastifyInstance) {
  app.decorateRequest('partner', null);

  // Viele Clients schicken POST-Anfragen ohne Inhalt, aber mit JSON-Kopfzeile (z. B. Lebenszeichen, Stopp) – das ist hier erlaubt
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new ApiError(400, 'invalid_json', L('Der Inhalt der Anfrage ist kein gültiges JSON.', 'The request body is not valid JSON.')), undefined);
    }
  });

  /** Jede Anfrage braucht einen gültigen API-Key eines aktiven Partners */
  app.addHook('preHandler', async (request) => {
    const partner = await partnerByKey(keyOf(request));
    if (!partner) throw new ApiError(401, 'invalid_api_key', L('Der API-Key fehlt, ist ungültig oder der Partner ist deaktiviert.', 'The API key is missing, invalid or the partner is disabled.'));
    request.partner = partner;
  });
  const partnerOf = (request: FastifyRequest) => request.partner!;
  const idOf = (request: FastifyRequest) => idParam.parse(request.params).id;
  /** Während einer Wartung lassen sich keine Server erstellen oder starten */
  const assertOpen = async () => {
    if ((await getSettings()).maintenance.enabled) throw new ApiError(503, 'maintenance', L('Gerade laufen Wartungsarbeiten. Bitte später erneut versuchen.', 'Maintenance is in progress. Please try again later.'));
  };

  /** Angebot, Grenzen und Auslastung */
  app.get('/partner/me', limit(600), async (request) => partnerInfo(partnerOf(request)));

  /** Spieler anlegen bzw. abrufen – gibt unsere Spieler-ID zurück */
  app.post('/partner/players', limit(1200), async (request) => {
    const input = playerSchema.parse(request.body);
    const player = await upsertPlayer(partnerOf(request), input.externalId, input.name);
    return { player: { id: player.id, externalId: player.externalId, name: player.name, createdAt: player.createdAt.toISOString() } };
  });

  /** Spieler samt seiner Server – über die Kennung des Partners oder unsere Spieler-ID */
  app.get('/partner/players/:player', limit(1200), async (request) => {
    const key = z.string().trim().min(1).max(80).parse((request.params as { player: string }).player);
    const partner = partnerOf(request);
    const [byExternal] = await db.select().from(partnerPlayers).where(and(eq(partnerPlayers.partnerId, partner.id), eq(partnerPlayers.externalId, key))).limit(1);
    const [byId] = byExternal ? [byExternal] : await db.select().from(partnerPlayers).where(and(eq(partnerPlayers.partnerId, partner.id), eq(partnerPlayers.id, key))).limit(1);
    if (!byId) throw Errors.notFound(L('Spieler nicht gefunden.', 'Player not found.'));
    return {
      player: { id: byId.id, externalId: byId.externalId, name: byId.name, blocked: byId.blocked, createdAt: byId.createdAt.toISOString() },
      servers: await listPartnerServers(partner, { playerId: byId.id }),
    };
  });

  /** Server auflisten (optional nur die eines Spielers) */
  app.get('/partner/servers', limit(1200), async (request) => {
    const q = z.object({ player: z.string().max(80).optional(), playerId: z.string().max(20).optional(), limit: z.coerce.number().int().min(1).max(100).optional(), offset: z.coerce.number().int().min(0).optional() }).parse(request.query);
    return { servers: await listPartnerServers(partnerOf(request), { playerExternalId: q.player, playerId: q.playerId, limit: q.limit, offset: q.offset }) };
  });

  /** Server für einen Spieler erstellen */
  app.post('/partner/servers', limit(300), async (request, reply) => {
    await assertOpen();
    const input = z.object({ player: playerSchema, name: z.string().max(60), serverType: z.string().max(40), version: z.string().max(40).default('latest') }).parse(request.body);
    const server = await createPartnerServer(partnerOf(request), input, request.ip);
    reply.code(201);
    return { server };
  });

  app.get('/partner/servers/:id', limit(6000), async (request) => ({ server: await getPartnerServer(partnerOf(request), idOf(request)) }));

  /** Starten bzw. nach der Pause reaktivieren. Beim ersten Start: { "acceptEula": true } */
  app.post('/partner/servers/:id/start', limit(1200), async (request) => {
    await assertOpen();
    const body = z.object({ acceptEula: z.boolean().optional() }).parse(request.body ?? {});
    return { server: await startPartnerServer(partnerOf(request), idOf(request), body, request.ip) };
  });

  /** Lebenszeichen: Der Launcher des Hosts ist noch offen */
  app.post('/partner/servers/:id/heartbeat', limit(12000), async (request) => ({ server: await heartbeatPartnerServer(partnerOf(request), idOf(request)) }));

  /** Lebenszeichen für viele Server auf einmal */
  app.post('/partner/heartbeat', limit(1200), async (request) => {
    const { servers } = z.object({ servers: z.array(z.string().uuid()).max(500) }).parse(request.body);
    return heartbeatMany(partnerOf(request), servers);
  });

  /** Der Host hat den Launcher geschlossen */
  app.post('/partner/servers/:id/stop', limit(1200), async (request) => ({ server: await stopPartnerServer(partnerOf(request), idOf(request)) }));

  /** Konsolenbefehl (z. B. „op Name“) */
  app.post('/partner/servers/:id/command', limit(1200), async (request) => {
    const { command } = z.object({ command: z.string().trim().min(1).max(200) }).parse(request.body);
    await commandPartnerServer(partnerOf(request), idOf(request), command);
    return { ok: true };
  });

  /** Server samt Daten löschen (DELETE oder POST …/delete) */
  const remove = async (request: FastifyRequest) => {
    await deletePartnerServer(partnerOf(request), idOf(request), request.ip);
    return { ok: true };
  };
  app.delete('/partner/servers/:id', limit(600), remove);
  app.post('/partner/servers/:id/delete', limit(600), remove);
}

/** Admin-Bereich: Partner und ihre API-Keys verwalten */
export async function partnerAdminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);
  const input = z.object({
    name: z.string().trim().min(2).max(60),
    planId: z.string().trim().min(1).max(64),
    maxServers: z.number().int().min(0).max(100_000).default(100),
    maxServersPerPlayer: z.number().int().min(1).max(20).default(1),
    sessionMaxHours: z.number().int().min(1).max(720).default(24),
    cooldownHours: z.number().int().min(0).max(168).default(2),
    heartbeatTimeoutSeconds: z.number().int().min(60).max(3600).default(180),
    deleteAfterIdleDays: z.number().int().min(0).max(3650).default(30),
    nodeIds: z.array(z.number().int().positive()).max(50).default([]),
  });
  const idOf = (request: FastifyRequest) => idParam.parse(request.params).id;

  app.get('/admin/partners', async () => ({ partners: await listPartners() }));
  /** Anlegen: Konto, Panel-Konto und API-Key entstehen automatisch – der Key steht nur in dieser Antwort */
  app.post('/admin/partners', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request) => {
    const created = await createPartner(currentUser(request), input.parse(request.body), request.ip);
    return { ...created, partners: await listPartners() };
  });
  app.post('/admin/partners/:id', async (request) => {
    await updatePartner(currentUser(request), idOf(request), input.extend({ enabled: z.boolean() }).parse(request.body), request.ip);
    return { partners: await listPartners() };
  });
  app.post('/admin/partners/:id/rotate-key', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request) => rotatePartnerKey(currentUser(request), idOf(request), request.ip));
  /** Löscht den Partner samt aller Server – in Runden, bis `deleted` true ist */
  app.post('/admin/partners/:id/delete', { config: { rateLimit: { max: 600, timeWindow: '10 minutes' } } }, async (request) => deletePartner(currentUser(request), idOf(request), request.ip));
}
