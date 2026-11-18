/**
 * Partner-API, zweiter Teil: alles, was ein Launcher ohne Panel-Zugang braucht –
 * Dateien (Mods, Plugins, Welten), Mods von Modrinth, Konsolen-Ausgabe, Servereinstellungen, Live-Werte, Umbenennen.
 */
import { and, eq } from 'drizzle-orm';
import { findPlan, freeHostingConfig, getServerType, versionsFor } from '@chfree/shared';
import { affectedRows, db } from '../db/client';
import { partnerServers, servers, type Partner, type Server } from '../db/schema';
import { env } from '../env';
import { ApiError, Errors, L } from '../lib/errors';
import { pterodactyl } from '../pterodactyl';
import { PterodactylError } from '../pterodactyl/types';
import { audit } from './audit.service';
import { confirmedState, forgetLiveState, stillInstalling, getPartnerServer, loadPartnerServer, playersOnline, type PartnerServerDTO } from './partner.service';
import { startupFor } from './provisioning.service';
import { assertInstallSlot, installsViaDirectory, newSoftwareJob, partnerTypeAvailable, resolveSoftware } from './partner-software.service';
import { getSettings } from './settings.service';

const NAME_MAX = freeHostingConfig.limits.serverNameMaxLength - 10;

/* ------------------------------------------------------------ Hilfen */

/** Server muss fertig eingerichtet sein, damit sich Dateien und Einstellungen ändern lassen */
async function ready(partner: Partner, id: string): Promise<Server & { pteroIdentifier: string }> {
  const { server, ps } = await loadPartnerServer(partner, id);
  // Während die Server-Software eingerichtet wird, bleiben die Dateien unangetastet (nach einem Fehlschlag sind sie wieder zugänglich)
  if (server.status !== 'active' || !server.pteroIdentifier || (ps.softwareJob && !ps.softwareJob.error) || (await stillInstalling(server))) {
    throw new ApiError(409, 'server_installing', L('Der Server wird noch eingerichtet. Bitte gleich noch einmal versuchen.', 'The server is still being set up. Please try again shortly.'));
  }
  return server as Server & { pteroIdentifier: string };
}

/** Pfad innerhalb des Servers: immer mit „/“ am Anfang, ohne „..“, ohne Steuerzeichen */
export function cleanPath(input: string, what = 'path'): string {
  const invalid = () => {
    const msg = L('Ungültiger Pfad.', 'Invalid path.');
    return Errors.badRequest('invalid_path', msg, { [what]: msg });
  };
  if (typeof input !== 'string' || input.length > 400 || /[\u0000-\u001f\u007f]/.test(input)) throw invalid();
  const parts = input.replace(/\\/g, '/').split('/').filter((p) => p !== '' && p !== '.');
  if (parts.length > 16 || parts.some((p) => p === '..' || p.length > 200)) throw invalid();
  return `/${parts.join('/')}`;
}
const split = (path: string) => {
  const at = path.lastIndexOf('/');
  return { root: path.slice(0, at) || '/', name: path.slice(at + 1) };
};

/** Fehler des Panels in eine verständliche Antwort übersetzen */
function panelFailure(err: unknown, notFound = L('Diese Datei gibt es nicht.', 'This file does not exist.')): never {
  if (err instanceof ApiError) throw err;
  if (err instanceof PterodactylError) {
    if (err.status === 404) throw new ApiError(404, 'file_not_found', notFound);
    if (err.status === 400 || err.status === 413 || err.status === 422) throw new ApiError(400, 'file_rejected', L(`Das hat der Server abgelehnt: ${err.message}`.slice(0, 240), `The server rejected this: ${err.message}`.slice(0, 240)));
  }
  throw Errors.unavailable(L('Der Server ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.', 'The server cannot be reached right now. Please try again shortly.'));
}

/** Server für den Konsolen-Stream (muss fertig eingerichtet sein) */
export async function consoleTarget(partner: Partner, id: string): Promise<{ id: string; pteroIdentifier: string }> {
  const server = await ready(partner, id);
  return { id: server.id, pteroIdentifier: server.pteroIdentifier };
}

/* ------------------------------------------------------------ Dateien */

export async function listPartnerFiles(partner: Partner, id: string, dir: string) {
  const server = await ready(partner, id);
  const directory = cleanPath(dir || '/', 'dir');
  try {
    const files = await pterodactyl().listFiles(server.pteroIdentifier, directory);
    return { directory, files: files.map((f) => ({ name: f.name, path: `${directory === '/' ? '' : directory}/${f.name}`, type: f.directory ? ('directory' as const) : ('file' as const), size: f.size, modifiedAt: f.modifiedAt })) };
  } catch (err) {
    panelFailure(err, L('Diesen Ordner gibt es nicht.', 'This directory does not exist.'));
  }
}

/** Textdatei lesen (für Einstellungs-Dateien; große oder binäre Dateien über die Download-Adresse) */
export async function readPartnerFile(partner: Partner, id: string, path: string) {
  const server = await ready(partner, id);
  const file = cleanPath(path);
  try {
    const content = await pterodactyl().readFile(server.pteroIdentifier, file);
    if (content === null) throw new ApiError(404, 'file_not_found', L('Diese Datei gibt es nicht.', 'This file does not exist.'));
    return { path: file, content };
  } catch (err) {
    panelFailure(err);
  }
}

/** Datei schreiben (bis 10 MB; größere Dateien über die Upload-Adresse) */
export async function writePartnerFile(partner: Partner, id: string, path: string, content: Buffer) {
  const server = await ready(partner, id);
  const file = cleanPath(path);
  if (file === '/') throw Errors.badRequest('invalid_path', L('Bitte einen Dateinamen angeben.', 'Please specify a file name.'));
  // Einstellungsdateien gleich beim Speichern auf die erlaubten Bereiche bringen – so kann ein ehrliches Bearbeiten
  // nie als Verstoß gelten (vor dem Start wird ohnehin noch einmal begrenzt)
  if (file === '/server.properties' || file === '/spigot.yml') {
    const text = content.toString('utf8');
    const fixed = file === '/spigot.yml' ? capSpigotYaml(text) : capProperties(text);
    if (fixed !== text) content = Buffer.from(fixed, 'utf8');
  }
  try {
    await pterodactyl().writeFileRaw(server.pteroIdentifier, file, content);
    return { path: file, size: content.length };
  } catch (err) {
    panelFailure(err);
  }
}

