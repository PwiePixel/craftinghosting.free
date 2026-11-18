/**
 * Partner-API, zweiter Teil: alles, was ein Launcher ohne Panel-Zugang braucht –
 * Dateien (Mods, Plugins, Welten), Mods von Modrinth, Konsolen-Ausgabe, Servereinstellungen, Live-Werte, Umbenennen.
 */
import { eq } from 'drizzle-orm';
import { freeHostingConfig } from '@chfree/shared';
import { db } from '../db/client';
import { servers, type Partner, type Server } from '../db/schema';
import { env } from '../env';
import { ApiError, Errors, L } from '../lib/errors';
import { pterodactyl } from '../pterodactyl';
import { PterodactylError } from '../pterodactyl/types';
import { audit } from './audit.service';
import { getPartnerServer, loadPartnerServer, playersOnline, type PartnerServerDTO } from './partner.service';

const NAME_MAX = freeHostingConfig.limits.serverNameMaxLength - 10;

/* ------------------------------------------------------------ Hilfen */

/** Server muss fertig eingerichtet sein, damit sich Dateien und Einstellungen ändern lassen */
async function ready(partner: Partner, id: string): Promise<Server & { pteroIdentifier: string }> {
  const { server } = await loadPartnerServer(partner, id);
  if (server.status !== 'active' || !server.pteroIdentifier || server.powerState === 'installing') {
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
    const text = (await pterodactyl().readFile(server.pteroIdentifier, '/server.properties')) ?? '';
    // Vorhandene Zeilen ändern, Kommentare und unbekannte Einträge unangetastet lassen, neue Schlüssel anhängen
    const open = new Map(changes);
    const lines = text.split(/\r?\n/).map((line) => {
      const at = line.indexOf('=');
      const key = at > 0 && !line.trimStart().startsWith('#') ? line.slice(0, at).trim() : null;
      if (key === null || !open.has(key)) return line;
      const value = open.get(key)!;
      open.delete(key);
      return `${key}=${value}`;
    });
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    for (const [key, value] of open) lines.push(`${key}=${value}`);
    const next = `${lines.join('\n')}\n`;
    await pterodactyl().writeFile(server.pteroIdentifier, '/server.properties', next);
    return { settings: settingsFrom(parseProperties(next)), note: 'Changes take effect after the next server start. seed and levelType only apply to a newly generated world.' };
  } catch (err) {
    panelFailure(err);
  }
}

/* ------------------------------------------------------------ Live-Werte */

export async function partnerStats(partner: Partner, id: string) {
  const server = await ready(partner, id);
  try {
    const r = await pterodactyl().getResources(server.pteroIdentifier);
    const running = r.state === 'running';
    return {
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
