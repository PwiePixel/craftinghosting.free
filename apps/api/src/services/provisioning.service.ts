/**
 * Anlage von Panel-Konten und Servern in Pterodactyl.
 *
 * Idempotenz:
 *  – Jeder Server/Benutzer bekommt eine external_id. Vor einer Anlage wird
 *    immer zuerst per external_id gesucht → Wiederholungen erzeugen keine Duplikate.
 *  – Ein Versuch wird über `provisioning_attempts` optimistisch "geclaimt",
 *    parallele Läufe (API + Worker) überspringen sich gegenseitig.
 */
import { partnerNodeIds } from './partner-nodes';
import { and, eq, inArray } from 'drizzle-orm';
import { findPlan, getServerType, type SiteSettings } from '@chfree/shared';
import { getEggMapping, pterodactylConfig } from '../config/pterodactyl.config';
import { env, panelPublicUrl } from '../env';
import { affectedRows, db } from '../db/client';
import { servers, users, type Server, type User } from '../db/schema';
import { ApiError, L } from '../lib/errors';
import { pterodactyl, PterodactylError, type PteroEgg, type PteroServer } from '../pterodactyl';
import type { PteroNode } from '../pterodactyl/types';
import { audit } from './audit.service';
import { notify } from './notification.service';
import { getUserLocale } from './locale.service';
import { desiredPanelDescription } from './panel';
import { getSettings } from './settings.service';

export const MAX_PROVISIONING_ATTEMPTS = 5;

/** Pterodactyl-Locations: je Hardware-Stufe (aus der Warteliste), sonst die allgemeinen */
function locationsFor(tier: Server['nodeTier']): number[] {
  const ids = (list: string[]) => list.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const tiered = tier === 'epyc' ? ids(env.PTERODACTYL_LOCATION_IDS_EPYC) : tier === 'xeon' ? ids(env.PTERODACTYL_LOCATION_IDS_XEON) : [];
  if (tiered.length) return tiered;
  return ids(env.PTERODACTYL_LOCATION_IDS);
}

/** Hat die Node laut Panel noch Platz für diesen Server? Ohne Angaben des Panels gilt: ja. */
function nodeHasRoom(node: PteroNode, server: Pick<Server, 'memoryMb' | 'diskMb'>): boolean {
  const fits = (total: number, allocated: number | undefined, over: number | undefined, need: number) => {
    if (allocated === undefined || over === undefined || over < 0) return true; // -1 = im Panel unbegrenzt
    return allocated + need <= total * (1 + over / 100);
  };
  return fits(node.memoryMb, node.allocatedMemoryMb, node.memoryOverallocate, server.memoryMb) && fits(node.diskMb, node.allocatedDiskMb, node.diskOverallocate, server.diskMb);
}

/**
 * Feste Node für ein Produkt (Admin → Pterodactyl): sucht auf den zugewiesenen Nodes eine freie Allokation.
 * Die Node mit den meisten freien Ports gewinnt – so verteilen sich die Server gleichmäßig.
 * Rückgabe null = keine Node zugewiesen → automatische Platzierung über die Locations.
 *
 * Private Nodes (Admin → Pterodactyl → „Privat“) werden nie verwendet – auch nicht, wenn alle anderen voll sind.
 * Dann schlägt die Erstellung fehl, statt auf eine private Node auszuweichen.
 */