/** Adresse für den direkten Upload (auch große Dateien, z. B. eine Welt als ZIP) */
export async function partnerUploadUrl(partner: Partner, id: string, dir: string) {
  const server = await ready(partner, id);
  const directory = cleanPath(dir || '/', 'directory');
  try {
    const url = await pterodactyl().fileUploadUrl(server.pteroIdentifier);
    return { url: `${url}${url.includes('?') ? '&' : '?'}directory=${encodeURIComponent(directory)}`, method: 'POST', field: 'files', directory, expiresInSeconds: 600 };
  } catch (err) {
    panelFailure(err);
  }
}

export async function partnerDownloadUrl(partner: Partner, id: string, path: string) {
  const server = await ready(partner, id);
  const file = cleanPath(path);
  try {
    return { path: file, url: await pterodactyl().fileDownloadUrl(server.pteroIdentifier, file), expiresInSeconds: 600 };
  } catch (err) {
    panelFailure(err);
  }
}

export async function deletePartnerFiles(partner: Partner, id: string, paths: string[]) {
  const server = await ready(partner, id);
  const clean = [...new Set(paths.map((p) => cleanPath(p, 'paths')))].filter((p) => p !== '/');
  if (clean.length === 0) throw Errors.badRequest('invalid_path', L('Bitte mindestens einen Pfad angeben.', 'Please specify at least one path.'));
  // Nach Ordnern gruppieren – das Panel löscht je Ordner eine Liste von Namen
  const byRoot = new Map<string, string[]>();
  for (const p of clean) byRoot.set(split(p).root, [...(byRoot.get(split(p).root) ?? []), split(p).name]);
  try {
    for (const [root, names] of byRoot) await pterodactyl().deleteFiles(server.pteroIdentifier, root, names);
    return { deleted: clean };
  } catch (err) {
    panelFailure(err);
  }
}

export async function createPartnerFolder(partner: Partner, id: string, path: string) {
  const server = await ready(partner, id);
  const dir = cleanPath(path);
  if (dir === '/') throw Errors.badRequest('invalid_path', L('Bitte einen Ordnernamen angeben.', 'Please specify a directory name.'));
  try {
    await pterodactyl().createFolder(server.pteroIdentifier, split(dir).root, split(dir).name);
    return { path: dir };
  } catch (err) {
    panelFailure(err);
  }
}

/** Archiv entpacken – z. B. eine hochgeladene Welt (zip, tar.gz) */
export async function decompressPartnerFile(partner: Partner, id: string, path: string) {
  const server = await ready(partner, id);
  const file = cleanPath(path);
  try {
    // Das Panel meldet eine fehlende Datei beim Entpacken nur als allgemeinen Fehler – deshalb vorher nachsehen
    const listing = await pterodactyl().listFiles(server.pteroIdentifier, split(file).root);
    const entry = listing.find((f) => f.name === split(file).name);
    if (!entry || entry.directory) throw new ApiError(404, 'file_not_found', L('Diese Datei gibt es nicht.', 'This file does not exist.'));
    await pterodactyl().decompressFile(server.pteroIdentifier, split(file).root, split(file).name);
    return { path: file, extractedTo: split(file).root };
  } catch (err) {
    panelFailure(err);
  }
}

const safeFilename = (name: string) => name.replace(/[^\w.+()\[\] -]/g, '_').slice(0, 120);

/** Datei von einer https-Adresse direkt auf den Server laden (z. B. vom eigenen Dateiserver des Partners) */
export async function pullPartnerFile(partner: Partner, id: string, input: { url: string; directory: string; filename?: string }) {
  const server = await ready(partner, id);
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw Errors.badRequest('invalid_url', L('Das ist keine gültige Adresse.', 'This is not a valid URL.'));
  }
  if (url.protocol !== 'https:') throw Errors.badRequest('invalid_url', L('Nur https-Adressen sind erlaubt.', 'Only https URLs are allowed.'));
  const directory = cleanPath(input.directory || '/', 'directory');
  const filename = safeFilename(input.filename || decodeURIComponent(url.pathname.split('/').pop() || 'download'));
  try {
    await pterodactyl().pullFile(server.pteroIdentifier, url.toString(), directory, filename);
    return { path: `${directory === '/' ? '' : directory}/${filename}` };
  } catch (err) {
    panelFailure(err);
  }
}

/* ------------------------------------------------------------ Mods und Plugins von Modrinth */

/** Welche Lader ein Servertyp versteht – und wohin die Dateien gehören */
const LOADERS: Record<string, { loaders: string[]; directory: string }> = {
  paper: { loaders: ['paper', 'spigot', 'bukkit'], directory: '/plugins' },
  purpur: { loaders: ['purpur', 'paper', 'spigot', 'bukkit'], directory: '/plugins' },
  spigot: { loaders: ['spigot', 'bukkit'], directory: '/plugins' },
  fabric: { loaders: ['fabric'], directory: '/mods' },
  quilt: { loaders: ['quilt', 'fabric'], directory: '/mods' },
  forge: { loaders: ['forge'], directory: '/mods' },
  neoforge: { loaders: ['neoforge'], directory: '/mods' },
};

interface ModrinthVersion {
  id: string;
  project_id: string;
  version_number: string;
  files: { url: string; filename: string; primary: boolean }[];
  dependencies?: { project_id: string | null; version_id: string | null; dependency_type: string }[];
}

