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

export interface EggMapping {
  nestId: number;
  eggId: number;
  /** Egg-Variable, die die Minecraft-Version steuert */
  versionVariable: string;
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

export function getEggMapping(serverType: string): EggMapping | null {
  const override = fromEnv(serverType);
  if (override !== undefined) return override;
  return defaults[serverType] ?? null;
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
