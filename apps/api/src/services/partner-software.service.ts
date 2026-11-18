/**
 * Server-Software über das Software-Verzeichnis einrichten („Versionswechsel“ der Partner-API).
 *
 * Im Panel gibt es nicht für jede Minecraft-Software ein eigenes Egg: Fabric, Forge, NeoForge, Quilt usw. teilen sich
 * das Paper-Egg, und die eigentliche Software wird nachträglich auf den Server gebracht. Genau das erledigt dieser
 * Dienst – ohne Panel-Zugang des Nutzers: Er schlägt Typ und Version im Verzeichnis MCJars nach, lädt die Dateien über
 * den Node direkt auf den Server, entpackt sie und stellt die passende Java-Version ein.
 *
 * Sicherheit: Typ und Version kommen aus unserer festen Auswahl. Adressen und Dateinamen der Schritte kommen aus dem
 * Verzeichnis (nie vom Partner) und werden vor dem Ausführen geprüft. Paket, Arbeitsspeicher, CPU, Speicherplatz und
 * Ports des Servers werden dabei nie angefasst.
 */
import { eq, sql } from 'drizzle-orm';
import { getServerType } from '@chfree/shared';
import { db } from '../db/client';
import { partnerServers, partners, servers, type PartnerServer, type Server, type SoftwareJob, type SoftwareStep } from '../db/schema';
import { env } from '../env';
import { BASE_SERVER_TYPE, sharesBaseEgg } from '../config/pterodactyl.config';
import { Errors, L } from '../lib/errors';
import { mapLimit } from '../jobs/types';
import { pterodactyl } from '../pterodactyl';
import { audit } from './audit.service';
import { emitPartnerEvent } from './partner-webhooks.service';
import { startupFor } from './provisioning.service';
import { getSettings, serverTypeAvailable } from './settings.service';
import type { SiteSettings } from '@chfree/shared';

/** Unsere Servertypen → Bezeichnung im Verzeichnis */
const DIRECTORY_TYPES: Record<string, string> = { paper: 'PAPER', purpur: 'PURPUR', vanilla: 'VANILLA', fabric: 'FABRIC', forge: 'FORGE', neoforge: 'NEOFORGE', quilt: 'QUILT' };

/** Wird dieser Typ über das Verzeichnis eingerichtet (statt über ein eigenes Egg)? */
export const installsViaDirectory = (serverType: string, settings: Pick<SiteSettings, 'products'>): boolean => !!DIRECTORY_TYPES[serverType] && sharesBaseEgg(serverType, settings);

/** Steht der Typ für Partner zur Verfügung? (eigenes Egg – oder Einrichtung über das Verzeichnis) */
export function partnerTypeAvailable(serverType: string, settings: SiteSettings): boolean {
  const type = getServerType(serverType);
  if (!type || type.kind !== 'minecraft') return false;
  return installsViaDirectory(serverType, settings) || serverTypeAvailable(serverType, settings);
}

interface DirectoryBuild {
  name?: string | null;
  versionId?: string | null;
  projectVersionId?: string | null;
  installation?: unknown;
}
interface DirectoryVersion {
  type?: string;
  supported?: boolean;
  java?: number | null;
  latest?: DirectoryBuild | null;
}

const directoryCache = new Map<string, { at: number; versions: Record<string, DirectoryVersion> }>();

const unavailable = () => Errors.unavailable(L('Das Verzeichnis der Server-Software ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.', 'The server software directory cannot be reached right now. Please try again shortly.'));

