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
import { and, count, eq, inArray, ne, sql } from 'drizzle-orm';
import { DIRECTORY_NOT_GAME_SERVERS, builtinServerTypes, getServerType, type ServerTypeConfig } from '@chfree/shared';
import { affectedRows, db } from '../db/client';
import { partnerServers, partners, servers, type PartnerServer, type Server, type SoftwareJob, type SoftwareStep } from '../db/schema';
import { env } from '../env';
import { baseEggMapping, installMethodOf } from '../config/pterodactyl.config';
import { ApiError, Errors, L } from '../lib/errors';
import { mapLimit } from '../jobs/types';
import { pterodactyl } from '../pterodactyl';
import { audit } from './audit.service';
import { emitPartnerEvent } from './partner-webhooks.service';
import { notify } from './notification.service';
import { baseStartup, getEggCached } from './provisioning.service';
import { pendingSoftwareJob, softwareDirectory } from './software-directory';
import { getSettings } from './settings.service';
import type { SiteSettings } from '@chfree/shared';

/** Wird dieser Typ über das Verzeichnis eingerichtet (statt über ein eigenes Egg)? */
export const installsViaDirectory = (serverType: string, settings: Pick<SiteSettings, 'products' | 'softwareBase'>): boolean => installMethodOf(serverType, settings) === 'directory';

/**
 * Feste Regel, unabhängig von allen Einstellungen: Über die Partner-API gibt es ausschließlich Java-Spielserver.
 * Bedrock (Bedrock, PocketMine-MP, Nukkit …), Proxys (Velocity, BungeeCord, Waterfall …) und alles, was nur über ein
 * eigenes Egg läuft, kann ein Partner weder erstellen noch per Typwechsel erreichen – auch dann nicht, wenn der
 * Katalog durch einen Fehler oder von Hand etwas anderes sagt.
 */
export function partnerTypeAllowed(type: ServerTypeConfig | undefined): type is ServerTypeConfig {
  if (!type || type.kind !== 'minecraft') return false;
  if (type.edition === 'bedrock' || type.eggOnly) return false;
  if (!type.directory || DIRECTORY_NOT_GAME_SERVERS.includes(type.directory.toUpperCase())) return false;
  // Die mitgelieferten Bedrock- und Proxy-Einträge zusätzlich über ihre Kennung – unabhängig davon, was zur Laufzeit im Katalog steht
  const builtin = builtinServerTypes.find((b) => b.id === type.id);
  return !(builtin && (builtin.eggOnly || builtin.edition === 'bedrock'));
}

