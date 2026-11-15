/**
 * ============================================================================
 *  CraftingHosting.free – zentrale Produktkonfiguration
 * ============================================================================
 *
 *  ACHTUNG: Diese Datei enthält nur die STANDARDWERTE für eine frische
 *  Installation (und den Notbehelf, falls die API kurz nicht erreichbar ist).
 *  Pakete, Plätze, Fair-Use-Regeln, Laufzeit, Limits, Standorte und Hardware
 *  werden im Admin-Bereich gepflegt und in der Datenbank gespeichert – die
 *  LIVE-WERTE WEICHEN DAHER VON DIESER DATEI AB.
 *
 *  Aktueller Stand der Live-Seite (immer hier nachsehen, nie hier ableiten):
 *    – https://craftinghosting.free/llms.txt   (lesbar, bei jedem Abruf neu erzeugt)
 *    – GET /api/v1/site                         (dieselben Daten als JSON)
 *
 *  Direkt aus dieser Datei kommen nur die Servertypen/Versionen sowie die
 *  Netzwerk- und Speicherangabe der Hardware. Nach Änderungen: API/Worker neu
 *  starten und die Website neu bauen.
 *
 *  Deployment-spezifische Pterodactyl-Werte (Egg-IDs, Locations …) liegen
 *  bewusst NICHT hier, sondern in apps/api/src/config/pterodactyl.config.ts
 *  bzw. in der .env – sie werden nie an den Browser ausgeliefert.
 * ============================================================================
 */

import type { Localized } from '../i18n';

/** Produkt: Minecraft-Server oder Discord-Bot */
export const productKinds = ['minecraft', 'discord'] as const;
export type ProductKind = (typeof productKinds)[number];

export function isProductKind(value: unknown): value is ProductKind {
  return typeof value === 'string' && (productKinds as readonly string[]).includes(value);
}

/**
 * Ein Paket. Die Liste unten sind nur die STANDARD-Pakete – im Admin-Bereich
 * (Einstellungen → Pakete) lassen sich eigene Pakete anlegen, ändern und entfernen.
 */
export interface PlanConfig {
  /** Stabile ID – wird in der Datenbank gespeichert, nicht nachträglich ändern. */
  id: string;
  name: string;
  tagline: Localized;
  /** RAM in MB (Pterodactyl "memory"). */
  memoryMb: number;
  /** CPU-Limit in Prozent (Pterodactyl "cpu"; 100 = 1 Thread). */
  cpuPercent: number;
  /** Anzeige-Text für die CPU-Ressourcen. */
  cpuLabel: Localized;
  /** Speicher in MB (Pterodactyl "disk"). */
  diskMb: number;
  swapMb: number;
  /** Block-IO-Gewichtung 10–1000 (Pterodactyl "io"). */
  ioWeight: number;
  /** Pterodactyl Feature-Limits */
  databases: number;
  backups: number;
  allocations: number;
  /** Hervorgehobene Karte auf der Website */
  highlighted?: boolean;
  /** Maximale Anzahl gleichzeitig existierender Server dieses Pakets (null = unbegrenzt). */
  capacity: number | null;
  /** Zusätzliche Stichpunkte auf der Paketkarte */
  features: Localized[];
}

export interface ServerTypeConfig {
  id: string;
  /** Zu welchem Produkt der Typ gehört (Minecraft-Software bzw. Laufzeit eines Discord-Bots) */
  kind: ProductKind;
  name: string;
  description: Localized;
  /** Auswählbare Versionen. "latest" = neueste vom Egg unterstützte Version. */
  versions: string[];
  defaultVersion: string;
  recommended?: boolean;
}

export interface FairUseRules {
  timezone: string;
  /** 0 = Sonntag, 1 = Montag … */
  weekStartsOn: number;
  maxSessionHours: number;
  sessionWarningMinutes: number;
  cooldownMinutes: number;
  weeklyOfflineHours: number;
  weeklyOfflineWarningHours: number;
  minStartWindowMinutes: number;
}

export interface CycleRules {
  days: number;
  reminderDaysBefore: number[];
  maxReactivations: number | null;
  reactivationCooldownMinutes: number;
  /** Ohne Reaktivierung wird der Server so viele Stunden nach dem Ende der Ruhezeit gelöscht (0 = nie) */
  deleteAfterRestHours: number;
  /** Erinnerung per E-Mail so viele Stunden vor der Löschung */
  deleteReminderHours: number;
  stopGraceSeconds: number;
}