async function directory(serverType: string): Promise<Record<string, DirectoryVersion>> {
  const name = DIRECTORY_TYPES[serverType];
  if (!name) throw unavailable();
  const hit = directoryCache.get(name);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.versions;
  let data: { success?: boolean; builds?: Record<string, DirectoryVersion> };
  try {
    const res = await fetch(`${env.MCJARS_API_URL.replace(/\/$/, '')}/builds/${name}`, { headers: { Accept: 'application/json', 'User-Agent': 'server-software-installer/1' }, signal: AbortSignal.timeout(20_000), redirect: 'error' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as typeof data;
  } catch {
    // Lieber einen etwas älteren Stand als gar keinen
    if (hit) return hit.versions;
    throw unavailable();
  }
  if (!data.success || !data.builds || typeof data.builds !== 'object') {
    if (hit) return hit.versions;
    throw unavailable();
  }
  directoryCache.set(name, { at: Date.now(), versions: data.builds });
  return data.builds;
}

/** Dateiname bzw. Ort innerhalb des Servers: nur einfache, relative Angaben */
const fileOk = (v: unknown): v is string => typeof v === 'string' && /^[\w.+-]{1,160}$/.test(v) && !v.startsWith('.');
const locationOk = (v: unknown): v is string => typeof v === 'string' && (v === '.' || (/^[\w.+-]{1,80}(?:\/[\w.+-]{1,80}){0,5}$/.test(v) && !v.split('/').some((part) => part.startsWith('.'))));
const urlOk = (v: unknown): v is string => {
  if (typeof v !== 'string' || v.length > 600) return false;
  try {
    const url = new URL(v);
    // Im Betrieb nur https; für Tests gegen einen lokalen Nachbau des Verzeichnisses auch http
    return url.protocol === 'https:' || (url.protocol === 'http:' && env.MCJARS_API_URL.startsWith('http://'));
  } catch {
    return false;
  }
};

/** Schritte aus dem Verzeichnis prüfen und in eine einfache Reihenfolge bringen. Unbekanntes wird nie ausgeführt. */
function stepsFrom(installation: unknown): SoftwareStep[] | null {
  if (!Array.isArray(installation)) return null;
  const out: SoftwareStep[] = [];
  for (const group of installation) {
    if (!Array.isArray(group)) return null;
    // Innerhalb einer Gruppe zuerst aufräumen, dann laden/entpacken
    const sorted = [...group].sort((a, b) => Number((b as { type?: string }).type === 'remove') - Number((a as { type?: string }).type === 'remove'));
    for (const raw of sorted) {
      const s = raw as { type?: string; url?: unknown; file?: unknown; size?: unknown; location?: unknown };
      if (s.type === 'download' && urlOk(s.url) && fileOk(s.file)) out.push({ type: 'download', url: s.url, file: s.file, size: typeof s.size === 'number' && s.size > 0 ? s.size : null });
      else if (s.type === 'unzip' && fileOk(s.file) && locationOk(s.location)) out.push({ type: 'unzip', file: s.file, location: s.location });
      else if (s.type === 'remove' && locationOk(s.location) && s.location !== '.') out.push({ type: 'remove', location: s.location });
      else return null;
    }
  }
  return out.length > 0 && out.length <= 40 && out.some((s) => s.type === 'download') ? out : null;
}

export interface ResolvedSoftware {
  serverType: string;
  version: string;
  resolvedVersion: string;
  build: string;
  java: number | null;
  steps: SoftwareStep[];
}

/** Typ und Version im Verzeichnis nachschlagen. „latest“ = neueste veröffentlichte Version. */
export async function resolveSoftware(serverType: string, version: string): Promise<ResolvedSoftware> {
  const versions = await directory(serverType);
  let resolved = version;
  if (version === 'latest') {
    const releases = Object.entries(versions).filter(([, v]) => v.type === 'RELEASE' && v.supported !== false && v.latest);
    resolved = releases[releases.length - 1]?.[0] ?? '';
  }
  const entry = versions[resolved];
  const steps = entry?.latest ? stepsFrom(entry.latest.installation) : null;
  if (!entry?.latest || !steps) {
    const msg = L('Diese Version ist für den Servertyp gerade nicht verfügbar.', 'This version is currently not available for the selected server type.');
    throw Errors.badRequest('version_unavailable', msg, { version: msg });
  }
  const build = [entry.latest.projectVersionId, entry.latest.name].filter((v, i, all) => v && all.indexOf(v) === i).join(' ');
  return { serverType, version, resolvedVersion: resolved, build: build.slice(0, 80), java: typeof entry.java === 'number' ? entry.java : null, steps };
}

export const newSoftwareJob = (software: ResolvedSoftware, waitInstall: boolean): SoftwareJob => ({
  serverType: software.serverType,
  version: software.version,
  resolvedVersion: software.resolvedVersion,
  build: software.build,
  java: software.java,
  steps: software.steps,
  pos: 0,
  waitInstall,
  prepared: false,
  pullStartedAt: null,
  pullSize: 0,
  pullStable: 0,
  attempts: 0,
  startedAt: Date.now(),
  error: null,
});

/** Passendes Java-Image aus den Images des Eggs: genau die benötigte Version, sonst die nächsthöhere */
export function pickJavaImage(images: Record<string, string>, java: number | null): string | null {
  if (!java) return null;
  const known = Object.entries(images)
    .map(([name, image]) => ({ image, version: Number(/java[ _-]?(\d{1,2})/i.exec(image)?.[1] ?? /java[ _-]?(\d{1,2})/i.exec(name)?.[1] ?? NaN) }))
    .filter((e) => Number.isFinite(e.version))
    .sort((a, b) => a.version - b.version);
  return (known.find((e) => e.version === java) ?? known.find((e) => e.version > java))?.image ?? null;
}

/* ------------------------------------------------------------ Ausführung (Hintergrund-Job) */

const PULL_TIMEOUT_MS = 15 * 60_000;
const UNZIP_TIMEOUT_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

/** Fortschritt für die API-Antwort */
export function softwareProgress(ps: Pick<PartnerServer, 'softwareJob'>): { status: 'installing' | 'failed'; serverType: string; version: string; build: string; step: number; steps: number; error: string | null } | null {
  const job = ps.softwareJob;
  if (!job) return null;
  return { status: job.error ? 'failed' : 'installing', serverType: job.serverType, version: job.resolvedVersion, build: job.build, step: Math.min(job.pos + 1, job.steps.length), steps: job.steps.length, error: job.error };
}

async function advance(server: Server, ps: PartnerServer, now: Date): Promise<'done' | 'failed' | 'waiting'> {
  const job = { ...ps.softwareJob! };
  const save = () => db.update(partnerServers).set({ softwareJob: job }).where(eq(partnerServers.serverId, server.id));
  const fail = async (message: string) => {
    job.error = message.slice(0, 240);
    await save();
    await audit({ userId: server.userId, serverId: server.id, actor: 'system', action: 'partner.software_failed', message: `Server-Software für „${server.name}“ konnte nicht eingerichtet werden (${job.serverType} ${job.resolvedVersion}): ${job.error}` });
    await emitPartnerEvent(ps.partnerId, 'server.install_failed', { serverId: server.id, name: server.name, playerId: ps.playerId, serverType: job.serverType, version: job.resolvedVersion, error: job.error }).catch(() => {});
    return 'failed' as const;
  };
  if (server.status !== 'active' || !server.pteroIdentifier || !server.pteroServerId) return 'waiting'; // wird noch im Panel angelegt
  const identifier = server.pteroIdentifier;
  const ptero = pterodactyl();
  try {
    if (job.waitInstall) {
      const p = await ptero.getServer(server.pteroServerId);
      if (p?.status === 'installing') return 'waiting';
      if (p?.status === 'install_failed') return fail('Die Grundinstallation im Panel ist fehlgeschlagen.');
      job.waitInstall = false;
      await save();
    }
    if (!job.prepared) {
      // Startbefehl des Grund-Eggs, passende Java-Version, Startdatei „server.jar“ – Ressourcen bleiben unverändert
      const base = await startupFor(BASE_SERVER_TYPE, 'latest', await getSettings());
      const environment = { ...base.environment };
      if ('SERVER_JARFILE' in environment) environment.SERVER_JARFILE = 'server.jar';
      await ptero.updateServerStartup(server.pteroServerId, { eggId: base.eggId, dockerImage: pickJavaImage(base.dockerImages, job.java) ?? base.dockerImage, startup: base.startup, environment });
      job.prepared = true;
      await save();
    }
    while (job.pos < job.steps.length) {
      const step = job.steps[job.pos]!;
      if (step.type === 'download') {
        if (!job.pullStartedAt) {
          // Eine alte Datei gleichen Namens würde den Größenvergleich unten täuschen
          await ptero.deleteFiles(identifier, '/', [step.file]).catch(() => {});
          await ptero.pullFile(identifier, step.url, '/', step.file, true);
          job.pullStartedAt = now.getTime();
          job.pullSize = 0;
          job.pullStable = 0;
          await save();
          return 'waiting';
        }
        const size = (await ptero.listFiles(identifier, '/')).find((f) => !f.directory && f.name === step.file)?.size ?? 0;
        job.pullStable = size > 0 && size === job.pullSize ? job.pullStable + 1 : 0;
        job.pullSize = size;
        // Fertig, wenn die erwartete Größe erreicht ist – oder (Größe unbekannt/abweichend) die Datei längere Zeit nicht mehr wächst
        const complete = size > 0 && (step.size ? size === step.size || job.pullStable >= 8 : job.pullStable >= 3);
        if (!complete) {
          const waited = now.getTime() - job.pullStartedAt;
          if (waited > PULL_TIMEOUT_MS || (size === 0 && waited > 3 * 60_000)) return fail(`Der Download von „${step.file}“ ist nicht angekommen.`);
          await save();
          return 'waiting';
        }
        job.pullStartedAt = null;
      } else if (step.type === 'unzip') {
        await ptero.decompressFile(identifier, step.location === '.' ? '/' : `/${step.location}`, step.file, UNZIP_TIMEOUT_MS);
      } else {
        await ptero.deleteFiles(identifier, '/', [step.location]).catch(() => {});
      }
      job.pos++;
      job.attempts = 0;
      await save();
    }
  } catch (err) {
    job.attempts++;
    if (job.attempts >= MAX_ATTEMPTS) return fail(`Schritt ${job.pos + 1} von ${job.steps.length} ist fehlgeschlagen: ${String((err as Error).message ?? err)}`);
    await save();
    return 'waiting';
  }
  // Fertig: Der Server gilt wieder als installiert (das Ereignis „server.installed“ folgt im Sitzungs-Job)
  await db.update(partnerServers).set({ softwareJob: null, installedNotified: false }).where(eq(partnerServers.serverId, server.id));
  // Die tatsächlich installierte Version eintragen („latest“ wird zur konkreten Version) – der Launcher braucht sie,
  // um mit dem passenden Spiel zu verbinden, und die Mod-Suche ebenso
  await db.update(servers).set({ version: job.resolvedVersion, serverType: job.serverType }).where(eq(servers.id, server.id));
  await audit({ userId: server.userId, serverId: server.id, actor: 'system', action: 'partner.software_installed', message: `Server-Software für „${server.name}“ eingerichtet: ${job.serverType} ${job.resolvedVersion} (${job.build})${job.java ? `, Java ${job.java}` : ''}` });
  return 'done';
}

/** Läuft alle paar Sekunden: bringt offene Einrichtungen einen Schritt weiter */
export async function runSoftwareJobs(now = new Date()) {
  const stats = { open: 0, done: 0, failed: 0, waiting: 0 };
  const rows = await db
    .select({ ps: partnerServers, server: servers, enabled: partners.enabled })
    .from(partnerServers)
    .innerJoin(servers, eq(servers.id, partnerServers.serverId))
    .innerJoin(partners, eq(partners.id, partnerServers.partnerId))
    .where(sql`${partnerServers.softwareJob} is not null`)
    .limit(200);
  const open = rows.filter((r) => r.ps.softwareJob && !r.ps.softwareJob.error);
  stats.open = open.length;
  await mapLimit(open, 4, async ({ ps, server }) => {
    if (server.status === 'deleted') {
      await db.update(partnerServers).set({ softwareJob: null }).where(eq(partnerServers.serverId, server.id));
      return;
    }
    stats[await advance(server, ps, now)]++;
  });
  return stats;
}
