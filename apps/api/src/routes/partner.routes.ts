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
import {
  changePartnerServer,
  consoleTarget,
  createPartnerBackup,
  createPartnerFolder,
  deletePartnerBackup,
  listPartnerBackups,
  partnerBackupDownloadUrl,
  restorePartnerBackup,
  decompressPartnerFile,
  deletePartnerFiles,
  getPartnerSettings,
  installModrinth,
  listPartnerFiles,
  partnerDownloadUrl,
  partnerLogs,
  partnerStats,
  partnerUploadUrl,
  pullPartnerFile,
  readPartnerFile,
  renamePartnerServer,
  setPartnerSettings,
  writePartnerFile,
} from '../services/partner-extras.service';
import { streamPartnerConsole } from '../services/partner-console';
import { clearPartnerWebhook, emitPartnerEvent, partnerWebhookStatus, setPartnerWebhook } from '../services/partner-webhooks.service';
import { asPartner } from '../pterodactyl/budget';
import { getSettings } from '../services/settings.service';

declare module 'fastify' {
  interface FastifyRequest {
    partner: Partner | null;
    /** Unveränderter Inhalt der Anfrage (für Datei-Uploads über die Partner-API) */
    rawBody: Buffer | null;
  }
}

const keyOf = (request: FastifyRequest): string | undefined => {
  const auth = request.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const header = request.headers['x-api-key'];
  return typeof header === 'string' ? header.trim() : undefined;
};

/**
 * Anfragen werden je Partner begrenzt (nicht je IP): Der Partner bündelt die Anfragen vieler Nutzer.
 * Der Key ist an dieser Stelle schon geprüft – ein erfundener Key bekommt also kein eigenes Kontingent, sondern
 * zählt (mit einer deutlich kleineren Grenze) auf die IP-Adresse.
 */
const limit = (max: number) => ({
  // Kein automatisches HEAD-Gegenstück: Es bekäme einen eigenen Zähler und würde jede Lese-Grenze verdoppeln
  exposeHeadRoute: false,
  config: {
    rateLimit: {
      max: (request: FastifyRequest) => (request.partner ? max : Math.min(max, 30)),
      timeWindow: '1 minute',
      keyGenerator: (request: FastifyRequest) => (request.partner ? `partner:${request.partner.id}` : `partner-ip:${request.ip}`),
    },
  },
});

const idParam = z.object({ id: z.string().uuid() });
const playerSchema = z.object({ externalId: z.string().trim().min(1).max(80), name: z.string().trim().max(60).nullish() });