export interface FreeHostingConfig {
  brand: {
    parentName: string;
    parentDisplayName: string;
    productName: string;
    domain: string;
    tagline: string;
    poweredBy: string;
    parentUrl: string;
    parentPricingUrl: string;
    statusUrl: string;
    discordUrl: string;
    /** Öffentliche Adresse des Pterodactyl-Panels */
    panelUrl: string;
    supportEmail: string;
  };
  hardware: {
    /** Rechenzentrums-Standorte (Ländercode + Name) */
    locations: { code: string; name: Localized }[];
    cpus: string[];
    network: string;
    storage: string;
    note: Localized;
  };
  /** Standard-Pakete für Minecraft (im Admin-Bereich änderbar) */
  plans: PlanConfig[];
  /** Standard-Pakete für Discord-Bots (im Admin-Bereich änderbar, höchstens `maxDiscordPlans`) */
  discordPlans: PlanConfig[];
  /** Standard-Kapazität je Produkt (im Admin-Bereich änderbar, null = unbegrenzt) */
  capacity: Record<ProductKind, number | null>;
  fairUse: FairUseRules;
  cycle: CycleRules;
  limits: {
    maxServersPerUser: number;
    requireVerifiedEmail: boolean;
    serverNameMinLength: number;
    serverNameMaxLength: number;
    maxMinecraftPlans: number;
    maxDiscordPlans: number;
  };
  serverTypes: ServerTypeConfig[];
}