async function pickAllocation(server: Server, settings: SiteSettings): Promise<number | null> {
  const ptero = pterodactyl();
  const privateNodes = settings.privateNodeIds;
  let nodeIds = settings.products[server.kind].nodeIds.filter((id) => !privateNodes.includes(id));
  // Server der Partner-API: feste Nodes des Partners haben Vorrang – dort sind auch private Nodes erlaubt
  const partnerNodes = server.partnerId ? await partnerNodeIds(server.partnerId) : [];
  if (partnerNodes.length) nodeIds = partnerNodes;
  let nodes: PteroNode[] | null = null;
  // Automatisch verteilte Server: Hier prüfte bisher das Panel, ob die Node noch Platz hat – das übernehmen wir
  let checkRoom = false;
  if (nodeIds.length === 0) {
    if (server.kind === 'discord') {
      if (env.PTERODACTYL_MODE === 'live') throw new Error('Für Discord-Bots ist noch keine Node zugewiesen (Admin → Pterodactyl)');
      return null;
    }
    // Minecraft ohne feste Nodes: automatische Platzierung – aber nie auf privaten Nodes und nie auf denen für Discord-Bots
    const excluded = [...new Set([...settings.products.discord.nodeIds, ...privateNodes])];
    if (excluded.length === 0) return null;
    nodes = await ptero.listNodes();
    // Wie bei der automatischen Platzierung: nur Nodes in den Locations dieser Hardware-Stufe
    const locations = locationsFor(server.nodeTier);
    nodeIds = nodes.filter((n) => !excluded.includes(n.id) && (locations.length === 0 || locations.includes(n.locationId))).map((n) => n.id);
    if (nodeIds.length === 0) throw new Error('Keine Node für Minecraft-Server übrig: Alle Nodes sind privat oder für Discord-Bots reserviert (Admin → Pterodactyl)');
    checkRoom = true;
  }
  nodes ??= await ptero.listNodes();
  let best: { id: number; count: number } | null = null;
  for (const nodeId of nodeIds) {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || node.maintenanceMode) continue;
    if (checkRoom && !nodeHasRoom(node, server)) continue;
    const free = await ptero.freeAllocations(nodeId);
    if (free.firstId !== null && (!best || free.count > best.count)) best = { id: free.firstId, count: free.count };
  }
  if (!best) {
    throw new Error(
      `Kein Platz auf den Nodes für ${server.kind === 'discord' ? 'Discord-Bots' : 'Minecraft-Server'} (${nodeIds.join(', ')}): keine freie Allokation (Port), Node voll oder im Wartungsmodus. Private Nodes werden nicht verwendet.`,
    );
  }
  return best.id;
}

/** Locations für die automatische Platzierung: aus der .env – sonst alle Locations des Panels */
async function deployLocations(tier: Server['nodeTier']): Promise<number[]> {
  const fromEnv = locationsFor(tier);
  if (fromEnv.length) return fromEnv;
  const all = await pterodactyl().listLocations();
  if (all.length === 0) throw new Error('Im Panel ist keine Location eingerichtet');
  return all.map((l) => l.id);
}

const eggCache = new Map<string, { egg: PteroEgg; at: number }>();

async function getEggCached(nestId: number, eggId: number): Promise<PteroEgg> {
  const key = `${nestId}:${eggId}`;
  const hit = eggCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.egg;
  const egg = await pterodactyl().getEgg(nestId, eggId);
  eggCache.set(key, { egg, at: Date.now() });
  return egg;
}

/** Egg, Image, Startbefehl und Variablen für einen Servertyp in einer Version (auch für den späteren Wechsel) */
export async function startupFor(serverType: string, version: string, settings: SiteSettings): Promise<{ eggId: number; dockerImage: string; startup: string; environment: Record<string, string> }> {
  const egg = getEggMapping(serverType, settings);
  if (!getServerType(serverType) || !egg) throw new Error(`Für den Servertyp „${serverType}“ ist kein Egg eingerichtet (Admin → Pterodactyl)`);
  const eggInfo = await getEggCached(egg.nestId, egg.eggId);
  const environment: Record<string, string> = {};
  for (const v of eggInfo.variables) environment[v.envVariable] = v.defaultValue;
  Object.assign(environment, egg.environment ?? {});
  if (egg.versionVariable) environment[egg.versionVariable] = version;
  return { eggId: egg.eggId, dockerImage: egg.dockerImage || eggInfo.dockerImage, startup: eggInfo.startup, environment };
}

function errorFields(err: PterodactylError): string {
  return JSON.stringify(err.details ?? err.message).toLowerCase();
}

/**
 * Verknüpft ein bereits vorhandenes Panel-Konto mit derselben (bestätigten)
 * E-Mail-Adresse – z. B. bestehende CraftingHosting-Kunden.
 */
export async function linkExistingPanelAccount(user: User, ip?: string): Promise<boolean> {
  if (user.pteroUserId) return true;
  const existing = await pterodactyl().findUserByEmail(user.email);
  if (!existing) return false;
  await db.update(users).set({ pteroUserId: existing.id, pteroUsername: existing.username }).where(eq(users.id, user.id));
  await audit({ userId: user.id, actor: 'system', action: 'panel.linked', message: `Bestehendes Panel-Konto verknüpft (${existing.username})`, ip });
  return true;
}