async function modrinth<T>(path: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${env.MODRINTH_API_URL}${path}`, { headers: { Accept: 'application/json', 'User-Agent': 'CraftingHosting.free partner-api' }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw Errors.unavailable(L('Modrinth ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.', 'Modrinth cannot be reached right now. Please try again shortly.'));
  }
  if (res.status === 404) return null;
  if (!res.ok) throw Errors.unavailable(L(`Modrinth antwortet mit Fehler ${res.status}.`, `Modrinth answered with error ${res.status}.`));
  return (await res.json()) as T;
}

/**
 * Mod bzw. Plugin von Modrinth installieren: passende Version für Lader und Minecraft-Version des Servers suchen
 * und die Datei direkt auf den Server laden – auf Wunsch samt der Pflicht-Abhängigkeiten.
 */
export async function installModrinth(partner: Partner, id: string, input: { project?: string; version?: string; dependencies?: boolean }, ip?: string) {
  const server = await ready(partner, id);
  const target = LOADERS[server.serverType];
  if (!target) throw new ApiError(409, 'mods_unsupported', L(`Der Servertyp „${server.serverType}“ unterstützt keine Mods oder Plugins.`, `The server type “${server.serverType}” does not support mods or plugins.`));
  if (!input.project && !input.version) throw Errors.badRequest('validation_error', L('Bitte „project“ (Modrinth-ID oder Kurzname) oder „version“ (Versions-ID) angeben.', 'Please specify “project” (Modrinth id or slug) or “version” (version id).'));
  const gameVersions = server.version === 'latest' ? '' : `&game_versions=${encodeURIComponent(JSON.stringify([server.version]))}`;
  const installed: { project: string; version: string; filename: string; path: string }[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  const pick = async (project: string): Promise<ModrinthVersion | null> => {
    const list = await modrinth<ModrinthVersion[]>(`/project/${encodeURIComponent(project)}/version?loaders=${encodeURIComponent(JSON.stringify(target.loaders))}${gameVersions}`);
    return list?.[0] ?? null;
  };
  const install = async (version: ModrinthVersion, depth: number): Promise<void> => {
    if (seen.has(version.project_id) || installed.length >= 25) return;
    seen.add(version.project_id);
    const file = version.files.find((f) => f.primary) ?? version.files[0];
    if (!file || !/^https:\/\//.test(file.url)) return void missing.push(version.project_id);
    const filename = safeFilename(file.filename);
    try {
      await pterodactyl().pullFile(server.pteroIdentifier, file.url, target.directory, filename);
    } catch (err) {
      panelFailure(err);
    }
    installed.push({ project: version.project_id, version: version.version_number, filename, path: `${target.directory}/${filename}` });
    if (input.dependencies === false || depth >= 3) return;
    for (const dep of version.dependencies ?? []) {
      if (dep.dependency_type !== 'required') continue;
      const next = dep.version_id ? await modrinth<ModrinthVersion>(`/version/${encodeURIComponent(dep.version_id)}`) : dep.project_id ? await pick(dep.project_id) : null;
      if (next) await install(next, depth + 1);
      else if (dep.project_id && !seen.has(dep.project_id)) missing.push(dep.project_id);
    }
  };

  const first = input.version ? await modrinth<ModrinthVersion>(`/version/${encodeURIComponent(input.version)}`) : await pick(input.project!);
  if (!first) {
    throw new ApiError(404, 'mod_not_found', L(`Bei Modrinth gibt es dazu keine passende Version (Lader: ${target.loaders[0]}, Minecraft ${server.version}).`, `Modrinth has no matching version for this (loader: ${target.loaders[0]}, Minecraft ${server.version}).`));
  }
  await install(first, 0);
  await audit({ userId: partner.userId, serverId: id, actor: 'system', action: 'partner.mods_installed', message: `Partner „${partner.name}“: ${installed.map((i) => i.filename).join(', ').slice(0, 300)} auf „${server.name}“ installiert`, ip });
  return { directory: target.directory, installed, missingDependencies: [...new Set(missing)], note: 'Changes take effect after the next server start.' };
}

/* ------------------------------------------------------------ Konsolen-Ausgabe */

/** Die letzten Zeilen der Konsole (aus logs/latest.log – wird bei jedem Start neu begonnen) */
export async function partnerLogs(partner: Partner, id: string, lines: number) {
  const server = await ready(partner, id);
  let text: string | null;
  try {
    text = await pterodactyl().readFile(server.pteroIdentifier, '/logs/latest.log');
  } catch (err) {
    if (err instanceof PterodactylError && (err.status === 400 || err.status === 413)) {
      throw new ApiError(409, 'log_too_large', L('Das Protokoll ist zu groß zum Abrufen. Nach dem nächsten Start beginnt ein neues.', 'The log is too large to fetch. A new one starts with the next server start.'));
    }
    panelFailure(err);
  }
  const all = (text ?? '').split(/\r?\n/);
  if (all[all.length - 1] === '') all.pop();
  const count = Math.min(Math.max(lines, 1), 1000);
  return { lines: all.slice(-count), totalLines: all.length, source: 'logs/latest.log' };
}

/* ------------------------------------------------------------ Servereinstellungen (server.properties) */

type Setting = { key: string; kind: 'string' | 'int' | 'bool' | 'enum'; min?: number; max?: number; values?: string[] };
/** Einstellbare Werte – bewusst eine feste Auswahl (z. B. kein online-mode) */
export const SERVER_SETTINGS: Record<string, Setting> = {
  motd: { key: 'motd', kind: 'string', max: 120 },
  maxPlayers: { key: 'max-players', kind: 'int', min: 1, max: 100 },
  gamemode: { key: 'gamemode', kind: 'enum', values: ['survival', 'creative', 'adventure', 'spectator'] },
  difficulty: { key: 'difficulty', kind: 'enum', values: ['peaceful', 'easy', 'normal', 'hard'] },
  hardcore: { key: 'hardcore', kind: 'bool' },
  pvp: { key: 'pvp', kind: 'bool' },
  whitelist: { key: 'white-list', kind: 'bool' },
  seed: { key: 'level-seed', kind: 'string', max: 64 },
  levelType: { key: 'level-type', kind: 'enum', values: ['normal', 'flat', 'large_biomes', 'amplified'] },
  spawnProtection: { key: 'spawn-protection', kind: 'int', min: 0, max: 64 },
  viewDistance: { key: 'view-distance', kind: 'int', min: 3, max: 16 },
  simulationDistance: { key: 'simulation-distance', kind: 'int', min: 3, max: 16 },
  allowFlight: { key: 'allow-flight', kind: 'bool' },
};

function parseProperties(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at > 0) map.set(line.slice(0, at).trim(), line.slice(at + 1));
  }
  return map;
}

function settingsFrom(props: Map<string, string>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [name, s] of Object.entries(SERVER_SETTINGS)) {
    const raw = props.get(s.key);
    if (raw === undefined) out[name] = null;
    else if (s.kind === 'bool') out[name] = raw.trim() === 'true';
    else if (s.kind === 'int') out[name] = Number.isFinite(Number(raw)) ? Number(raw) : null;
    else out[name] = name === 'levelType' ? raw.replace(/^minecraft:/, '') : raw;
  }
  return out;
}

/** Aktuelle Einstellungen (null = noch nicht gesetzt, es gilt der Standard von Minecraft) */
export async function getPartnerSettings(partner: Partner, id: string) {
  const server = await ready(partner, id);
  try {
    const text = await pterodactyl().readFile(server.pteroIdentifier, '/server.properties');
    return { settings: settingsFrom(parseProperties(text ?? '')), exists: text !== null };
  } catch (err) {
    panelFailure(err);
  }
}

/** Einstellungen setzen – geht schon vor dem ersten Start. Wirksam werden sie beim nächsten Start. */
export async function setPartnerSettings(partner: Partner, id: string, input: Record<string, unknown>) {
  const server = await ready(partner, id);
  const changes = new Map<string, string>();
  const fields: Record<string, ReturnType<typeof L>> = {};
  for (const [name, value] of Object.entries(input)) {
    const s = SERVER_SETTINGS[name];
    if (!s) {
      fields[name] = L('Diese Einstellung gibt es nicht.', 'This setting does not exist.');
      continue;
    }
    if (s.kind === 'bool' && typeof value === 'boolean') changes.set(s.key, String(value));
    else if (s.kind === 'int' && typeof value === 'number' && Number.isInteger(value) && value >= s.min! && value <= s.max!) changes.set(s.key, String(value));
    else if (s.kind === 'enum' && typeof value === 'string' && s.values!.includes(value)) changes.set(s.key, name === 'levelType' ? `minecraft:${value}` : value);
    else if (s.kind === 'string' && typeof value === 'string' && value.length <= s.max! && !/[\r\n]/.test(value)) changes.set(s.key, value);
    else {
      fields[name] =
        s.kind === 'int' ? L(`Ganze Zahl von ${s.min} bis ${s.max}.`, `Integer from ${s.min} to ${s.max}.`) : s.kind === 'enum' ? L(`Erlaubt: ${s.values!.join(', ')}.`, `Allowed: ${s.values!.join(', ')}.`) : s.kind === 'bool' ? L('true oder false.', 'true or false.') : L(`Text mit höchstens ${s.max} Zeichen.`, `Text with at most ${s.max} characters.`);
    }
  }
  if (Object.keys(fields).length) throw Errors.badRequest('validation_error', L('Bitte prüfe die Einstellungen.', 'Please check the settings.'), fields);
  if (changes.size === 0) throw Errors.badRequest('validation_error', L('Es wurde keine Einstellung angegeben.', 'No setting was specified.'));
  try {
    const text = stripLimitsBlock((await pterodactyl().readFile(server.pteroIdentifier, '/server.properties')) ?? '');
    // Vorhandene Zeilen ändern (alle Vorkommen eines Schlüssels), Kommentare und unbekannte Einträge unangetastet
    // lassen, neue Schlüssel anhängen. „\“ leitet in dieser Datei ein Sonderzeichen ein und wird deshalb verdoppelt.
    const open = new Set(changes.keys());
    const lines = text.split(/\r?\n/).map((line) => {
      const at = line.indexOf('=');
      const key = at > 0 && !line.trimStart().startsWith('#') ? line.slice(0, at).trim() : null;
      if (key === null || !changes.has(key)) return line;
      open.delete(key);
      return `${key}=${changes.get(key)!.replace(/\\/g, '\\\\')}`;
    });
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    for (const key of open) lines.push(`${key}=${changes.get(key)!.replace(/\\/g, '\\\\')}`);
    const next = capProperties(`${lines.join('\n')}\n`);
    await pterodactyl().writeFile(server.pteroIdentifier, '/server.properties', next);
    return { settings: settingsFrom(parseProperties(next)), note: 'Changes take effect after the next server start. seed and levelType only apply to a newly generated world.' };
  } catch (err) {
    panelFailure(err);
  }
}

/* ------------------------------------------------------------ Live-Werte */

const statsCache = new Map<string, { at: number; value: unknown }>();

export async function partnerStats(partner: Partner, id: string) {
  const server = await ready(partner, id);
  // Kurz gemerkt: Häufiges Abfragen kostet so höchstens einen Panel-Aufruf alle fünf Sekunden je Server
  const cached = statsCache.get(id);
  if (cached && Date.now() - cached.at < 5_000) return cached.value;
  try {
    const r = await pterodactyl().getResources(server.pteroIdentifier);
    const running = r.state === 'running';
    const value = {
      state: r.state,
      cpuPercent: Math.round(r.cpuAbsolute * 10) / 10,
      cpuLimitPercent: server.cpuPercent,
      memoryBytes: r.memoryBytes,
      memoryLimitBytes: server.memoryMb * 1024 * 1024,
      diskBytes: r.diskBytes,
      diskLimitBytes: server.diskMb * 1024 * 1024,
      networkRxBytes: r.networkRxBytes,
      networkTxBytes: r.networkTxBytes,
      uptimeSeconds: Math.round(r.uptimeMs / 1000),
      // Spielerzahl: direkte Abfrage beim Minecraft-Server (null = antwortet gerade nicht, z. B. während des Starts)
      players: running ? await playersOnline(server) : null,
    };
    if (statsCache.size > 5000) statsCache.clear();
    statsCache.set(id, { at: Date.now(), value });
    return value;
  } catch (err) {
    panelFailure(err);
  }
}

/* ------------------------------------------------------------ Umbenennen */

/** Server umbenennen – die Spieler-ID am Ende des Namens bleibt */
export async function renamePartnerServer(partner: Partner, id: string, nameRaw: string, ip?: string): Promise<PartnerServerDTO> {
  const { server, player } = await loadPartnerServer(partner, id);
  const name = nameRaw.replace(/\s+/g, ' ').trim();
  if (name.length < 3 || name.length > NAME_MAX || !/^[\p{L}\p{N} _.'-]+$/u.test(name)) {
    const msg = L(`Der Servername muss 3–${NAME_MAX} Zeichen lang sein (Buchstaben, Ziffern, Leerzeichen, . _ ' -).`, `The server name must be 3–${NAME_MAX} characters (letters, digits, spaces, . _ ' -).`);
    throw Errors.badRequest('invalid_name', msg, { name: msg });
  }
  const full = `${name} #${player.id}`;
  if (server.pteroServerId) {
    try {
      await pterodactyl().renameServer(server.pteroServerId, full);
    } catch (err) {
      panelFailure(err);
    }
  }
  await db.update(servers).set({ name: full }).where(eq(servers.id, id));
  await audit({ userId: partner.userId, serverId: id, actor: 'system', action: 'partner.server_renamed', message: `Partner „${partner.name}“: „${server.name}“ heißt jetzt „${full}“`, ip });
  return getPartnerServer(partner, id);
}

