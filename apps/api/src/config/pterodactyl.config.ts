/**
 * ============================================================================
 *  Pterodactyl-Zuordnung (nur serverseitig)
 * ============================================================================
 *
 *  Ordnet jedem Servertyp aus freehosting.config.ts ein Pterodactyl-Egg zu.
 *  Startbefehl, Docker-Image und Standard-Variablen werden automatisch aus
 *  dem Egg gelesen – hier wird nur die Versions-Variable überschrieben.
 *
 *  Egg-IDs können pro Umgebung per .env überschrieben werden:
 *    PTERODACTYL_EGG_PAPER=1:3        (Format  nestId:eggId)
 *
 *  Servertypen ohne gültige Egg-Zuordnung werden im Assistenten automatisch
 *  als "nicht verfügbar" angezeigt.
 *
 *  Standard-Installation von Pterodactyl (Nest 1 "Minecraft"):
 *    2 = Forge, 3 = Paper, 5 = Vanilla
 *  Purpur und Fabric müssen als Eggs importiert werden
 *  (z. B. aus github.com/pelican-eggs/minecraft) – danach IDs eintragen.
 * ============================================================================
 */

import { DIRECTORY_NOT_GAME_SERVERS, getServerType, type EggRef, type SiteSettings } from '@chfree/shared';

export interface EggMapping {
  nestId: number;
  eggId: number;
  /** Egg-Variable, die die Minecraft-Version steuert (Discord-Bots: keine) */
  versionVariable?: string;
  /** Optional: fester Docker-Image-Eintrag, sonst Standard des Eggs */
  dockerImage?: string;
  /** Optional: zusätzliche/überschriebene Egg-Variablen */
  environment?: Record<string, string>;
}

const defaults: Record<string, EggMapping | null> = {
  paper: { nestId: 1, eggId: 3, versionVariable: 'MINECRAFT_VERSION' },
  vanilla: { nestId: 1, eggId: 5, versionVariable: 'VANILLA_VERSION' },
  forge: { nestId: 1, eggId: 2, versionVariable: 'MC_VERSION' },
  // Nach dem Import der Eggs IDs setzen oder per .env überschreiben:
  purpur: null,
  fabric: null,
};

const versionVariables: Record<string, string> = {
  paper: 'MINECRAFT_VERSION',
  purpur: 'MINECRAFT_VERSION',
  vanilla: 'VANILLA_VERSION',
  fabric: 'MC_VERSION',
  forge: 'MC_VERSION',
  neoforge: 'MC_VERSION',
  quilt: 'MC_VERSION',
};

function fromEnv(type: string): EggMapping | null | undefined {
  const raw = process.env[`PTERODACTYL_EGG_${type.toUpperCase()}`];
  if (raw === undefined || raw === '') return undefined;
  if (raw === 'off' || raw === 'none') return null;
  const [nest, egg] = raw.split(':').map((v) => Number(v.trim()));
  if (!nest || !egg) return undefined;
  return {
    nestId: nest,
    eggId: egg,
    versionVariable: process.env[`PTERODACTYL_EGG_${type.toUpperCase()}_VERSION_VAR`] || versionVariables[type] || 'MINECRAFT_VERSION',
    dockerImage: process.env[`PTERODACTYL_EGG_${type.toUpperCase()}_IMAGE`] || undefined,
  };
}

/**
 * Egg für einen Servertyp. Reihenfolge:
 *  1. Zuordnung aus dem Admin-Bereich (Admin → Pterodactyl, automatisch erkannte Eggs)
 *  2. .env (PTERODACTYL_EGG_<TYP>)
 *  3. Standardwerte oben (nur Minecraft)
 */
export function getEggMapping(serverType: string, settings?: Pick<SiteSettings, 'products'>): EggMapping | null {
  const kind = getServerType(serverType)?.kind;
  // Nur eigene Einträge – sonst läse z. B. die Kennung „constructor“ Werte von Object.prototype
  const eggs = kind ? settings?.products[kind].eggs : undefined;
  const chosen = eggs && Object.hasOwn(eggs, serverType) ? eggs[serverType] : undefined;
  if (chosen) {
    return {
      nestId: chosen.nestId,
      eggId: chosen.eggId,
      // Reihenfolge: Angabe im Software-Katalog → .env → übliche Variable des Typs (sonst wird sie am Egg erkannt)
      versionVariable: kind === 'minecraft' ? getServerType(serverType)?.versionVariable || process.env[`PTERODACTYL_EGG_${serverType.toUpperCase()}_VERSION_VAR`] || versionVariables[serverType] : undefined,
    };
  }
  const override = fromEnv(serverType);
  if (override !== undefined) return override && kind === 'discord' ? { ...override, versionVariable: undefined } : override;
  return Object.hasOwn(defaults, serverType) ? (defaults[serverType] ?? null) : null;
}

/** Servertyp, dessen Egg als Grundlage für alle Minecraft-Typen ohne eigenes Egg dient */
export const BASE_SERVER_TYPE = 'paper';

type EggSettings = Pick<SiteSettings, 'products'> & Partial<Pick<SiteSettings, 'softwareBase'>>;

/**
 * Grundlage für alles, was über das Software-Verzeichnis eingerichtet wird: das im Admin-Bereich gewählte Egg –
 * ohne Auswahl das Egg, das dem Typ Paper zugeordnet ist.
 */