/**
 * Legt das Panel-Konto mit dem vom Nutzer gewählten Passwort an.
 * Das Passwort wird ausschließlich an Pterodactyl übergeben und nirgends gespeichert.
 */
export async function createPanelAccount(user: User, username: string, password: string, ip?: string): Promise<{ existing: boolean }> {
  if (user.pteroUserId) return { existing: true };
  const ptero = pterodactyl();
  const externalId = `${pterodactylConfig.externalIdPrefix.user}${user.id}`;

  let panelUser = await ptero.findUserByExternalId(externalId);
  let existing = false;
  if (!panelUser) {
    try {
      panelUser = await ptero.createUser({ externalId, email: user.email, username, firstName: username, lastName: 'Free', password });
    } catch (err) {
      if (err instanceof PterodactylError && err.status === 422) {
        const fields = errorFields(err);
        if (fields.includes('email')) {
          // Ein bestehendes Panel-Konto wird nur über eine BESTÄTIGTE E-Mail-Adresse verknüpft – sonst könnte sich
          // jemand mit einer fremden Adresse an ein fremdes Panel-Konto hängen.
          if (!user.emailVerifiedAt) {
            const msg = L(
              'Für diese E-Mail-Adresse gibt es im Panel schon ein Konto. Bestätige zuerst deine E-Mail-Adresse (Code per E-Mail) – dann verknüpfen wir es. Oder ändere deine E-Mail-Adresse.',
              'A panel account already exists for this email address. Confirm your email address first (code by email) – then we will link it. Or change your email address.',
            );
            throw new ApiError(409, 'panel_email_exists', msg);
          }
          panelUser = await ptero.findUserByEmail(user.email);
          existing = !!panelUser;
        } else if (fields.includes('username')) {
          const taken = L('Dieser Benutzername ist im Panel bereits vergeben.', 'This username is already taken in the panel.');
          throw new ApiError(409, 'panel_username_taken', taken, { username: taken });
        } else if (fields.includes('password')) {
          const invalid = L('Das Passwort erfüllt die Anforderungen des Panels nicht.', 'The password does not meet the requirements of the panel.');
          throw new ApiError(400, 'panel_password_invalid', invalid, { password: invalid });
        }
      }
      if (!panelUser) throw err;
    }
  }
  await db.update(users).set({ pteroUserId: panelUser.id, pteroUsername: panelUser.username }).where(eq(users.id, user.id));
  await audit({
    userId: user.id,
    actor: 'user',
    action: existing ? 'panel.linked' : 'panel.created',
    message: existing ? `Bestehendes Panel-Konto verknüpft (${panelUser.username})` : `Panel-Konto angelegt (${panelUser.username})`,
    ip,
  });
  return { existing };
}

function formatAddress(p: PteroServer): string | null {
  if (!p.allocation) return null;
  return `${p.allocation.alias || p.allocation.ip}:${p.allocation.port}`;
}