/* ------------------------------------------------------------ Grenzen der Einstellungen beim Start durchsetzen */

/** Schlüssel bzw. Wert einer .properties-Zeile entschlüsseln (\uXXXX, \t, \n …) – so wie Java es beim Laden tut */
const unescapeProperty = (v: string) =>
  v.replace(/\\u([0-9a-fA-F]{4})|\\(.)/gs, (_m, hex: string | undefined, ch: string | undefined) => (hex ? String.fromCharCode(parseInt(hex, 16)) : ch === 't' ? '\t' : ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch === 'f' ? '\f' : (ch ?? '')));

const CAPS = () => Object.values(SERVER_SETTINGS).filter((s) => s.kind === 'int');
/** Standardwerte von Minecraft für die begrenzten Einstellungen (falls sie in der Datei fehlen) */
const CAP_DEFAULTS: Record<string, number> = { 'max-players': 20, 'spawn-protection': 16, 'view-distance': 10, 'simulation-distance': 10 };
const LIMITS_MARK = '#chf-limits';
const LIMITS_BLOCK = new RegExp(`\\n*${LIMITS_MARK}\\n(?:[a-z-]+=-?\\d+\\n)*$`);

/** Unseren Block am Dateiende entfernen (z. B. bevor Einstellungen geändert werden) */
export const stripLimitsBlock = (text: string) => text.replace(LIMITS_BLOCK, '\n');