/** Steht der Typ für Partner zur Verfügung? (Java-Spielserver, im Software-Katalog freigegeben, installierbar) */
export function partnerTypeAvailable(serverType: string, settings: SiteSettings): boolean {
  const type = getServerType(serverType);
  if (!partnerTypeAllowed(type) || !type.partner) return false;
  return installMethodOf(serverType, settings) !== null;
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
  const versions = await softwareDirectory(serverType);
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

/* ------------------------------------------------------------ Einrichtung direkt im Panel (Schnellinstallation) */

/**
 * Variable des mitgelieferten Eggs (docs/eggs/craftinghosting-software.json): Hat die Grundlage sie, installiert das Panel
 * die gewählte Software selbst – in einem Durchgang beim Anlegen bzw. Neuinstallieren, ohne Umweg über ein anderes Egg und
 * ohne nachgelagerten Job. Der Server ist damit so schnell bereit wie mit einem eigenen Egg.
 */
export const INSTALLER_VARIABLE = 'SOFTWARE_STEPS';
/** Variable des Eggs, mit der das Installationsskript die Minecraft-EULA akzeptiert (nur, wenn der Kunde zugestimmt hat) */
export const INSTALLER_EULA_VARIABLE = 'EULA';

/** Schritte für das Installationsskript: eine Zeile je Schritt („art|wert|wert“), Base64 – so kann nichts als Shell gedeutet werden */
export function encodeSteps(steps: SoftwareStep[]): string {
  const safe = (v: string) => {
    if (/[|\s]/.test(v)) throw new Error(`Ungültiges Zeichen in einem Installationsschritt: ${v.slice(0, 80)}`);
    return v;
  };
  const lines = steps.map((s) =>
    s.type === 'download' ? `download|${safe(s.url)}|${safe(s.file)}` : s.type === 'unzip' ? `unzip|${safe(s.file)}|${safe(s.location)}` : `remove|${safe(s.location)}|`,
  );
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8').toString('base64');
}

/** Ist die Grundlage das mitgelieferte Egg (mit Installationsskript für das Verzeichnis)? */
export async function installerReady(settings: SiteSettings): Promise<boolean> {
  const egg = baseEggMapping(settings);
  if (!egg) return false;
  try {
    return (await getEggCached(egg.nestId, egg.eggId)).variables.some((v) => v.envVariable === INSTALLER_VARIABLE);
  } catch {
    return false;
  }
}

/**
 * Egg, Image, Startbefehl und Variablen, mit denen das Panel die Software selbst installiert. Java-Version passend zur
 * Minecraft-Version aus den Images der Grundlage. Wirft, wenn es kein passendes Image gibt.
 */
export async function installerStartup(software: ResolvedSoftware, settings: SiteSettings, opts: { eula: boolean }): Promise<{ eggId: number; dockerImage: string; startup: string; environment: Record<string, string> }> {
  const egg = baseEggMapping(settings);
  if (!egg) throw new Error('Für die Software-Einrichtung ist keine Grundlage (Egg) eingerichtet (Admin → Einstellungen → Server-Software)');
  const eggInfo = await getEggCached(egg.nestId, egg.eggId);
  const image = pickJavaImage(eggInfo.dockerImages ?? {}, software.java);
  if (image === false) {
    const msg = L(`Für diese Version wird Java ${software.java} gebraucht – dafür ist kein passendes Image eingerichtet.`, `This version needs Java ${software.java} – no matching image is set up for it.`);
    throw Errors.badRequest('version_unavailable', msg, { version: msg });
  }
  const environment: Record<string, string> = {};
  for (const v of eggInfo.variables) environment[v.envVariable] = v.defaultValue;
  Object.assign(environment, egg.environment ?? {});
  for (const name of ['SERVER_JARFILE', 'JARFILE', 'JAR_FILE']) if (name in environment) environment[name] = 'server.jar';
  environment[INSTALLER_VARIABLE] = encodeSteps(software.steps);
  if (eggInfo.variables.some((v) => v.envVariable === INSTALLER_EULA_VARIABLE)) environment[INSTALLER_EULA_VARIABLE] = opts.eula ? 'TRUE' : 'FALSE';
  return { eggId: egg.eggId, dockerImage: image ?? egg.dockerImage ?? eggInfo.dockerImage, startup: eggInfo.startup, environment };
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

/**
 * Passendes Java-Image aus den Images des Eggs: genau die benötigte Version, sonst die nächsthöhere.
 * Rückgabe: das Image, `null` = nichts zu ändern (Java-Version oder Images unbekannt), `false` = das Egg kennt
 * Java-Images, aber keines reicht für diese Minecraft-Version aus.
 */
export function pickJavaImage(images: Record<string, string>, java: number | null): string | null | false {
  if (!java) return null;
  const known = Object.entries(images)
    .map(([name, image]) => ({ image, version: Number(/java[ _-]?(\d{1,2})/i.exec(image)?.[1] ?? /java[ _-]?(\d{1,2})/i.exec(name)?.[1] ?? NaN) }))
    .filter((e) => Number.isFinite(e.version))
    .sort((a, b) => a.version - b.version);
  if (known.length === 0) return null;
  return (known.find((e) => e.version === java) ?? known.find((e) => e.version > java))?.image ?? false;
}

/** Höchstzahl gleichzeitig offener Einrichtungen je Partner (jede kostet regelmäßige Panel-Abfragen) */
export const MAX_OPEN_INSTALLS = 10;

/** Vor dem Anlegen einer neuen Einrichtung: Hat der Partner schon zu viele offene? */
export async function assertInstallSlot(partnerId: string, exceptServerId?: string): Promise<void> {
  const [open] = await db
    .select({ n: count() })
    .from(partnerServers)
    .innerJoin(servers, eq(servers.id, partnerServers.serverId))
    .where(and(eq(partnerServers.partnerId, partnerId), ne(servers.status, 'deleted'), ne(servers.status, 'suspended'), sql`${partnerServers.softwareJob} is not null`, sql`json_extract(${partnerServers.softwareJob}, '$.error') is null`, ...(exceptServerId ? [ne(partnerServers.serverId, exceptServerId)] : [])));
  if (Number(open?.n ?? 0) >= MAX_OPEN_INSTALLS) {
    throw new ApiError(429, 'too_many_installs', L(`Es werden gerade schon ${MAX_OPEN_INSTALLS} Server eingerichtet. Bitte warten, bis einer fertig ist.`, `${MAX_OPEN_INSTALLS} servers are already being set up. Please wait until one has finished.`), { retryAfterSeconds: '30' });
  }
}

/* ------------------------------------------------------------ Ausführung (Hintergrund-Job) */

const PULL_TIMEOUT_MS = 15 * 60_000;
const UNZIP_TIMEOUT_MS = 5 * 60_000;
const MAX_ATTEMPTS = 8;
/** Gesamtfrist einer Einrichtung (inklusive der Grundinstallation im Panel) – Zeit, in der der Server gesperrt ist, zählt nicht */
const JOB_DEADLINE_MS = 60 * 60_000;
/** So lange darf ein im Panel gestarteter Server nach der Stopp-Aufforderung herunterfahren, bevor er beendet wird */
const STOP_GRACE_MS = 60_000;
/**
 * Startbefehl während der Einrichtung: Wer den Server in der Zeit im Panel startet, bekommt nur diesen Hinweis in der
 * Konsole, und der Prozess endet sofort wieder. So läuft nie eine halb eingerichtete Software (oder die der Grundlage),
 * und wir müssen niemandem den Server unter den Füßen wegziehen. Bewusst ohne Zeichen, die eine Shell deuten würde.
 */
export const SETUP_STARTUP =
  'echo Die Server-Software wird gerade eingerichtet. Bitte warte ein paar Minuten und starte den Server dann erneut. / The server software is being set up. Please wait a few minutes, then start the server again.';
/** Je Lauf höchstens so viele Einrichtungen anfassen – begrenzt die Panel-Aufrufe unabhängig von der Zahl offener Aufträge */
const PER_RUN = 20;

/** Abstand bis zur nächsten Abfrage: 5 s, 10 s, 20 s, dann 30 s */
const pollDelay = (polls: number) => Math.min(30_000, 5_000 * 2 ** Math.min(polls, 3));

/** Fortschritt für die API-Antwort */
export function softwareProgress(ps: Pick<PartnerServer, 'softwareJob'>): { status: 'installing' | 'failed'; serverType: string; version: string; build: string; step: number; steps: number; error: string | null } | null {
  const job = ps.softwareJob;
  if (!job) return null;
  return { status: job.error ? 'failed' : 'installing', serverType: job.serverType, version: job.resolvedVersion, build: job.build, step: Math.min(job.pos + 1, job.steps.length), steps: job.steps.length, error: job.error };
}

/** Wo ein Auftrag gespeichert ist: bei Servern der Partner-API in partner_servers, bei Servern der Website in servers */
interface JobStore {
  job: SoftwareJob;
  /** Speichern, solange es noch derselbe Auftrag ist (false = inzwischen ersetzt oder entfernt) */
  save(job: SoftwareJob): Promise<boolean>;
  /** Auftrag als erledigt entfernen */
  finish(): Promise<boolean>;
  /** Nach einem Fehlschlag (z. B. Webhook an den Partner) */
  failed(job: SoftwareJob): Promise<void>;
}

async function advance(server: Server, store: JobStore, now: Date): Promise<'done' | 'failed' | 'waiting'> {
  const job = { ...store.job };
  class Replaced extends Error {}
  const save = async () => {
    if (!(await store.save(job))) throw new Replaced();
  };
  /** Später erneut nachsehen – mit wachsendem Abstand */
  const wait = async () => {
    job.polls = (job.polls ?? 0) + 1;
    job.nextPollAt = now.getTime() + pollDelay(job.polls);
    await save();
    return 'waiting' as const;
  };
  /**
   * `detail` (z. B. die Meldung des Panels) steht nur in unserem Protokoll, nicht in der Antwort an den Partner.
   * `permanent`: Ein neuer Versuch würde genauso enden – dann wird (bei Servern der Website) nicht automatisch wiederholt.
   */
  const fail = async (message: string, detail?: string, permanent = false) => {
    job.error = message.slice(0, 240);
    job.failedAt = now.getTime();
    if (permanent) job.permanent = true;
    await save();
    await audit({ userId: server.userId, serverId: server.id, actor: 'system', action: 'partner.software_failed', message: `Server-Software für „${server.name}“ konnte nicht eingerichtet werden (${job.serverType} ${job.resolvedVersion}): ${job.error}${detail ? ` – ${detail.slice(0, 300)}` : ''}` });
    await store.failed(job).catch(() => {});
    return 'failed' as const;
  };
  try {
    if (server.status === 'provisioning_failed') return await fail('Der Server konnte im Panel nicht angelegt werden.', undefined, true);
    const deadline = job.deadlineAt ?? job.startedAt + JOB_DEADLINE_MS;
    if (server.status !== 'active' || !server.pteroIdentifier || !server.pteroServerId) {
      // Wird noch im Panel angelegt oder ist gesperrt (z. B. Auszeit): Die Zeit zählt nicht gegen die Frist
      job.deadlineAt = Math.max(deadline, now.getTime() + JOB_DEADLINE_MS);
      return await wait();
    }
    if (now.getTime() > deadline) return await fail('Die Einrichtung hat zu lange gedauert.');
    // Typ inzwischen entfernt oder über ein eigenes Egg eingestellt: hier gibt es nichts mehr einzurichten
    if (!installsViaDirectory(job.serverType, await getSettings())) return await fail('Diese Server-Software wird nicht mehr über das Verzeichnis eingerichtet.', undefined, true);
    const identifier = server.pteroIdentifier;
    const ptero = pterodactyl();
    try {
      if (job.steps.length === 0) {
        // Schritte noch nicht nachgeschlagen (Server der Website)
        let software: ResolvedSoftware;
        try {
          software = await resolveSoftware(job.serverType, job.version);
        } catch (err) {
          if (err instanceof ApiError && err.code === 'version_unavailable') return await fail('Diese Version gibt es für die gewählte Server-Software nicht.', undefined, true);
          return await wait(); // Verzeichnis gerade nicht erreichbar
        }
        Object.assign(job, { resolvedVersion: software.resolvedVersion, build: software.build, java: software.java, steps: software.steps, polls: 0 });
        await save();
      }
      if (job.waitInstall) {
        const p = await ptero.getServer(server.pteroServerId);
        if (p?.status === 'installing' || p?.status === 'restoring_backup') return await wait();
        if (p?.status === 'install_failed') {
          // Einmal von selbst neu anstoßen (z. B. Download im Installationsskript kurz nicht erreichbar)
          if (job.reinstalled) return await fail('Die Grundinstallation im Panel ist fehlgeschlagen.');
          await ptero.reinstallServer(server.pteroServerId);
          job.reinstalled = true;
          job.polls = 0;
          return await wait();
        }
        job.waitInstall = false;
        job.polls = 0;
        await save();
      }
      // Läuft der Server (im Panel gestartet), zuerst anhalten – vor jedem Schritt, nicht nur am Anfang. Erst freundlich
      // („stop“, die Welt wird gespeichert), nach einer Wartezeit hart. Solange er läuft, wird nichts verändert.
      const state = (await ptero.getResources(identifier)).state;
      if (state === 'installing') {
        // Mitten in der Einrichtung im Panel neu installiert (oder Backup/Umzug): Das Installationsskript der Grundlage
        // überschreibt ggf. schon geladene Dateien – deshalb abwarten und danach von vorn beginnen
        Object.assign(job, { waitInstall: true, pos: 0, pullStartedAt: null, pullSize: 0, pullStable: 0, prepared: false, finalized: false, polls: 0 });
        return await wait();
      }
      if (state === 'running' || state === 'starting' || state === 'stopping') {
        if (!job.stopSentAt) {
          job.stopSentAt = now.getTime();
          await ptero.sendPowerSignal(identifier, 'stop').catch(() => {});
        } else if (now.getTime() - job.stopSentAt > STOP_GRACE_MS) {
          await ptero.sendPowerSignal(identifier, 'kill').catch(() => {});
        }
        return await wait();
      }
      if (job.stopSentAt) job.stopSentAt = null;
      if (!job.prepared) {
        // Grund-Egg und passende Java-Version setzen – als Startbefehl vorerst nur der Hinweis „wird eingerichtet“
        const { image, base, environment } = await startupFor(job);
        if (image === false) return await fail(`Für diese Version wird Java ${job.java} gebraucht – dafür ist kein passendes Image eingerichtet.`, `Images des Eggs: ${Object.keys(base.dockerImages).join(', ')}`, true);
        await ptero.updateServerStartup(server.pteroServerId, { eggId: base.eggId, dockerImage: image ?? base.dockerImage, startup: SETUP_STARTUP, environment });
        job.prepared = true;
        job.finalized = false;
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
            job.polls = 0;
            return await wait();
          }
          const size = (await ptero.listFiles(identifier, '/')).find((f) => !f.directory && f.name === step.file)?.size ?? 0;
          job.pullStable = size > 0 && size === job.pullSize ? job.pullStable + 1 : 0;
          job.pullSize = size;
          // Fertig, wenn die erwartete Größe erreicht ist. Ohne bekannte Größe: wenn die Datei längere Zeit nicht mehr wächst.
          const complete = size > 0 && (step.size ? size === step.size : job.pullStable >= 2);
          if (!complete && step.size && size > 0 && job.pullStable >= 4) {
            // Bleibt bei einer anderen als der erwarteten Größe stehen: abgebrochener Download – neu laden (zählt als Versuch)
            job.pullStartedAt = null;
            job.attempts++;
            if (job.attempts >= MAX_ATTEMPTS) return await fail(`Der Download von „${step.file}“ ist unvollständig angekommen.`);
            return await wait();
          }
          if (!complete) {
            const waited = now.getTime() - job.pullStartedAt;
            if (waited > PULL_TIMEOUT_MS || (size === 0 && waited > 3 * 60_000)) return await fail(`Der Download von „${step.file}“ ist nicht angekommen.`);
            return await wait();
          }
          job.pullStartedAt = null;
        } else if (step.type === 'unzip') {
          await ptero.decompressFile(identifier, step.location === '.' ? '/' : `/${step.location}`, step.file, UNZIP_TIMEOUT_MS);
        } else {
          await ptero.deleteFiles(identifier, '/', [step.location]).catch(() => {});
        }
        job.pos++;
        job.attempts = 0;
        job.polls = 0;
        await save();
      }
      if (job.finalized !== true) {
        // Alles da: jetzt erst den richtigen Startbefehl setzen – ab hier startet die gewählte Software
        const { image, base, environment } = await startupFor(job);
        if (image === false) return await fail(`Für diese Version wird Java ${job.java} gebraucht – dafür ist kein passendes Image eingerichtet.`, `Images des Eggs: ${Object.keys(base.dockerImages).join(', ')}`, true);
        await ptero.updateServerStartup(server.pteroServerId, { eggId: base.eggId, dockerImage: image ?? base.dockerImage, startup: base.startup, environment });
        job.finalized = true;
        await save();
      }
    } catch (err) {
      if (err instanceof Replaced) throw err;
      job.attempts++;
      if (job.attempts >= MAX_ATTEMPTS) return await fail(`Schritt ${job.pos + 1} von ${job.steps.length} ist fehlgeschlagen. Bitte später erneut versuchen.`, String((err as Error).message ?? err));
      return await wait();
    }
    // Fertig: Der Server gilt wieder als installiert (das Ereignis „server.installed“ folgt im Sitzungs-Job)
    if (!(await store.finish())) return 'waiting';
    // Die tatsächlich installierte Version eintragen („latest“ wird zur konkreten Version) – der Launcher braucht sie,
    // um mit dem passenden Spiel zu verbinden, und die Mod-Suche ebenso
    await db.update(servers).set({ version: job.resolvedVersion, serverType: job.serverType }).where(eq(servers.id, server.id));
    // Der gemerkte Zustand steht evtl. noch auf „installing“ (der Abgleich läuft nur jede Minute) – der Server ist jetzt fertig und aus
    await db.update(servers).set({ powerState: 'offline', powerStateAt: now }).where(and(eq(servers.id, server.id), eq(servers.powerState, 'installing')));
    await audit({ userId: server.userId, serverId: server.id, actor: 'system', action: 'partner.software_installed', message: `Server-Software für „${server.name}“ eingerichtet: ${job.serverType} ${job.resolvedVersion} (${job.build})${job.java ? `, Java ${job.java}` : ''}` });
    return 'done';
  } catch (err) {
    if (err instanceof Replaced) return 'waiting'; // inzwischen ersetzt oder entfernt – der neue Auftrag läuft für sich
    throw err;
  }
}

