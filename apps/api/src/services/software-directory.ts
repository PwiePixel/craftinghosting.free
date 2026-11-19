/**
 * Verzeichnis der Minecraft-Server-Software (MCJars): welche Versionen es je Servertyp gibt und wie sie eingerichtet
 * werden. Daraus kommt die Versionsauswahl (Website und Partner-API) und die Einrichtung über die Partner-API.
 *
 * Das Verzeichnis wird zwischengespeichert. Ist es nicht erreichbar, gilt der letzte bekannte Stand – und wenn es noch
 * keinen gibt, unsere fest hinterlegte Liste.
 */
import { getServerType, versionsFor, type SiteSettings } from '@chfree/shared';
import { env } from '../env';
import { Errors, L } from '../lib/errors';

/** Unsere Servertypen → Bezeichnung im Verzeichnis */
export const DIRECTORY_TYPES: Record<string, string> = { paper: 'PAPER', purpur: 'PURPUR', vanilla: 'VANILLA', fabric: 'FABRIC', forge: 'FORGE', neoforge: 'NEOFORGE', quilt: 'QUILT' };

export interface DirectoryBuild {
  name?: string | null;
  versionId?: string | null;
  projectVersionId?: string | null;
  installation?: unknown;
}
export interface DirectoryVersion {
  type?: string;
  supported?: boolean;
  java?: number | null;
  latest?: DirectoryBuild | null;
}

const FRESH_MS = 10 * 60_000;
const cache = new Map<string, { at: number; versions: Record<string, DirectoryVersion> }>();
const loading = new Map<string, Promise<Record<string, DirectoryVersion> | null>>();

const unavailable = () => Errors.unavailable(L('Das Verzeichnis der Server-Software ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.', 'The server software directory cannot be reached right now. Please try again shortly.'));

/** Lädt den Stand eines Typs neu (höchstens eine Abfrage gleichzeitig je Typ). null = nicht erreichbar. */
function refresh(name: string): Promise<Record<string, DirectoryVersion> | null> {
  const running = loading.get(name);
  if (running) return running;
  const task = (async () => {
    try {
      const res = await fetch(`${env.MCJARS_API_URL.replace(/\/$/, '')}/builds/${name}`, { headers: { Accept: 'application/json', 'User-Agent': 'server-software-installer/1' }, signal: AbortSignal.timeout(10_000), redirect: 'error' });
      if (!res.ok) return null;
      const data = (await res.json()) as { success?: boolean; builds?: Record<string, DirectoryVersion> };
      if (!data.success || !data.builds || typeof data.builds !== 'object' || Array.isArray(data.builds)) return null;
      cache.set(name, { at: Date.now(), versions: data.builds });
      return data.builds;
    } catch {
      return null;
    } finally {
      loading.delete(name);
    }
  })();
  loading.set(name, task);
  return task;
}

/** Alle Einträge eines Typs (für die Einrichtung). Wirft, wenn das Verzeichnis nicht erreichbar ist und nichts gemerkt wurde. */
export async function softwareDirectory(serverType: string): Promise<Record<string, DirectoryVersion>> {
  const name = DIRECTORY_TYPES[serverType];
  if (!name) throw unavailable();
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.versions;
  // Lieber einen etwas älteren Stand als gar keinen
  const fresh = (await refresh(name)) ?? hit?.versions;
  if (!fresh) throw unavailable();
  return fresh;
}

/** Veröffentlichte Versionen (keine Vorabversionen), die sich einrichten lassen – neueste zuerst */
const releasesFrom = (versions: Record<string, DirectoryVersion>): string[] =>
  Object.entries(versions)
    .filter(([id, v]) => v.type === 'RELEASE' && !!v.latest && /^[\w.-]{1,24}$/.test(id))
    .map(([id]) => id)
    .reverse();

const pick = (settings: Pick<SiteSettings, 'versions'>, typeId: string, releases: string[] | null): string[] => {
  // Eine im Admin-Bereich gepflegte eigene Liste gilt immer genau so
  const custom = settings.versions[typeId];
  if (custom && custom.length) return custom;
  if (!releases || releases.length === 0) return versionsFor(settings, typeId);
  const preferred = getServerType(typeId)?.defaultVersion;
  // „latest“ zuerst – außer der Typ hat eine andere Vorauswahl (z. B. Forge)
  return preferred && preferred !== 'latest' && releases.includes(preferred) ? [preferred, 'latest', ...releases.filter((v) => v !== preferred)] : ['latest', ...releases];
};

/**
 * Wählbare Versionen eines Servertyps – ohne zu warten: der gemerkte Stand des Verzeichnisses (wird im Hintergrund
 * aufgefrischt), sonst unsere fest hinterlegte Liste. Für Antworten, die nie auf das Verzeichnis warten dürfen.
 */
export function offeredVersionsCached(settings: Pick<SiteSettings, 'versions'>, typeId: string): string[] {
  const name = DIRECTORY_TYPES[typeId];
  if (!name) return versionsFor(settings, typeId);
  const hit = cache.get(name);
  if (!hit || Date.now() - hit.at >= FRESH_MS) void refresh(name);
  return pick(settings, typeId, hit ? releasesFrom(hit.versions) : null);
}

/** Wählbare Versionen eines Servertyps – wartet kurz auf das Verzeichnis, wenn noch nichts gemerkt ist (für die Prüfung einer Eingabe) */
export async function offeredVersions(settings: Pick<SiteSettings, 'versions'>, typeId: string): Promise<string[]> {
  if (!DIRECTORY_TYPES[typeId]) return versionsFor(settings, typeId);
  const versions = await softwareDirectory(typeId).catch(() => null);
  return pick(settings, typeId, versions ? releasesFrom(versions) : null);
}