/**
 * Liest eine .properties-Datei so gut wie möglich nach den Regeln von Java (Trennzeichen „=“, „:“ oder Leerraum,
 * Fortsetzungszeilen, maskierte Zeichen, der letzte Eintrag gewinnt). Für Dateien, die Minecraft selbst geschrieben
 * hat, ist das exakt. Bei von Hand gebauten Sonderfällen kann es von Java abweichen (die Java-Versionen sind sich da
 * selbst nicht einig) – deshalb verlässt sich die Begrenzung unten nicht auf dieses Lesen.
 */
function javaProperties(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const physical = text.split(/\r\n|\n|\r/);
  for (let i = 0; i < physical.length; i++) {
    let line = physical[i]!.replace(/^[ \t\f]+/, '');
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    while (/(?:^|[^\\])(?:\\\\)*\\$/.test(line) && i + 1 < physical.length) {
      i++;
      line = line.slice(0, -1) + physical[i]!.replace(/^[ \t\f]+/, '');
    }
    let end = 0;
    while (end < line.length && !/[=: \t\f]/.test(line[end]!)) end += line[end] === '\\' ? 2 : 1;
    map.set(unescapeProperty(line.slice(0, end)), unescapeProperty(line.slice(end).replace(/^[ \t\f]*[=:]?[ \t\f]*/, '')));
  }
  return map;
}

const plainInt = (value: string | undefined) => (value !== undefined && /^[+-]?\d{1,9}$/.test(value.trim()) ? Number(value.trim()) : NaN);

/** Liegt eine begrenzte Einstellung außerhalb des erlaubten Bereichs? (Für die Nachprüfung bei laufendem Server) */
export function propertiesViolation(text: string): boolean {
  // Mit Fortsetzungszeilen (eine Zeile endet auf „\“) lesen verschiedene Java-Versionen dieselbe Datei unterschiedlich.
  // Minecraft schreibt solche Zeilen nie selbst. Dann zählt nur, ob unser Block am Ende die Werte festlegt.
  if (text.split(/\r\n|\n|\r/).some((line) => /(?:^|[^\\])(?:\\\\)*\\$/.test(line))) return capProperties(text) !== text;
  const props = javaProperties(text);
  return CAPS().some((cap) => {
    const raw = props.get(cap.key);
    if (raw === undefined) return false;
    const value = plainInt(raw);
    // Keine gültige Zahl: Minecraft nimmt dann seinen Standardwert – der liegt innerhalb der Grenzen
    return Number.isFinite(value) && (value < cap.min! || value > cap.max!);
  });
}

/**
 * Begrenzte Einstellungen einer server.properties auf den erlaubten Bereich bringen – so, dass es nicht darauf ankommt,
 * ob wir die Datei genauso lesen wie Java:
 *  – Einfache Dateien (ohne „\“ und ohne Wagenrücklauf) kennen keine Fortsetzungszeilen und keine maskierten Zeichen.
 *    Sie lassen sich eindeutig lesen; sind alle Werte im Rahmen, bleibt die Datei unverändert.
 *  – In allen anderen Fällen hängen wir die begrenzten Werte in einem eigenen Block ans Ende. Java übernimmt bei
 *    doppelten Schlüsseln immer den letzten Eintrag, und die Leerzeilen davor beenden jede offene Fortsetzungszeile –
 *    der Block gilt also unabhängig davon, was weiter oben steht oder wie trickreich es geschrieben ist.
 */