export async function provisionServer(serverId: string, actor: 'user' | 'system', ip?: string): Promise<'active' | 'failed' | 'skipped'> {
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server || (server.status !== 'provisioning' && server.status !== 'provisioning_failed')) return 'skipped';

  const [user] = await db.select().from(users).where(eq(users.id, server.userId)).limit(1);
  if (!user?.pteroUserId) return 'skipped'; // Panel-Konto fehlt noch

  // Versuch claimen (optimistische Sperre)
  const claim = await db
    .update(servers)
    .set({ provisioningAttempts: server.provisioningAttempts + 1, lastProvisionAttemptAt: new Date() })
    .where(
      and(
        eq(servers.id, server.id),
        inArray(servers.status, ['provisioning', 'provisioning_failed']),
        eq(servers.provisioningAttempts, server.provisioningAttempts),
      ),
    );
  if (affectedRows(claim) !== 1) return 'skipped';

  try {
    const settings = await getSettings();
    const plan = findPlan(settings, server.planId);
    const type = getServerType(server.serverType);
    const egg = getEggMapping(server.serverType, settings);
    if (!type || !egg) throw new Error(`Für den Servertyp „${server.serverType}“ ist kein Egg eingerichtet (Admin → Pterodactyl)`);

    const ptero = pterodactyl();
    const externalId = `${pterodactylConfig.externalIdPrefix.server}${server.id}`;
    const description = desiredPanelDescription({ ...server, status: 'active' }, new Date(), await getUserLocale(server.userId), settings.products[server.kind].fairUse);

    let pServer = await ptero.findServerByExternalId(externalId);
    if (!pServer) {
      const eggInfo = await getEggCached(egg.nestId, egg.eggId);
      const environment: Record<string, string> = {};
      for (const v of eggInfo.variables) environment[v.envVariable] = v.defaultValue;
      Object.assign(environment, egg.environment ?? {});
      // Minecraft: Version setzen · Discord-Bots: Standardwerte des Eggs (Startdatei, requirements.txt …)
      if (egg.versionVariable) environment[egg.versionVariable] = server.version;
      const allocationId = await pickAllocation(server, settings);

      pServer = await ptero.createServer({
        externalId,
        name: server.name,
        description,
        userId: user.pteroUserId,
        eggId: egg.eggId,
        dockerImage: egg.dockerImage || eggInfo.dockerImage,
        startup: eggInfo.startup,
        environment,
        // Ressourcen aus dem Snapshot des Servers – das Paket kann inzwischen geändert oder entfernt worden sein
        limits: { memory: server.memoryMb, swap: plan?.swapMb ?? 0, disk: server.diskMb, io: plan?.ioWeight ?? 500, cpu: server.cpuPercent },
        featureLimits: { databases: plan?.databases ?? 0, allocations: plan?.allocations ?? 1, backups: plan?.backups ?? 0 },
        locationIds: allocationId ? [] : await deployLocations(server.nodeTier),
        ...(allocationId ? { allocationId } : {}),
        startOnCompletion: pterodactylConfig.startOnCompletion,
      });
    }

    const res = await db
      .update(servers)
      .set({
        status: 'active',
        powerState: 'installing',
        powerStateAt: new Date(),
        pteroServerId: pServer.id,
        pteroIdentifier: pServer.identifier,
        pteroUuid: pServer.uuid,
        address: formatAddress(pServer),
        provisioningError: null,
        panelDescription: pServer.description || description,
      })
      .where(and(eq(servers.id, server.id), inArray(servers.status, ['provisioning', 'provisioning_failed'])));

    if (affectedRows(res) !== 1) {
      // Der Server wurde währenddessen gelöscht: den eben angelegten Panel-Server wieder entfernen, sonst bliebe er
      // ohne Eintrag bei uns für immer liegen (und würde bei keiner Grenze mitgezählt)
      const [cur] = await db.select({ status: servers.status }).from(servers).where(eq(servers.id, server.id)).limit(1);
      if (!cur || cur.status === 'deleted') {
        const orphan = pServer.id;
        const removed = await ptero.deleteServer(orphan).then(() => true, () => false);
        await audit({ userId: user.id, serverId: server.id, actor: 'system', action: 'server.orphan_removed', message: removed ? `Während der Einrichtung gelöscht – Panel-Server #${orphan} wieder entfernt` : `Während der Einrichtung gelöscht – Panel-Server #${orphan} konnte NICHT entfernt werden (bitte im Panel löschen)`, meta: { pteroServerId: orphan, removed } });
        return 'active';
      }
    }
    if (affectedRows(res) === 1) {
      await audit({
        userId: user.id,
        serverId: server.id,
        actor,
        action: 'server.provisioned',
        message: `Server in Pterodactyl angelegt (#${pServer.id})`,
        meta: { pteroServerId: pServer.id, identifier: pServer.identifier },
        ip,
      });
    }
    return 'active';
  } catch (err) {
    const message = (err as Error).message.slice(0, 480);
    await db
      .update(servers)
      .set({ status: 'provisioning_failed', provisioningError: message })
      .where(and(eq(servers.id, server.id), inArray(servers.status, ['provisioning', 'provisioning_failed'])));
    await audit({
      userId: user.id,
      serverId: server.id,
      actor: 'system',
      action: 'server.provisioning_failed',
      message: `Anlage fehlgeschlagen (Versuch ${server.provisioningAttempts + 1}): ${message}`,
    });
    if (server.provisioningAttempts + 1 >= MAX_PROVISIONING_ATTEMPTS) {
      await notify({
        userId: user.id,
        serverId: server.id,
        type: 'server.provisioning_failed',
        title: L('Server konnte nicht erstellt werden', 'Server could not be created'),
        body: L(
          `„${server.name}“ konnte nach mehreren Versuchen nicht angelegt werden. Bitte lösche die Anfrage unter „Meine Server“ und versuche es erneut oder kontaktiere den Support.`,
          `“${server.name}” could not be created after several attempts. Please delete the request under “My servers” and try again, or contact support.`,
        ),
        dedupeKey: `server-provisioning-failed:${server.id}`,
        email: true,
      });
    }
    return 'failed';
  }
}

