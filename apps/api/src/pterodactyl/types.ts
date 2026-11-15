import type { PowerAction, PowerState } from '@chfree/shared';

export interface PteroUser {
  id: number;
  externalId: string | null;
  email: string;
  username: string;
}

export interface PteroServer {
  id: number;
  uuid: string;
  identifier: string;
  externalId: string | null;
  name: string;
  description: string;
  /** Pterodactyl-User-ID des Besitzers */
  userId: number;
  suspended: boolean;
  /** "installing" | "install_failed" | "suspended" | "restoring_backup" | null */
  status: string | null;
  allocation: { ip: string; alias: string | null; port: number } | null;
}

export interface PteroResources {
  state: PowerState;
  isSuspended: boolean;
  memoryBytes: number;
  cpuAbsolute: number;
  diskBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  uptimeMs: number;
}

export interface PteroEgg {
  id: number;
  dockerImage: string;
  startup: string;
  variables: { envVariable: string; defaultValue: string }[];
}

export interface PteroNode {
  id: number;
  name: string;
  fqdn: string;
  /** Adresse von Wings (Schema, Host, Port) – null, wenn unbekannt (z. B. im Mock-Modus) */
  daemonUrl: string | null;
  maintenanceMode: boolean;
  locationId: number;
  memoryMb: number;
  diskMb: number;
  /** Bereits an Server vergebener Arbeitsspeicher/Speicherplatz (fehlt, wenn das Panel es nicht meldet) */
  allocatedMemoryMb?: number;
  allocatedDiskMb?: number;
  /** Erlaubte Überbuchung in Prozent laut Panel (-1 = unbegrenzt) */
  memoryOverallocate?: number;
  diskOverallocate?: number;
}

export interface PteroLocation {
  id: number;
  short: string;
  long: string;
}

/** Egg aus der Übersicht aller Nests (für die automatische Erkennung im Admin-Bereich) */
export interface PteroEggSummary {
  nestId: number;
  nestName: string;
  eggId: number;
  name: string;
  description: string;
  dockerImages: string[];
}

export interface CreateServerSpec {
  externalId: string;
  name: string;
  description: string;
  userId: number;
  eggId: number;
  dockerImage: string;
  startup: string;
  environment: Record<string, string>;
  limits: { memory: number; swap: number; disk: number; io: number; cpu: number };
  featureLimits: { databases: number; allocations: number; backups: number };
  /** Automatische Platzierung über Locations (wenn keine feste Allokation angegeben ist) */
  locationIds: number[];
  /** Feste Allokation auf einer bestimmten Node – hat Vorrang vor den Locations */
  allocationId?: number;
  startOnCompletion: boolean;
}

export interface BackupScheduleSpec {
  name: string;
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
  onlyWhenOnline: boolean;
}

/**
 * Abstraktion über die Pterodactyl-API.
 *  – Application API (ptla_…): Benutzer, Server, Suspendierung, Nodes
 *  – Client API (ptlc_… eines Admin-Accounts): Power-Aktionen, Ressourcen, Zeitpläne
 */
export interface PterodactylGateway {
  readonly mode: 'live' | 'mock';

  findUserByExternalId(externalId: string): Promise<PteroUser | null>;
  findUserByEmail(email: string): Promise<PteroUser | null>;
  /** Ohne Passwort verschickt Pterodactyl eine Einladung zum Setzen des Passworts. */
  createUser(input: {
    externalId: string;
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    password?: string;
  }): Promise<PteroUser>;

  findServerByExternalId(externalId: string): Promise<PteroServer | null>;
  getServer(id: number): Promise<PteroServer | null>;
  createServer(spec: CreateServerSpec): Promise<PteroServer>;
  suspendServer(id: number): Promise<void>;
  unsuspendServer(id: number): Promise<void>;
  deleteServer(id: number): Promise<void>;
  /** Beschreibung im Panel setzen (Name/Besitzer bleiben unverändert). */
  updateServerDescription(id: number, description: string): Promise<void>;
  /** Slots eines bestehenden Servers ändern (Datenbanken, Ports, Backups) – Ressourcen und Port bleiben unverändert */
  updateServerFeatureLimits(id: number, limits: { databases: number; allocations: number; backups: number }): Promise<void>;

  getEgg(nestId: number, eggId: number): Promise<PteroEgg>;
  listNodes(): Promise<PteroNode[]>;
  listLocations(): Promise<PteroLocation[]>;
  /** Alle Eggs aller Nests */
  listEggs(): Promise<PteroEggSummary[]>;
  /** Freie Allokationen (Ports) einer Node: Anzahl und die erste freie ID */
  freeAllocations(nodeId: number): Promise<{ count: number; firstId: number | null }>;
  /** Prüft den Client-API-Key */
  pingClient(): Promise<void>;

  getResources(identifier: string): Promise<PteroResources>;
  sendPowerSignal(identifier: string, signal: PowerAction): Promise<void>;
  /** Konsolenbefehl senden (z. B. `say …` für In-Game-Hinweise). */
  sendCommand(identifier: string, command: string): Promise<void>;
  createBackupSchedule(identifier: string, spec: BackupScheduleSpec): Promise<number>;
  /** Textdatei eines Servers lesen, z. B. `/eula.txt` (null = Datei gibt es nicht) */
  readFile(identifier: string, path: string): Promise<string | null>;
  /** Textdatei eines Servers schreiben (legt sie bei Bedarf an) */
  writeFile(identifier: string, path: string, content: string): Promise<void>;

  /** Erreichbarkeit in ms */
  ping(): Promise<number>;
}

export class PterodactylError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}