export function capProperties(text: string): string {
  const caps = CAPS();
  if (!/[\\\r]/.test(text)) {
    // Eindeutig lesbar: je Zeile Schlüssel bis zum ersten „=“, „:“ oder Leerraum; der letzte Eintrag gewinnt
    const last = new Map<string, string>();
    for (const raw of text.split('\n')) {
      const line = raw.replace(/^[ \t\f]+/, '');
      if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
      const m = /^([^=: \t\f]*)[ \t\f]*[=:]?[ \t\f]*(.*)$/.exec(line);
      if (m) last.set(m[1]!, m[2]!);
    }
    const fine = caps.every((cap) => {
      const raw = last.get(cap.key);
      if (raw === undefined) return true;
      const value = plainInt(raw);
      return Number.isFinite(value) && value >= cap.min! && value <= cap.max!;
    });
    if (fine) return text;
  }
  const props = javaProperties(text);
  const block = caps
    .map((cap) => {
      const value = plainInt(props.get(cap.key));
      const wanted = Number.isFinite(value) ? value : (CAP_DEFAULTS[cap.key] ?? cap.min!);
      return `${cap.key}=${Math.min(cap.max!, Math.max(cap.min!, wanted))}\n`;
    })
    .join('');
  return `${stripLimitsBlock(text).replace(/\n+$/, '')}\n\n\n${LIMITS_MARK}\n${block}`;
}

/**
 * Sichtweite in der spigot.yml begrenzen (Paper/Purpur lesen sie von dort je Welt und übergehen damit die
 * server.properties). Bewusst einfach gehalten: Jede Zahl hinter „view-distance“ bzw. „simulation-distance“ wird
 * auf den Höchstwert gekappt; „default“ bleibt.
 */