export function baseEggMapping(settings?: EggSettings): EggMapping | null {
  const chosen = settings?.softwareBase;
  if (chosen) return { nestId: chosen.nestId, eggId: chosen.eggId };
  return getEggMapping(BASE_SERVER_TYPE, settings);
}

/**
 * Wie kommt die Software dieses Typs auf den Server?
 *  – 'egg': über das zugeordnete Egg im Panel
 *  – 'directory': Das Panel legt den Server mit dem Grundlage-Egg an; danach richten wir die Software aus dem
 *    Software-Verzeichnis ein (services/partner-software.service.ts)
 *  – null: gerade nicht möglich (kein Egg zugeordnet bzw. nicht im Verzeichnis)
 * Die gewünschte Art steht im Software-Katalog (Admin → Server-Software): „automatisch“ nimmt ein eigenes Egg, wenn
 * eines zugeordnet ist – sonst (oder wenn dem Typ dasselbe Egg wie der Grundlage zugeordnet ist) das Verzeichnis.
 * Bedrock und Proxys (eggOnly) laufen immer und nur über ein eigenes Egg.
 */
export function installMethodOf(serverType: string, settings?: EggSettings): 'egg' | 'directory' | null {
  const type = getServerType(serverType);
  if (!type) return null;
  const own = getEggMapping(serverType, settings);
  if (type.kind !== 'minecraft' || type.eggOnly || type.edition === 'bedrock' || !type.directory || DIRECTORY_NOT_GAME_SERVERS.includes(type.directory.toUpperCase())) return own ? 'egg' : null;
  // Ohne eigens gewählte Grundlage ist das Egg von Paper die Grundlage – Paper selbst kommt dann einfach aus seinem Egg
  if (serverType === BASE_SERVER_TYPE && !settings?.softwareBase) return own ? 'egg' : null;
  const base = baseEggMapping(settings);
  const sameAsBase = !!own && !!base && own.nestId === base.nestId && own.eggId === base.eggId;
  const wants = type.install ?? 'auto';
  if (wants === 'directory') return base ? 'directory' : null;
  if (wants === 'egg') return own ? 'egg' : null;
  if (own && !sameAsBase) return 'egg';
  if (base) return 'directory';
  return own ? 'egg' : null;
}

/**
 * Variable des Eggs, in die die gewünschte Version gehört. Ist die eingestellte im Egg nicht vorhanden (z. B. bei einem
 * eigenen Egg für Bedrock), wird sie erkannt: die üblichen Namen zuerst, sonst die erste Variable, die auf „VERSION“ endet.
 */
export function versionVariableIn(configured: string | undefined, variables: { envVariable: string }[]): string | undefined {
  const names = variables.map((v) => v.envVariable);
  if (configured && names.includes(configured)) return configured;
  const usual = ['MINECRAFT_VERSION', 'MC_VERSION', 'VANILLA_VERSION', 'BEDROCK_VERSION', 'NUKKIT_VERSION', 'PMMP_VERSION', 'SERVER_VERSION'];
  const loader = /^(FORGE|NEOFORGE|FABRIC|QUILT|LOADER|INSTALLER|BUILD|JAVA)_/;
  return usual.find((n) => names.includes(n)) ?? names.find((n) => n.endsWith('_VERSION') && !loader.test(n)) ?? names.find((n) => n === 'VERSION');
}

/** Erkennt passende Eggs anhand ihres Namens (Vorschlag für den Admin-Bereich) */
const eggPatterns: Record<string, RegExp[]> = {
  paper: [/^paper$/i, /paper/i],
  purpur: [/purpur/i],
  vanilla: [/vanilla/i],
  fabric: [/fabric/i],
  forge: [/^forge/i, /(?<!neo)forge/i],
  neoforge: [/neoforge/i],
  quilt: [/quilt/i],
  spigot: [/^spigot/i],
  velocity: [/velocity/i],
  bungeecord: [/bungee/i],
  folia: [/folia/i],
  bedrock: [/vanilla bedrock|bedrock dedicated|^bedrock/i, /bedrock/i],
  pocketmine: [/pocketmine|pmmp/i],
  nukkit: [/nukkit/i],
  python: [/discord.*py|py.*discord/i, /generic.*python|python.*generic/i, /python/i],
  nodejs: [/discord.*(js|node)/i, /generic.*node|node.*generic/i, /node\.?js/i],
};

export function suggestEggs(eggs: { nestId: number; eggId: number; name: string }[]): Record<string, EggRef> {
  const out: Record<string, EggRef> = {};
  for (const [type, patterns] of Object.entries(eggPatterns)) {
    for (const pattern of patterns) {
      const hit = eggs.find((e) => pattern.test(e.name));
      if (hit) {
        out[type] = { nestId: hit.nestId, eggId: hit.eggId, name: hit.name };
        break;
      }
    }
  }
  return out;
}

export const pterodactylConfig = {
  /** Server nach der Installation nicht automatisch starten */
  startOnCompletion: false,
  /** Automatische Backups über einen Pterodactyl-Zeitplan (täglich 04:00 Uhr Panel-Zeit) */
  backupSchedule: {
    enabled: true,
    name: 'CraftingHosting.free – tägliches Backup',
    minute: '0',
    hour: '4',
    dayOfMonth: '*',
    month: '*',
    dayOfWeek: '*',
    onlyWhenOnline: false,
  },
  /** Präfixe für external_id – verhindern doppelte Anlage bei Wiederholungen */
  externalIdPrefix: {
    user: 'chf-user-',
    server: 'chf-server-',
  },
};