/** Grund-Egg, Java-Image passend zur Version und Umgebung (Startdatei „server.jar“) – Ressourcen bleiben unverändert */
async function startupFor(job: SoftwareJob) {
  const base = await baseStartup(await getSettings());
  const image = pickJavaImage(base.dockerImages, job.java);
  const environment = { ...base.environment };
  // Die Software aus dem Verzeichnis heißt immer „server.jar“ (die Variable heißt je nach Egg unterschiedlich)
  for (const name of ['SERVER_JARFILE', 'JARFILE', 'JAR_FILE']) if (name in environment) environment[name] = 'server.jar';
  // Ist die Grundlage inzwischen das mitgelieferte Egg: Schritte mitgeben, damit eine spätere Neuinstallation im Panel
  // dieselbe Software aufspielt (sonst liefe das Installationsskript ohne Angaben)
  if (INSTALLER_VARIABLE in environment) environment[INSTALLER_VARIABLE] = encodeSteps(job.steps);
  return { base, image, environment };
}

const sameJob = (column: typeof partnerServers.softwareJob | typeof servers.softwareJob, job: SoftwareJob) => sql`json_extract(${column}, '$.startedAt') = ${job.startedAt}`;

function partnerStore(server: Server, ps: PartnerServer): JobStore {
  const mine = and(eq(partnerServers.serverId, server.id), sameJob(partnerServers.softwareJob, ps.softwareJob!));
  return {
    job: ps.softwareJob!,
    save: async (job) => affectedRows(await db.update(partnerServers).set({ softwareJob: job }).where(mine)) === 1,
    finish: async () => affectedRows(await db.update(partnerServers).set({ softwareJob: null, installedNotified: false }).where(mine)) === 1,
    failed: (job) => emitPartnerEvent(ps.partnerId, 'server.install_failed', { serverId: server.id, name: server.name, playerId: ps.playerId, serverType: job.serverType, version: job.resolvedVersion, error: job.error }),
  };
}