export function capSpigotYaml(text: string): string {
  const max = SERVER_SETTINGS.viewDistance!.max!;
  // Der Wert hinter dem Schlüssel: „default“ und einfache Zahlen bis zum Höchstwert bleiben, alles andere (größere
  // Zahlen, aber auch Schreibweisen wie 0x20, 3_2, 32.0 oder +32) wird durch den Höchstwert ersetzt
  return text.replace(/((?:view|simulation)-distance["']?[ \t]*:[ \t]*)(["']?)([^\s"'#,}\]]+)\2/g, (all, head: string, _quote: string, value: string) => {
    if (value === 'default' || (/^\d{1,2}$/.test(value) && Number(value) <= max)) return all;
    return `${head}${max}`;
  });
}

/** Servertypen, die zusätzlich die spigot.yml auswerten */
const BUKKIT_TYPES = new Set(['paper', 'purpur']);

/**
 * Vor jedem Start: Werte auf die erlaubten Bereiche zurückführen. So lassen sich die Grenzen des
 * Einstellungs-Endpunkts nicht über einen direkten Datei-Upload oder ein eingespieltes Backup umgehen.
 */
export async function enforceSettingsCaps(identifier: string, serverType?: string): Promise<void> {
  const text = await pterodactyl().readFile(identifier, '/server.properties');
  if (text !== null) {
    const fixed = capProperties(text);
    if (fixed !== text) await pterodactyl().writeFile(identifier, '/server.properties', fixed);
  }
  if (serverType && BUKKIT_TYPES.has(serverType)) {
    const yaml = await pterodactyl().readFile(identifier, '/spigot.yml');
    if (yaml !== null) {
      const fixed = capSpigotYaml(yaml);
      if (fixed !== yaml) await pterodactyl().writeFile(identifier, '/spigot.yml', fixed);
    }
  }
}

/**
 * Nachprüfung bei laufendem Server. Rückgabe: 'ok', 'violation' (Werte über den Grenzen – die Dateien sind dann
 * bereits korrigiert) oder 'unreadable' (die Datei lässt sich nicht lesen, obwohl das Panel antwortet).
 * Wirft, wenn das Panel gerade nicht erreichbar ist.
 */
export async function checkSettingsCaps(identifier: string, serverType: string): Promise<'ok' | 'violation' | 'unreadable'> {
  let violation = false;
  try {
    const text = await pterodactyl().readFile(identifier, '/server.properties');
    if (text !== null && propertiesViolation(text)) {
      violation = true;
      await pterodactyl().writeFile(identifier, '/server.properties', capProperties(text)).catch(() => {});
    }
    if (BUKKIT_TYPES.has(serverType)) {
      const yaml = await pterodactyl().readFile(identifier, '/spigot.yml');
      if (yaml !== null && capSpigotYaml(yaml) !== yaml) {
        violation = true;
        await pterodactyl().writeFile(identifier, '/spigot.yml', capSpigotYaml(yaml)).catch(() => {});
      }
    }
  } catch (err) {
    // 4xx vom Panel (z. B. Datei zu groß zum Lesen): Der Partner hat die Datei unprüfbar gemacht
    if (err instanceof PterodactylError && err.status >= 400 && err.status < 500 && err.status !== 429 && err.status !== 409) return 'unreadable';
    throw err;
  }
  return violation ? 'violation' : 'ok';
}

/* ------------------------------------------------------------ Backups */

/**
 * Eigene Grenzen je Server (zusätzlich zur Anfragebegrenzung je Partner): Backups und Neuinstallationen belasten den
 * Node stark, und die Anfragebegrenzung allein würde hunderte davon in der Stunde erlauben.
 */
const recentActions = new Map<string, number[]>();
function throttle(key: string, max: number, windowMs: number, what: { de: string; en: string }): void {
  const now = Date.now();
  const times = (recentActions.get(key) ?? []).filter((t) => now - t < windowMs);
  if (times.length >= max) {
    const wait = Math.ceil((windowMs - (now - times[0]!)) / 60_000);
    throw new ApiError(429, 'too_often', L(`${what.de} Bitte in etwa ${wait} Minute${wait === 1 ? '' : 'n'} erneut versuchen.`, `${what.en} Please try again in about ${wait} minute${wait === 1 ? '' : 's'}.`), { retryAfterSeconds: String(wait * 60) });
  }
  times.push(now);
  if (recentActions.size > 20_000) recentActions.clear();
  recentActions.set(key, times);
}

/** Je Server immer nur ein Backup-Vorgang zugleich – sonst ließe sich die Höchstzahl mit gleichzeitigen Anfragen überschreiten */
const backupBusy = new Set<string>();
async function oneAtATime<T>(serverId: string, fn: () => Promise<T>): Promise<T> {
  if (backupBusy.has(serverId)) throw new ApiError(409, 'backup_busy', L('Für diesen Server läuft gerade ein Backup-Vorgang. Bitte kurz warten.', 'A backup operation is already running for this server. Please wait a moment.'));
  backupBusy.add(serverId);
  try {
    return await fn();
  } finally {
    backupBusy.delete(serverId);
  }
}

/** Alle Backups eines Servers löschen (vor dem Löschen des Servers – sonst blieben sie auf dem Node liegen) */
export async function purgePartnerBackups(identifier: string, force = false): Promise<void> {
  // Schlägt etwas fehl, wird der Server NICHT gelöscht (der Aufrufer bricht ab) – sonst blieben Backups ungezählt liegen.
  // Ausnahmen: Den Server gibt es im Panel nicht mehr (404). Und mit `force` (Löschung durch uns: Admin, ungenutzte
  // Server) hält ein gesperrter oder nicht bereiter Server (409) das Löschen nicht auf.
  const skip = (err: unknown) => err instanceof PterodactylError && (err.status === 404 || (force && err.status === 409));
  for (let round = 0; round < 5; round++) {
    let list;
    try {
      list = await pterodactyl().listBackups(identifier);
    } catch (err) {
      if (skip(err)) return;
      throw err;
    }
    if (list.length === 0) return;
    for (const backup of list) {
      await pterodactyl().deleteBackup(identifier, backup.uuid).catch((err) => {
        if (!skip(err)) throw err;
      });
    }
  }
}

const backupDTO = (b: { uuid: string; name: string; bytes: number; completedAt: string | null; successful: boolean; createdAt: string }) => ({ id: b.uuid, name: b.name, bytes: b.bytes, state: b.completedAt ? (b.successful ? 'ready' : 'failed') : 'creating', createdAt: b.createdAt, completedAt: b.completedAt });

function backupFailure(err: unknown): never {
  if (err instanceof PterodactylError) {
    const text = JSON.stringify(err.details ?? '') + err.message;
    if (err.status === 404) throw new ApiError(404, 'backup_not_found', L('Dieses Backup gibt es nicht.', 'This backup does not exist.'));
    if (/TooManyBackups|limit of backups|backup limit/i.test(text)) throw new ApiError(409, 'backup_limit', L('Die Höchstzahl an Backups für diesen Server ist erreicht. Lösche zuerst ein älteres.', 'The maximum number of backups for this server has been reached. Delete an older one first.'));
    if (err.status === 429 || /TooManyRequests|rate/i.test(text)) throw new ApiError(429, 'backup_rate_limited', L('Es wurden gerade erst Backups erstellt. Bitte ein paar Minuten warten.', 'Backups were created just now. Please wait a few minutes.'));
    if (err.status === 400 || err.status === 409) throw new ApiError(409, 'backup_rejected', L(`Das Panel hat das abgelehnt: ${err.message}`.slice(0, 240), `The panel rejected this: ${err.message}`.slice(0, 240)));
  }
  panelFailure(err);
}

export async function listPartnerBackups(partner: Partner, id: string) {
  const server = await ready(partner, id);
  const limit = findPlan(await getSettings(), server.planId)?.backups ?? 0;
  try {
    return { limit, backups: (await pterodactyl().listBackups(server.pteroIdentifier)).map(backupDTO) };
  } catch (err) {
    backupFailure(err);
  }
}

/** Backup anlegen – die Zahl der Backups begrenzt das Paket. Geprüft wird hier UND vom Panel. */
export async function createPartnerBackup(partner: Partner, id: string, nameRaw?: string) {
  const server = await ready(partner, id);
  const name = (nameRaw ?? '').replace(/[^\p{L}\p{N} _.:-]/gu, '').trim().slice(0, 60) || `Backup ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const limit = findPlan(await getSettings(), server.planId)?.backups ?? 0;
  return oneAtATime(id, async () => {
    try {
      const existing = await pterodactyl().listBackups(server.pteroIdentifier);
      if (existing.length >= limit) throw new ApiError(409, 'backup_limit', L('Die Höchstzahl an Backups für diesen Server ist erreicht. Lösche zuerst ein älteres.', 'The maximum number of backups for this server has been reached. Delete an older one first.'));
      throttle(`backup:${id}`, 2, 10 * 60_000, { de: 'Für diesen Server wurden gerade erst Backups erstellt.', en: 'Backups were created for this server just now.' });
      return { backup: backupDTO(await pterodactyl().createBackup(server.pteroIdentifier, name)) };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      backupFailure(err);
    }
  });
}

const backupId = (value: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new ApiError(404, 'backup_not_found', L('Dieses Backup gibt es nicht.', 'This backup does not exist.'));
  return value;
};

export async function partnerBackupDownloadUrl(partner: Partner, id: string, backup: string) {
  const server = await ready(partner, id);
  try {
    return { id: backupId(backup), url: await pterodactyl().backupDownloadUrl(server.pteroIdentifier, backupId(backup)), expiresInSeconds: 300 };
  } catch (err) {
    backupFailure(err);
  }
}

/** Server muss aus sein und darf keine laufende Sitzung haben (Einspielen, Typwechsel, Neuinstallation) */
async function assertOffline(partner: Partner, id: string, allowFailed = false) {
  const { server, ps } = await loadPartnerServer(partner, id);
  if (server.status === 'suspended') throw new ApiError(409, 'server_suspended', L('Dieser Server ist gesperrt.', 'This server is suspended.'));
  if (server.status !== 'active' || !server.pteroIdentifier || !server.pteroServerId) throw new ApiError(409, 'server_installing', L('Der Server wird noch eingerichtet.', 'The server is still being set up.'));
  if (ps.softwareJob && !ps.softwareJob.error) throw new ApiError(409, 'server_installing', L('Die Server-Software wird noch eingerichtet. Bitte gleich noch einmal versuchen.', 'The server software is still being set up. Please try again shortly.'));
  // Immer frisch im Panel nachsehen – auch nach einer fehlgeschlagenen Einrichtung (der Server könnte trotzdem laufen)
  const state = await confirmedState(server);
  const failedOk = allowFailed && state === 'failed';
  if (ps.hostActive || !(state === 'offline' || failedOk)) {
    if (state === 'installing') throw new ApiError(409, 'server_installing', L('Der Server wird noch installiert. Bitte gleich noch einmal versuchen.', 'The server is still being installed. Please try again shortly.'));
    if (state === 'failed') throw new ApiError(409, 'server_failed', L('Die Installation des Servers ist fehlgeschlagen. Bitte neu installieren (POST /reinstall).', 'Installing the server failed. Please reinstall (POST /reinstall).'));
    throw new ApiError(409, 'server_running', L('Dafür muss der Server gestoppt sein. Bitte zuerst stoppen und warten, bis er aus ist.', 'The server must be stopped for this. Please stop it first and wait until it is offline.'));
  }
  return { ...(server as Server & { pteroIdentifier: string; pteroServerId: number }), panelInstallFailed: state === 'failed' };
}

export async function restorePartnerBackup(partner: Partner, id: string, backup: string, truncate: boolean, ip?: string) {
  const server = await assertOffline(partner, id);
  backupId(backup);
  throttle(`restore:${id}`, 2, 10 * 60_000, { de: 'Auf diesem Server wurde gerade erst ein Backup eingespielt.', en: 'A backup was restored on this server just now.' });
  try {
    await pterodactyl().restoreBackup(server.pteroIdentifier, backupId(backup), truncate);
  } catch (err) {
    backupFailure(err);
  }
  forgetLiveState(id);
  statsCache.delete(id);
  await audit({ userId: partner.userId, serverId: id, actor: 'system', action: 'partner.backup_restored', message: `Partner „${partner.name}“: Backup auf „${server.name}“ eingespielt`, ip });
  return { ok: true, note: 'The restore runs in the background. Start the server once its state is offline again.' };
}

export async function deletePartnerBackup(partner: Partner, id: string, backup: string) {
  const server = await ready(partner, id);
  try {
    await pterodactyl().deleteBackup(server.pteroIdentifier, backupId(backup));
    return { ok: true };
  } catch (err) {
    backupFailure(err);
  }
}

/* ------------------------------------------------------------ Servertyp und Version wechseln, neu installieren */

/**
 * Servertyp und/oder Version ändern und neu installieren (oder nur neu installieren). Erlaubt sind dieselben Typen
 * und Versionen wie beim Erstellen; Paket, Ressourcen und Laufzeit-Stand des Servers bleiben unverändert.
 */
export async function changePartnerServer(partner: Partner, id: string, input: { serverType?: string; version?: string }, ip?: string): Promise<PartnerServerDTO> {
  // Auch nach einer fehlgeschlagenen Installation erlaubt – genau dafür ist die Neuinstallation da
  const server = await assertOffline(partner, id, true);
  const settings = await getSettings();
  const serverType = input.serverType ?? server.serverType;
  const version = input.version ?? (input.serverType && input.serverType !== server.serverType ? 'latest' : server.version);
  const type = getServerType(serverType);
  if (!type || type.kind !== 'minecraft' || !partnerTypeAvailable(serverType, settings)) {
    const msg = L('Dieser Servertyp ist nicht verfügbar.', 'This server type is not available.');
    throw Errors.badRequest('server_type_unavailable', msg, { serverType: msg });
  }
  // Unverändert neu installieren geht immer – auch wenn „latest“ inzwischen eine Version bezeichnet, die nicht einzeln zur Auswahl steht
  if (!(serverType === server.serverType && version === server.version) && !versionsFor(settings, type.id).includes(version)) {
    const msg = L('Diese Version ist für den Servertyp nicht verfügbar.', 'This version is not available for the selected server type.');
    throw Errors.badRequest('version_unavailable', msg, { version: msg });
  }
  // Typen ohne eigenes Egg: Die Software kommt aus dem Verzeichnis – vorab nachschlagen, damit ein Tippfehler nichts anstößt
  const software = installsViaDirectory(serverType, settings) ? await resolveSoftware(serverType, version) : null;
  throttle(`reinstall:${id}`, 3, 60 * 60_000, { de: 'Dieser Server wurde gerade erst mehrfach neu installiert.', en: 'This server has been reinstalled several times just now.' });
  // Nur umstellen, wenn inzwischen keine Sitzung begonnen hat (ein gleichzeitiger Start hätte sonst einen laufenden
  // Server, dem die Software unter den Füßen ausgetauscht wird)
  const idle = and(eq(partnerServers.serverId, id), eq(partnerServers.hostActive, false));
  const busy = () => new ApiError(409, 'server_running', L('Dafür muss der Server gestoppt sein. Bitte zuerst stoppen und warten, bis er aus ist.', 'The server must be stopped for this. Please stop it first and wait until it is offline.'));
  if (software) {
    await assertInstallSlot(partner.id, id);
    // Kein Neuaufsetzen im Panel: Der Software-Job tauscht die Server-Software aus (Welt und übrige Dateien bleiben).
    // Ausnahme: Die Grundinstallation im Panel war fehlgeschlagen – dann zuerst diese wiederholen.
    if (affectedRows(await db.update(partnerServers).set({ softwareJob: newSoftwareJob(software, server.panelInstallFailed), installedNotified: false }).where(idle)) !== 1) throw busy();
    await db.update(servers).set({ serverType, version }).where(eq(servers.id, id));
    if (server.panelInstallFailed) {
      try {
        await pterodactyl().reinstallServer(server.pteroServerId);
      } catch (err) {
        await db.update(partnerServers).set({ softwareJob: null }).where(eq(partnerServers.serverId, id));
        panelFailure(err);
      }
      await db.update(servers).set({ powerState: 'installing' }).where(eq(servers.id, id));
    }
  } else {
    if (affectedRows(await db.update(partnerServers).set({ softwareJob: null, installedNotified: false }).where(idle)) !== 1) throw busy();
    try {
      await pterodactyl().updateServerStartup(server.pteroServerId, await startupFor(serverType, version, settings));
      await pterodactyl().reinstallServer(server.pteroServerId);
    } catch (err) {
      panelFailure(err);
    }
    await db.update(servers).set({ serverType, version, powerState: 'installing' }).where(eq(servers.id, id));
  }
  forgetLiveState(id);
  statsCache.delete(id);
  await audit({ userId: partner.userId, serverId: id, actor: 'system', action: 'partner.server_reinstalled', message: `Partner „${partner.name}“: „${server.name}“ neu installiert (${serverType} ${version}${serverType !== server.serverType || version !== server.version ? `, vorher ${server.serverType} ${server.version}` : ''})`, ip });
  return getPartnerServer(partner, id);
}
