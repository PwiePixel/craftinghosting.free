/**
 * Verzeichnis der Minecraft-Server-Software (MCJars): welche Versionen es je Servertyp gibt und wie sie eingerichtet
 * werden. Daraus kommt die Versionsauswahl (Website und Partner-API) und die Einrichtung über die Partner-API.
 *
 * Das Verzeichnis wird zwischengespeichert. Ist es nicht erreichbar, gilt der letzte bekannte Stand – und wenn es noch
 * keinen gibt, unsere fest hinterlegte Liste.
 */
import { getServerType, versionsFor, type SiteSettings } from '@chfree/shared';
import type { SoftwareJob } from '../db/schema';
import { env } from '../env';
import { Errors, L } from '../lib/errors';

/** Bezeichnung eines Servertyps im Verzeichnis (aus dem Software-Katalog) – null = dort nicht vorhanden */
export const directoryName = (serverType: string): string | null => {
  const name = getServerType(serverType)?.directory;
  return name && /^[A-Z][A-Z0-9_]{1,23}$/.test(name) ? name : null;
};

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
  const name = directoryName(serverType);
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
  const name = directoryName(typeId);
  if (!name) return versionsFor(settings, typeId);
  const hit = cache.get(name);
  if (!hit || Date.now() - hit.at >= FRESH_MS) void refresh(name);
  return pick(settings, typeId, hit ? releasesFrom(hit.versions) : null);
}

/** Wählbare Versionen eines Servertyps – wartet kurz auf das Verzeichnis, wenn noch nichts gemerkt ist (für die Prüfung einer Eingabe) */
export async function offeredVersions(settings: Pick<SiteSettings, 'versions'>, typeId: string): Promise<string[]> {
  if (!directoryName(typeId)) return versionsFor(settings, typeId);
  const versions = await softwareDirectory(typeId).catch(() => null);
  return pick(settings, typeId, versions ? releasesFrom(versions) : null);
}

/**
 * Auftrag für einen Server der Website: Typ und Version stehen fest, die Schritte schlägt der Job nach
 * (so scheitert das Erstellen eines Servers nie daran, dass das Verzeichnis gerade nicht erreichbar ist).
 */
export const pendingSoftwareJob = (serverType: string, version: string, waitInstall: boolean): SoftwareJob => ({
  serverType,
  version,
  resolvedVersion: version,
  build: '',
  java: null,
  steps: [],
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


/* ---- Übersicht für den Admin-Bereich: welche Software das Verzeichnis kennt ---- */

export interface DirectoryTypeInfo {
  id: string;
  name: string;
  group: string;
  deprecated: boolean;
  experimental: boolean;
  /** Zahl der Minecraft-Versionen (0 = z. B. ein Proxy, der nicht an eine Minecraft-Version gebunden ist) */
  versions: number;
}

let typesCache: { at: number; list: DirectoryTypeInfo[] } | null = null;

/** Alle Software-Arten des Verzeichnisses (eine Stunde gemerkt). null = gerade nicht erreichbar und nichts gemerkt. */
export async function directoryTypes(): Promise<DirectoryTypeInfo[] | null> {
  if (typesCache && Date.now() - typesCache.at < 60 * 60_000) return typesCache.list;
  try {
    const res = await fetch(`${env.MCJARS_API_URL.replace(/\/$/, '')}/types`, { headers: { Accept: 'application/json', 'User-Agent': 'server-software-installer/1' }, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { success?: boolean; types?: Record<string, Record<string, { name?: string; deprecated?: boolean; experimental?: boolean; versions?: { minecraft?: number } }>> };
    if (!data.success || !data.types) throw new Error('unerwartete Antwort');
    const list: DirectoryTypeInfo[] = [];
    for (const [group, entries] of Object.entries(data.types)) {
      for (const [id, t] of Object.entries(entries ?? {})) {
        if (!/^[A-Z][A-Z0-9_]{1,23}$/.test(id)) continue;
        list.push({ id, name: String(t.name ?? id).slice(0, 40), group, deprecated: !!t.deprecated, experimental: !!t.experimental, versions: Number(t.versions?.minecraft ?? 0) });
      }
    }
    typesCache = { at: Date.now(), list };
    return list;
  } catch {
    return typesCache?.list ?? null;
  }
}