/**
 * Nacharbeiten nach der Installation (automatischer Backup-Zeitplan)
 * und Info-Mail „Server ist bereit – im Panel starten“.
 */
export async function runPostProvision(server: Server): Promise<boolean> {
  if (server.postProvisionDone || !server.pteroIdentifier || server.status !== 'active') return false;
  if (server.powerState === 'installing' || server.powerState === 'unknown') return false;
  let scheduleId: number | null = server.backupScheduleId;
  const plan = findPlan(await getSettings(), server.planId);
  const bot = server.kind === 'discord';
  if (pterodactylConfig.backupSchedule.enabled && !scheduleId && plan && plan.backups > 0) {
    scheduleId = await pterodactyl().createBackupSchedule(server.pteroIdentifier, pterodactylConfig.backupSchedule);
  }
  const res = await db
    .update(servers)
    .set({ postProvisionDone: true, backupScheduleId: scheduleId })
    .where(and(eq(servers.id, server.id), eq(servers.postProvisionDone, false)));
  if (affectedRows(res) === 1) {
    await audit({
      userId: server.userId,
      serverId: server.id,
      actor: 'system',
      action: 'server.ready',
      message: 'Installation abgeschlossen – Server ist startbereit',
    });
    await notify({
      userId: server.userId,
      serverId: server.id,
      type: 'server.ready',
      title: bot ? L('Dein Discord-Bot-Server ist bereit', 'Your Discord bot server is ready') : L('Dein Minecraft-Server ist bereit', 'Your Minecraft server is ready'),
      body: bot
        ? L(
            [
              `„${server.name}“ ist fertig eingerichtet. Lade jetzt im Pterodactyl-Panel den Code deines Bots hoch (Dateimanager oder SFTP), trage unter „Startup“ deine Startdatei ein und starte den Server.`,
              `Panel: ${panelPublicUrl} · Anmeldung mit deiner E-Mail-Adresse und deinem Panel-Passwort.`,
              'Tipp: Bewahre deinen Bot-Token nur in einer .env- oder Konfigurationsdatei auf dem Server auf und teile ihn mit niemandem.',
            ].join('\n'),
            [
              `“${server.name}” has been set up. Now upload your bot’s code in the Pterodactyl panel (file manager or SFTP), enter your start file under “Startup” and start the server.`,
              `Panel: ${panelPublicUrl} · Sign in with your email address and your panel password.`,
              'Tip: keep your bot token only in a .env or config file on the server and never share it.',
            ].join('\n'),
          )
        : L(
        [
          `„${server.name}“ ist fertig installiert. Starte ihn jetzt im Pterodactyl-Panel – dort findest du Konsole, Dateien, Plugins und Backups.`,
          `Panel: ${panelPublicUrl} · Anmeldung mit deiner E-Mail-Adresse und deinem Panel-Passwort.`,
          server.address ? `Adresse für Minecraft: ${server.address}` : '',
        ].join('\n'),
        [
          `“${server.name}” has been installed. Start it now in the Pterodactyl panel – there you will find the console, files, plugins and backups.`,
          `Panel: ${panelPublicUrl} · Sign in with your email address and your panel password.`,
          server.address ? `Address for Minecraft: ${server.address}` : '',
        ].join('\n'),
      ),
      dedupeKey: `server-ready:${server.id}`,
      email: true,
    });
  }
  return true;
}