export const freeHostingConfig: FreeHostingConfig = {
  brand: {
    /** Hauptmarke */
    parentName: 'CraftingHosting',
    parentDisplayName: 'Crafting Hosting',
    /** Name / Domain des kostenlosen Angebots */
    productName: 'CraftingHosting.free',
    domain: 'craftinghosting.free',
    tagline: 'Free Minecraft & Discord Bot Hosting',
    poweredBy: 'A CraftingHosting Service',
    /** Standard-Links – können per NEXT_PUBLIC_* Umgebungsvariablen überschrieben werden. */
    parentUrl: 'https://crafting.host',
    parentPricingUrl: 'https://crafting.host/pricing',
    statusUrl: 'https://status.crafting.host',
    discordUrl: 'https://discord.gg/x6mUFN8wjA',
    panelUrl: 'https://panel.craftinghosting.free',
    supportEmail: 'support@craftinghosting.free',
  },

  /** Hardware, auf der das FreeHosting läuft. Ehrlich halten – keine Garantien. */
  hardware: {
    /** Standardwerte – Standorte und CPUs sind im Admin-Bereich änderbar */
    locations: [{ code: 'DE', name: { de: 'Deutschland', en: 'Germany' } }],
    cpus: ['Dual Intel Xeon Gold 6230'],
    network: '2 × 10 Gbit/s Uplink (LACP)',
    storage: 'NVMe SSD',
    note: {
      de: 'Ressourcen werden fair zwischen allen kostenlosen Servern eines Nodes geteilt. Die angegebenen Werte sind Obergrenzen, keine garantierte Dauerleistung.',
      en: 'Resources are shared fairly between all free servers on a node. The values shown are upper limits, not guaranteed sustained performance.',
    },
  },

  plans: [
    {
      id: 'free-4gb',
      name: 'Free 4 GB',
      tagline: { de: 'Für kleine Gruppen & Vanilla-Welten', en: 'For small groups & vanilla worlds' },
      memoryMb: 4096,
      cpuPercent: 100,
      cpuLabel: { de: 'Begrenzte, geteilte CPU (bis zu 1 Thread)', en: 'Limited shared CPU (up to 1 thread)' },
      diskMb: 10240,
      swapMb: 0,
      ioWeight: 500,
      databases: 0,
      backups: 1,
      allocations: 1,
      capacity: null,
      features: [
        { de: 'Minecraft Server', en: 'Minecraft server' },
        { de: 'Pterodactyl Panel', en: 'Pterodactyl panel' },
        { de: 'Automatisches Backup', en: 'Automatic backup' },
      ],
    },
    {
      id: 'free-6gb',
      name: 'Free 6 GB',
      tagline: { de: 'Mehr Luft für Plugins & Mods', en: 'More headroom for plugins & mods' },
      memoryMb: 6144,
      cpuPercent: 150,
      cpuLabel: { de: 'Mehr geteilte CPU (bis zu 1,5 Threads)', en: 'More shared CPU (up to 1.5 threads)' },
      diskMb: 15360,
      swapMb: 0,
      ioWeight: 500,
      databases: 0,
      backups: 2,
      allocations: 1,
      highlighted: true,
      capacity: null,
      features: [
        { de: 'Minecraft Server', en: 'Minecraft server' },
        { de: 'Pterodactyl Panel', en: 'Pterodactyl panel' },
        { de: 'Automatische Backups', en: 'Automatic backups' },
      ],
    },
  ],

  /** Standard-Pakete für Discord-Bots (Python oder Node.js) – höchstens vier */
  discordPlans: [
    {
      id: 'bot-256mb',
      name: 'Bot 256 MB',
      tagline: { de: 'Für kleine Bots und erste Projekte', en: 'For small bots and first projects' },
      memoryMb: 256,
      cpuPercent: 25,
      cpuLabel: { de: 'Geteilte CPU (bis zu 0,25 Threads)', en: 'Shared CPU (up to 0.25 threads)' },
      diskMb: 1024,
      swapMb: 0,
      ioWeight: 500,
      databases: 0,
      backups: 0,
      allocations: 1,
      capacity: null,
      features: [],
    },
    {
      id: 'bot-512mb',
      name: 'Bot 512 MB',
      tagline: { de: 'Der Standard für die meisten Bots', en: 'The default for most bots' },
      memoryMb: 512,
      cpuPercent: 50,
      cpuLabel: { de: 'Geteilte CPU (bis zu 0,5 Threads)', en: 'Shared CPU (up to 0.5 threads)' },
      diskMb: 2048,
      swapMb: 0,
      ioWeight: 500,
      databases: 0,
      backups: 1,
      allocations: 1,
      highlighted: true,
      capacity: null,
      features: [],
    },
    {
      id: 'bot-1gb',
      name: 'Bot 1 GB',
      tagline: { de: 'Für Bots mit Datenbank oder Musik', en: 'For bots with a database or music' },
      memoryMb: 1024,
      cpuPercent: 75,
      cpuLabel: { de: 'Geteilte CPU (bis zu 0,75 Threads)', en: 'Shared CPU (up to 0.75 threads)' },
      diskMb: 3072,
      swapMb: 0,
      ioWeight: 500,
      databases: 0,
      backups: 1,
      allocations: 1,
      capacity: null,
      features: [],
    },
    {
      id: 'bot-2gb',
      name: 'Bot 2 GB',
      tagline: { de: 'Für große Bots auf vielen Servern', en: 'For large bots on many servers' },
      memoryMb: 2048,
      cpuPercent: 100,
      cpuLabel: { de: 'Geteilte CPU (bis zu 1 Thread)', en: 'Shared CPU (up to 1 thread)' },
      diskMb: 5120,
      swapMb: 0,
      ioWeight: 500,
      databases: 0,
      backups: 1,
      allocations: 1,
      capacity: null,
      features: [],
    },
  ],

  /** Plätze je Produkt: 500 Minecraft-Server + 200 Discord-Bots */
  capacity: { minecraft: 500, discord: 200 },

  /**
   * Fair-Use-System ("24-Stunden-Aktivsystem")
   * – Ein Server darf am Stück höchstens `maxSessionHours` laufen.
   * – Danach wird er automatisch gestoppt und ist `cooldownMinutes` pausiert.
   * – Pro Woche (Mo 00:00 – So 24:00, Zeitzone unten) muss er insgesamt
   *   mindestens `weeklyOfflineHours` offline sein. Reicht die Restwoche
   *   nicht mehr aus, wird er rechtzeitig automatisch gestoppt.
   */
  fairUse: {
    timezone: 'Europe/Berlin',
    /** 1 = Montag */
    weekStartsOn: 1,
    maxSessionHours: 24,
    sessionWarningMinutes: 60,
    cooldownMinutes: 60,
    weeklyOfflineHours: 2,
    weeklyOfflineWarningHours: 6,
    /** Start wird blockiert, wenn weniger als so viele Minuten bis zur Pflicht-Offline-Zeit bleiben. */
    minStartWindowMinutes: 15,
  },

  /** 30-Tage-Lebenszyklus */
  cycle: {
    days: 30,
    /** Erinnerungen X Tage vor Ablauf */
    reminderDaysBefore: [3, 1],
    /** null = beliebig oft reaktivierbar */
    maxReactivations: null,
    /** Ruhezeit nach Ablauf: Mindestabstand zwischen Suspendierung und Reaktivierung (1440 = 1 Ruhetag, 0 = keine) */
    reactivationCooldownMinutes: 1440,
    /** Nach dem Ruhetag bleiben 48 h zum Reaktivieren – danach wird der Server samt Welt gelöscht */
    deleteAfterRestHours: 48,
    deleteReminderHours: 24,
    /** Wartezeit auf sauberes Herunterfahren, bevor der Prozess beendet wird */
    stopGraceSeconds: 120,
  },

  limits: {
    maxServersPerUser: 1,
    requireVerifiedEmail: true,
    serverNameMinLength: 3,
    serverNameMaxLength: 32,
    maxMinecraftPlans: 12,
    maxDiscordPlans: 4,
  },

  serverTypes: [
    {
      id: 'paper',
      kind: 'minecraft',
      name: 'Paper',
      description: { de: 'Performanter Standard mit Bukkit/Spigot-Plugin-Support.', en: 'Fast default with Bukkit/Spigot plugin support.' },
      versions: ['latest', '26.3', '26.2', '26.1.2', '1.21.11', '1.21.8', '1.21.4', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.8'],
      defaultVersion: 'latest',
      recommended: true,
    },
    {
      id: 'purpur',
      kind: 'minecraft',
      name: 'Purpur',
      description: { de: 'Paper-Fork mit vielen zusätzlichen Gameplay-Optionen.', en: 'Paper fork with many extra gameplay options.' },
      versions: ['latest', '26.3', '26.2', '1.21.11', '1.21.8', '1.21.4', '1.20.6', '1.20.4', '1.19.4', '1.18.2', '1.16.5'],
      defaultVersion: 'latest',
    },
    {
      id: 'vanilla',
      kind: 'minecraft',
      name: 'Vanilla',
      description: { de: 'Der offizielle Minecraft-Server – ohne Plugins und Mods.', en: 'The official Minecraft server – no plugins or mods.' },
      versions: ['latest', '26.3', '26.2', '26.1.2', '1.21.11', '1.21.8', '1.21.4', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.9'],
      defaultVersion: 'latest',
    },
    {
      id: 'fabric',
      kind: 'minecraft',
      name: 'Fabric',
      description: { de: 'Leichtgewichtiger Mod-Loader für moderne Versionen.', en: 'Lightweight mod loader for modern versions.' },
      versions: ['latest', '26.3', '26.2', '1.21.11', '1.21.8', '1.21.4', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5'],
      defaultVersion: 'latest',
    },
    {
      id: 'forge',
      kind: 'minecraft',
      name: 'Forge',
      description: { de: 'Klassischer Mod-Loader für große Modpacks.', en: 'Classic mod loader for large modpacks.' },
      versions: ['latest', '1.21.1', '1.20.1', '1.19.2', '1.18.2', '1.16.5', '1.12.2'],
      defaultVersion: '1.20.1',
    },
    {
      id: 'python',
      kind: 'discord',
      name: 'Python',
      description: { de: 'Für Bots mit discord.py, Pycord, nextcord & Co.', en: 'For bots built with discord.py, Pycord, nextcord & co.' },
      versions: ['latest'],
      defaultVersion: 'latest',
      recommended: true,
    },
    {
      id: 'nodejs',
      kind: 'discord',
      name: 'Node.js',
      description: { de: 'Für Bots mit discord.js, Eris, Sapphire & Co. (JavaScript/TypeScript).', en: 'For bots built with discord.js, Eris, Sapphire & co. (JavaScript/TypeScript).' },
      versions: ['latest'],
      defaultVersion: 'latest',
    },
  ],
};

export const serverTypes: readonly ServerTypeConfig[] = freeHostingConfig.serverTypes;

/** Servertypen eines Produkts (Minecraft: Paper, Vanilla … · Discord: Python, Node.js) */
export function serverTypesOf(kind: ProductKind): ServerTypeConfig[] {
  return serverTypes.filter((t) => t.kind === kind);
}

export function getServerType(id: string): ServerTypeConfig | undefined {
  return serverTypes.find((t) => t.id === id);
}
