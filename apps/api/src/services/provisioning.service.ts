/**
 * Anlage von Panel-Konten und Servern in Pterodactyl.
 *
 * Idempotenz:
 *  – Jeder Server/Benutzer bekommt eine external_id. Vor einer Anlage wird
 *    immer zuerst per external_id gesucht → Wiederholungen erzeugen keine Duplikate.
 *  – Ein Versuch wird über `provisioning_attempts` optimistisch "geclaimt",
 *    parallele Läufe (API + Worker) überspringen sich gegenseitig.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { getPlan, getServerType } from '@chfree/shared';
import { getEggMapping, pterodactylConfig } from '../config/pterodactyl.config';
import { env, panelPublicUrl } from '../env';
import { affectedRows, db } from '../db/client';
import { servers, users, type Server, type User } from '../db/schema';
import { ApiError, L } from '../lib/errors';
import { pterodactyl, PterodactylError, type PteroEgg, type PteroServer } from '../pterodactyl';
import { audit } from './audit.service';
import { notify } from './notification.service';
import { getUserLocale } from './locale.service';
import { desiredPanelDescription } from './panel';

export const MAX_PROVISIONING_ATTEMPTS = 5;

/** Pterodactyl-Locations: je Hardware-Stufe (aus der Warteliste), sonst die allgemeinen */
function locationsFor(tier: Server['nodeTier']): number[] {
  const ids = (list: string[]) => list.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const tiered = tier === 'epyc' ? ids(env.PTERODACTYL_LOCATION_IDS_EPYC) : tier === 'xeon' ? ids(env.PTERODACTYL_LOCATION_IDS_XEON) : [];
  if (tiered.length) return tiered;
  const general = ids(env.PTERODACTYL_LOCATION_IDS);
  return general.length ? general : [1];
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

function errorFields(err: PterodactylError): string {
  return JSON.stringify(err.details ?? err.message).toLowerCase();
}

/**
 * Verknüpft ein bereits vorhandenes Panel-Konto mit derselben (bestätigten)
 * E-Mail-Adresse – z. B. bestehende CraftingHosting-Kunden.
 */
export async function linkExistingPanelAccount(user: User): Promise<boolean> {
  if (user.pteroUserId) return true;
  const existing = await pterodactyl().findUserByEmail(user.email);
  if (!existing) return false;
  await db.update(users).set({ pteroUserId: existing.id, pteroUsername: existing.username }).where(eq(users.id, user.id));
  await audit({ userId: user.id, actor: 'system', action: 'panel.linked', message: `Bestehendes Panel-Konto verknüpft (${existing.username})` });
  return true;
}

/**
 * Legt das Panel-Konto mit dem vom Nutzer gewählten Passwort an.
 * Das Passwort wird ausschließlich an Pterodactyl übergeben und nirgends gespeichert.
 */
export async function createPanelAccount(user: User, username: string, password: string): Promise<{ existing: boolean }> {
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
  });
  return { existing };
}

function formatAddress(p: PteroServer): string | null {
  if (!p.allocation) return null;
  return `${p.allocation.alias || p.allocation.ip}:${p.allocation.port}`;
}

export async function provisionServer(serverId: string, actor: 'user' | 'system'): Promise<'active' | 'failed' | 'skipped'> {
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
    const plan = getPlan(server.planId);
    const type = getServerType(server.serverType);
    const egg = getEggMapping(server.serverType);
    if (!plan || !type || !egg) throw new Error(`Konfiguration für ${server.planId}/${server.serverType} fehlt`);

    const ptero = pterodactyl();
    const externalId = `${pterodactylConfig.externalIdPrefix.server}${server.id}`;
    const description = desiredPanelDescription({ ...server, status: 'active' }, new Date(), await getUserLocale(server.userId));

    let pServer = await ptero.findServerByExternalId(externalId);
    if (!pServer) {
      const eggInfo = await getEggCached(egg.nestId, egg.eggId);
      const environment: Record<string, string> = {};
      for (const v of eggInfo.variables) environment[v.envVariable] = v.defaultValue;
      Object.assign(environment, egg.environment ?? {});
      environment[egg.versionVariable] = server.version;

      pServer = await ptero.createServer({
        externalId,
        name: server.name,
        description,
        userId: user.pteroUserId,
        eggId: egg.eggId,
        dockerImage: egg.dockerImage || eggInfo.dockerImage,
        startup: eggInfo.startup,
        environment,
        limits: { memory: plan.memoryMb, swap: plan.swapMb, disk: plan.diskMb, io: plan.ioWeight, cpu: plan.cpuPercent },
        featureLimits: { databases: plan.databases, allocations: plan.allocations, backups: plan.backups },
        locationIds: locationsFor(server.nodeTier),
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

    if (affectedRows(res) === 1) {
      await audit({
        userId: user.id,
        serverId: server.id,
        actor,
        action: 'server.provisioned',
        message: `Server in Pterodactyl angelegt (#${pServer.id})`,
        meta: { pteroServerId: pServer.id, identifier: pServer.identifier },
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
  const plan = getPlan(server.planId);
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
      title: L('Dein Minecraft-Server ist bereit', 'Your Minecraft server is ready'),
      body: L(
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