export async function partnerRoutes(app: FastifyInstance) {
  app.decorateRequest('partner', null);
  app.decorateRequest('rawBody', null);
  // Alles andere (Dateien beliebiger Art) kommt unverändert als Bytes an
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (request, body, done) => {
    request.rawBody = Buffer.isBuffer(body) ? body : null;
    done(null, body);
  });

  // Viele Clients schicken POST-Anfragen ohne Inhalt, aber mit JSON-Kopfzeile (z. B. Lebenszeichen, Stopp) – das ist hier erlaubt
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';
    // Für Datei-Uploads bleibt der Inhalt so erhalten, wie er geschickt wurde (auch wenn es JSON ist)
    _request.rawBody = typeof body === 'string' ? Buffer.from(body, 'utf8') : null;
    if (!text) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new ApiError(400, 'invalid_json', L('Der Inhalt der Anfrage ist kein gültiges JSON.', 'The request body is not valid JSON.')), undefined);
    }
  });

  // Den Key ganz am Anfang prüfen – noch vor der Anfragebegrenzung (die danach je Partner zählt) …
  app.addHook('onRequest', async (request) => {
    request.partner = await partnerByKey(keyOf(request));
  });
  // … und ohne gültigen Key ablehnen, bevor der Inhalt der Anfrage (bis zu 10 MB) überhaupt gelesen wird
  app.addHook('preParsing', async (request) => {
    if (!request.partner) throw new ApiError(401, 'invalid_api_key', L('Der API-Key fehlt, ist ungültig oder der Partner ist deaktiviert.', 'The API key is missing, invalid or the partner is disabled.'));
  });
  // Panel-Aufrufe aus einer Partner-Anfrage zählen gegen das Kontingent dieses Partners (pterodactyl/budget.ts)
  app.addHook('onRoute', (route) => {
    const handler = route.handler;
    route.handler = function (request, reply) {
      return request.partner ? asPartner(request.partner.id, () => handler.call(this, request, reply)) : handler.call(this, request, reply);
    };
  });
  const partnerOf = (request: FastifyRequest) => request.partner!;
  const idOf = (request: FastifyRequest) => idParam.parse(request.params).id;
  /** Während einer Wartung lassen sich keine Server erstellen, starten, löschen, neu installieren oder Backups anlegen/einspielen */
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
  app.post('/partner/servers/:id/stop', limit(1200), async (request) => {
    const body = z.object({ whenEmpty: z.boolean().optional() }).parse(request.body ?? {});
    return { server: await stopPartnerServer(partnerOf(request), idOf(request), body) };
  });

  /** Konsolenbefehl (z. B. „op Name“) */
  app.post('/partner/servers/:id/command', limit(1200), async (request) => {
    const { command } = z.object({ command: z.string().trim().min(1).max(200) }).parse(request.body);
    await commandPartnerServer(partnerOf(request), idOf(request), command);
    return { ok: true };
  });

  /**
   * Server ändern: { "name": "…" } benennt um; { "serverType": "…", "version": "…" } wechselt Typ bzw. Version und
   * installiert neu (der Server muss dafür aus sein). Paket, Ressourcen und Laufzeit-Stand bleiben.
   */
  app.patch('/partner/servers/:id', limit(300), async (request) => {
    // Streng: nur diese drei Felder – Ressourcen, Startbefehl, Image usw. lassen sich hier nicht mitgeben
    const body = z.strictObject({ name: z.string().max(60).optional(), serverType: z.string().max(40).optional(), version: z.string().max(40).optional() }).parse(request.body);
    if (body.name === undefined && body.serverType === undefined && body.version === undefined) throw new ApiError(400, 'validation_error', L('Bitte „name“, „serverType“ oder „version“ angeben.', 'Please specify “name”, “serverType” or “version”.'));
    let server = body.name !== undefined ? await renamePartnerServer(partnerOf(request), idOf(request), body.name, request.ip) : null;
    if (body.serverType !== undefined || body.version !== undefined) {
      await assertOpen();
      server = await changePartnerServer(partnerOf(request), idOf(request), { serverType: body.serverType, version: body.version }, request.ip);
    }
    return { server };
  });
  /** Neu installieren, ohne etwas zu ändern (der Server muss aus sein) */
  app.post('/partner/servers/:id/reinstall', limit(60), async (request) => {
    await assertOpen();
    return { server: await changePartnerServer(partnerOf(request), idOf(request), {}, request.ip) };
  });

  /* ---- Backups (Anzahl laut Paket) ---- */
  const backupOf = (request: FastifyRequest) => z.string().max(40).parse((request.params as { backup: string }).backup);
  app.get('/partner/servers/:id/backups', limit(1200), async (request) => listPartnerBackups(partnerOf(request), idOf(request)));
  app.post('/partner/servers/:id/backups', limit(60), async (request, reply) => {
    const { name } = z.object({ name: z.string().max(60).optional() }).parse(request.body ?? {});
    await assertOpen();
    reply.code(201);
    return createPartnerBackup(partnerOf(request), idOf(request), name);
  });
  app.get('/partner/servers/:id/backups/:backup/download-url', limit(600), async (request) => partnerBackupDownloadUrl(partnerOf(request), idOf(request), backupOf(request)));
  app.post('/partner/servers/:id/backups/:backup/restore', limit(60), async (request) => {
    const { truncate } = z.object({ truncate: z.boolean().default(false) }).parse(request.body ?? {});
    await assertOpen();
    return restorePartnerBackup(partnerOf(request), idOf(request), backupOf(request), truncate, request.ip);
  });
  app.delete('/partner/servers/:id/backups/:backup', limit(300), async (request) => deletePartnerBackup(partnerOf(request), idOf(request), backupOf(request)));

  /* ---- Webhooks ---- */
  app.get('/partner/webhook', limit(600), async (request) => partnerWebhookStatus(partnerOf(request)));
  /** Adresse setzen bzw. ändern – das Geheimnis zum Prüfen der Signatur steht nur in dieser Antwort */
  app.put('/partner/webhook', limit(30), async (request) => {
    const { url } = z.object({ url: z.string().min(8).max(500) }).parse(request.body);
    return setPartnerWebhook(partnerOf(request), url);
  });
  app.delete('/partner/webhook', limit(30), async (request) => {
    await clearPartnerWebhook(partnerOf(request));
    return { ok: true };
  });
  /** Test-Ereignis an die eingerichtete Adresse schicken */
  app.post('/partner/webhook/test', limit(30), async (request) => {
    const partner = partnerOf(request);
    if (!(await partnerWebhookStatus(partner)).url) throw new ApiError(409, 'no_webhook', L('Es ist kein Webhook eingerichtet.', 'No webhook is configured.'));
    await emitPartnerEvent(partner.id, 'webhook.test', { message: 'Test' });
    return { ok: true };
  });

  /**
   * Live-Konsole als Server-Sent Events (nur lesend): Ereignisse „line“, „status“, „info“ und „end“.
   * Höchstens 15 Minuten je Verbindung – danach neu verbinden. Zählt nicht als Lebenszeichen.
   */
  app.get('/partner/servers/:id/console/stream', limit(300), async (request, reply) => {
    const partner = partnerOf(request);
    const server = await consoleTarget(partner, idOf(request));
    await streamPartnerConsole(partner, server, request, reply);
  });

  /* ---- Dateien: Mods, Plugins, Einstellungen, Welten ---- */
  const pathQuery = z.object({ path: z.string().min(1).max(400) });

  app.get('/partner/servers/:id/files', limit(1200), async (request) => {
    const { dir } = z.object({ dir: z.string().max(400).default('/') }).parse(request.query);
    return listPartnerFiles(partnerOf(request), idOf(request), dir);
  });
  /** Textdatei lesen */
  app.get('/partner/servers/:id/files/content', limit(1200), async (request) => readPartnerFile(partnerOf(request), idOf(request), pathQuery.parse(request.query).path));
  /** Datei schreiben: Inhalt als Körper der Anfrage (bis 10 MB) */
  app.put('/partner/servers/:id/files/content', { ...limit(600), bodyLimit: 10 * 1024 * 1024 }, async (request) => {
    const content = request.rawBody ?? (typeof request.body === 'string' ? Buffer.from(request.body) : null);
    if (!content) throw new ApiError(400, 'validation_error', L('Der Inhalt der Datei fehlt.', 'The file content is missing.'));
    return writePartnerFile(partnerOf(request), idOf(request), pathQuery.parse(request.query).path, content);
  });
  /** Adresse für den direkten Upload großer Dateien (multipart, Feld „files“) */
  app.post('/partner/servers/:id/files/upload-url', limit(600), async (request) => {
    const { directory } = z.object({ directory: z.string().max(400).default('/') }).parse(request.body ?? {});
    return partnerUploadUrl(partnerOf(request), idOf(request), directory);
  });
  app.get('/partner/servers/:id/files/download-url', limit(1200), async (request) => partnerDownloadUrl(partnerOf(request), idOf(request), pathQuery.parse(request.query).path));
  app.post('/partner/servers/:id/files/delete', limit(600), async (request) => {
    const { paths } = z.object({ paths: z.array(z.string().min(1).max(400)).min(1).max(100) }).parse(request.body);
    return deletePartnerFiles(partnerOf(request), idOf(request), paths);
  });
  app.post('/partner/servers/:id/files/folder', limit(600), async (request) => createPartnerFolder(partnerOf(request), idOf(request), pathQuery.parse(request.body).path));
  /** Archiv entpacken (z. B. eine hochgeladene Welt) */
  app.post('/partner/servers/:id/files/decompress', limit(300), async (request) => decompressPartnerFile(partnerOf(request), idOf(request), pathQuery.parse(request.body).path));
  /** Datei von einer https-Adresse direkt auf den Server laden */
  app.post('/partner/servers/:id/files/pull', limit(600), async (request) => {
    const body = z.object({ url: z.string().min(8).max(2000), directory: z.string().max(400).default('/'), filename: z.string().max(120).optional() }).parse(request.body);
    return pullPartnerFile(partnerOf(request), idOf(request), body);
  });

  /** Mod bzw. Plugin von Modrinth installieren: { "project": "sodium" } oder { "version": "<Versions-ID>" } */
  app.post('/partner/servers/:id/mods', limit(600), async (request) => {
    const body = z.object({ source: z.literal('modrinth').default('modrinth'), project: z.string().trim().min(1).max(80).optional(), version: z.string().trim().min(1).max(80).optional(), dependencies: z.boolean().optional() }).parse(request.body);
    return installModrinth(partnerOf(request), idOf(request), body, request.ip);
  });

  /** Die letzten Zeilen der Konsole */
  app.get('/partner/servers/:id/logs', limit(1200), async (request) => {
    const { lines } = z.object({ lines: z.coerce.number().int().min(1).max(1000).default(100) }).parse(request.query);
    return partnerLogs(partnerOf(request), idOf(request), lines);
  });

  /** Servereinstellungen (server.properties) lesen und setzen */
  app.get('/partner/servers/:id/settings', limit(1200), async (request) => getPartnerSettings(partnerOf(request), idOf(request)));
  app.patch('/partner/servers/:id/settings', limit(600), async (request) => setPartnerSettings(partnerOf(request), idOf(request), z.record(z.string(), z.unknown()).parse(request.body)));

  /** Live-Werte: CPU, Arbeitsspeicher, Speicherplatz, Spielerzahl */
  app.get('/partner/servers/:id/stats', limit(6000), async (request) => partnerStats(partnerOf(request), idOf(request)));

  /** Server samt Daten löschen (DELETE oder POST …/delete) */
  const remove = async (request: FastifyRequest) => {
    await assertOpen();
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
    keepAliveWhilePlayers: z.boolean().default(false),
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