/** Wie oft und in welchem Abstand eine fehlgeschlagene Einrichtung eines Website-Servers von selbst neu versucht wird */
export const SITE_RETRIES = 5;
const SITE_RETRY_AFTER_MS = 15 * 60_000;

/** Wird nicht mehr von selbst neu versucht (alle Versuche verbraucht oder ein Fehler, den ein Versuch nicht behebt) */
export const softwareGaveUp = (job: SoftwareJob | null | undefined): boolean => !!job?.error && (!!job.permanent || (job.retries ?? 0) >= SITE_RETRIES);

function siteStore(server: Server): JobStore {
  const mine = and(eq(servers.id, server.id), sameJob(servers.softwareJob, server.softwareJob!));
  return {
    job: server.softwareJob!,
    save: async (job) => affectedRows(await db.update(servers).set({ softwareJob: job }).where(mine)) === 1,
    finish: async () => affectedRows(await db.update(servers).set({ softwareJob: null }).where(mine)) === 1,
    failed: async (job) => {
      if (!softwareGaveUp(job)) return; // wird automatisch erneut versucht – erst Bescheid geben, wenn das nichts mehr bringt
      await notify({
        userId: server.userId,
        serverId: server.id,
        type: 'server.software_failed',
        title: L('Server-Software konnte nicht eingerichtet werden', 'Server software could not be set up'),
        body: L(
          `Für „${server.name}“ konnte die gewählte Software (${job.serverType} ${job.version}) nicht eingerichtet werden. Bitte öffne ein Ticket auf unserem Discord-Server – wir kümmern uns darum.`,
          `The selected software (${job.serverType} ${job.version}) could not be set up for “${server.name}”. Please open a ticket on our Discord server – we will take care of it.`,
        ),
        dedupeKey: `software-failed:${server.id}:${job.startedAt}`,
        email: true,
      });
    },
  };
}

/**
 * Einrichtung der Software eines Website-Servers (neu) anstoßen – z. B. vom Team nach einem Fehlschlag oder nach einer
 * Neuinstallation im Panel. Wartet zuerst auf das Panel (läuft dort gerade eine Installation oder ist sie fehlgeschlagen,
 * wird das berücksichtigt). `onlyIfNone`: nur, wenn gerade kein Auftrag besteht.
 */
export async function requestSiteSoftware(server: Pick<Server, 'id' | 'serverType' | 'version' | 'partnerId'>, opts: { onlyIfNone?: boolean } = {}): Promise<boolean> {
  if (server.partnerId || !installsViaDirectory(server.serverType, await getSettings())) return false;
  const res = await db
    .update(servers)
    .set({ softwareJob: pendingSoftwareJob(server.serverType, server.version, true) })
    .where(and(eq(servers.id, server.id), ...(opts.onlyIfNone ? [sql`${servers.softwareJob} is null`] : [])));
  return affectedRows(res) === 1;
}

/** Läuft alle paar Sekunden: bringt offene Einrichtungen einen Schritt weiter */
export async function runSoftwareJobs(now = new Date()) {
  const stats = { open: 0, done: 0, failed: 0, waiting: 0 };
  // Aufträge gelöschter Server entfernen (egal, auf welchem Weg gelöscht wurde)
  await db
    .update(partnerServers)
    .set({ softwareJob: null })
    .where(and(sql`${partnerServers.softwareJob} is not null`, inArray(partnerServers.serverId, db.select({ id: servers.id }).from(servers).where(eq(servers.status, 'deleted')))));
  // Nur offene Aufträge (fehlgeschlagene belegen kein Fenster), die fällig sind – die am längsten wartenden zuerst
  const due = await db
    .select({ ps: partnerServers, server: servers, enabled: partners.enabled })
    .from(partnerServers)
    .innerJoin(servers, eq(servers.id, partnerServers.serverId))
    .innerJoin(partners, eq(partners.id, partnerServers.partnerId))
    .where(
      and(
        sql`${partnerServers.softwareJob} is not null`,
        sql`json_extract(${partnerServers.softwareJob}, '$.error') is null`,
        sql`coalesce(json_extract(${partnerServers.softwareJob}, '$.nextPollAt'), 0) <= ${now.getTime()}`,
        ne(servers.status, 'deleted'),
        // Deaktivierte Partner: ruht, bis der Zugang wieder aktiv ist (keine Panel-Aufrufe)
        eq(partners.enabled, true),
      ),
    )
    .orderBy(sql`coalesce(json_extract(${partnerServers.softwareJob}, '$.nextPollAt'), 0)`, sql`json_extract(${partnerServers.softwareJob}, '$.startedAt')`)
    .limit(PER_RUN);
  // Server der Website: dieselbe Reihenfolge. Fehlgeschlagene werden einige Male von selbst neu versucht
  // (z. B. wenn das Verzeichnis oder ein Download vorübergehend nicht erreichbar war).
  await db
    .update(servers)
    .set({ softwareJob: null })
    .where(and(sql`${servers.softwareJob} is not null`, eq(servers.status, 'deleted')));
  const failedSite = await db
    .select()
    .from(servers)
    .where(
      and(
        sql`${servers.softwareJob} is not null`,
        sql`json_extract(${servers.softwareJob}, '$.error') is not null`,
        sql`coalesce(json_extract(${servers.softwareJob}, '$.permanent'), 0) = 0`,
        sql`coalesce(json_extract(${servers.softwareJob}, '$.retries'), 0) < ${SITE_RETRIES}`,
        sql`coalesce(json_extract(${servers.softwareJob}, '$.failedAt'), 0) <= ${now.getTime() - SITE_RETRY_AFTER_MS}`,
        // Gesperrte Server (Auszeit, Ablauf …) verbrauchen keine Versuche – es geht weiter, sobald sie wieder aktiv sind
        eq(servers.status, 'active'),
        sql`${servers.partnerId} is null`,
      ),
    )
    .limit(20);
  const settings = await getSettings();
  for (const server of failedSite) {
    const old = server.softwareJob!;
    if (!installsViaDirectory(old.serverType, settings)) {
      // Nicht mehr über das Verzeichnis: kein Neuversuch (und kein weiterer „wird eingerichtet“)
      await db.update(servers).set({ softwareJob: { ...old, permanent: true } }).where(and(eq(servers.id, server.id), sameJob(servers.softwareJob, old)));
      continue;
    }
    await db
      .update(servers)
      .set({ softwareJob: { ...pendingSoftwareJob(old.serverType, old.version, true), retries: (old.retries ?? 0) + 1 } })
      .where(and(eq(servers.id, server.id), sameJob(servers.softwareJob, old)));
  }
  const dueSite = await db
    .select()
    .from(servers)
    .where(and(sql`${servers.softwareJob} is not null`, sql`json_extract(${servers.softwareJob}, '$.error') is null`, sql`coalesce(json_extract(${servers.softwareJob}, '$.nextPollAt'), 0) <= ${now.getTime()}`, ne(servers.status, 'deleted'), sql`${servers.partnerId} is null`))
    .orderBy(sql`coalesce(json_extract(${servers.softwareJob}, '$.nextPollAt'), 0)`, sql`json_extract(${servers.softwareJob}, '$.startedAt')`)
    .limit(PER_RUN);
  stats.open = due.length + dueSite.length;
  await mapLimit(due, 4, async ({ ps, server }) => {
    if (!ps.softwareJob || ps.softwareJob.error) return;
    stats[await advance(server, partnerStore(server, ps), now)]++;
  });
  await mapLimit(dueSite, 4, async (server) => {
    if (!server.softwareJob || server.softwareJob.error) return;
    stats[await advance(server, siteStore(server), now)]++;
  });
  return stats;
}
