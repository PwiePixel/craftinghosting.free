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
  /** Node, auf der der Server liegt (null = vom Panel nicht gemeldet) */
  nodeId: number | null;
  /** Alle Ports des Servers (der Hauptport zuerst) */
  allocations: PteroAllocation[];
}

/** Backup eines Servers im Panel */
export interface PteroBackup {
  uuid: string;
  name: string;
  bytes: number;
  /** null = wird noch erstellt */
  completedAt: string | null;
  successful: boolean;
  createdAt: string;
}

/** Eintrag in der Dateiliste eines Servers */
export interface PteroFile {
  name: string;
  directory: boolean;
  size: number;
  modifiedAt: string;
}

/** Port (Allokation) im Panel */
export interface PteroAllocation {
  id: number;
  ip: string;
  alias: string | null;
  port: number;
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
  /** Alle Images des Eggs (Anzeigename → Image), z. B. „Java 21“ → ghcr.io/…:java_21 */
  dockerImages: Record<string, string>;
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

  /** E-Mail-Adresse eines Panel-Benutzers ändern (alle übrigen Angaben bleiben) */
  updateUserEmail(id: number, email: string): Promise<void>;

  findServerByExternalId(externalId: string): Promise<PteroServer | null>;
  getServer(id: number): Promise<PteroServer | null>;
  createServer(spec: CreateServerSpec): Promise<PteroServer>;
  suspendServer(id: number): Promise<void>;
  unsuspendServer(id: number): Promise<void>;
  deleteServer(id: number): Promise<void>;
  /** Beschreibung im Panel setzen (Name/Besitzer bleiben unverändert). */
  updateServerDescription(id: number, description: string): Promise<void>;
  /** Ressourcen und Slots eines bestehenden Servers ändern (z. B. Upgrade auf ein größeres Paket) – der Port bleibt */
  updateServerBuild(id: number, limits: { memory: number; disk: number; cpu: number; swap: number; io: number }, featureLimits: { databases: number; allocations: number; backups: number }): Promise<void>;
  /** Slots eines bestehenden Servers ändern (Datenbanken, Ports, Backups) – Ressourcen und Port bleiben unverändert */
  updateServerFeatureLimits(id: number, limits: { databases: number; allocations: number; backups: number }): Promise<void>;

  /**
   * Server auf eine andere Node umziehen (Daten werden mitgenommen). Das bietet nicht jedes Panel per Schnittstelle an
   * (Pelican ja, das klassische Pterodactyl nicht) – dann „unsupported“: Der Umzug muss im Panel gestartet werden.
   */
  transferServer(id: number, nodeId: number, allocationId: number, additionalAllocationIds?: number[]): Promise<'started' | 'unsupported'>;
  /** Laufenden Umzug abbrechen (false = nicht möglich bzw. vom Panel nicht angeboten) */
  cancelServerTransfer(id: number): Promise<boolean>;

  getEgg(nestId: number, eggId: number): Promise<PteroEgg>;
  listNodes(): Promise<PteroNode[]>;
  listLocations(): Promise<PteroLocation[]>;
  /** Alle Eggs aller Nests */
  listEggs(): Promise<PteroEggSummary[]>;
  /** Freie Allokationen (Ports) einer Node: Anzahl und die erste freie ID */
  freeAllocations(nodeId: number): Promise<{ count: number; firstId: number | null }>;
  /** Alle freien Ports einer Node (höchstens 10 000) */
  listFreeAllocations(nodeId: number): Promise<PteroAllocation[]>;
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

  /* ---- Dateien (für die Partner-API: Mods, Plugins, Welten, Einstellungen) ---- */
  listFiles(identifier: string, directory: string): Promise<PteroFile[]>;
  /** Datei mit beliebigem Inhalt schreiben (legt sie bei Bedarf an) */
  writeFileRaw(identifier: string, path: string, content: Buffer): Promise<void>;
  /** Dateien oder Ordner in einem Verzeichnis löschen */
  deleteFiles(identifier: string, root: string, names: string[]): Promise<void>;
  createFolder(identifier: string, root: string, name: string): Promise<void>;
  /** Kurzlebige Adresse, an die eine Datei direkt hochgeladen wird (multipart, Feld „files“) */
  fileUploadUrl(identifier: string): Promise<string>;
  /** Kurzlebige Adresse zum Herunterladen einer Datei */
  fileDownloadUrl(identifier: string, path: string): Promise<string>;
  /** Archiv (zip, tar.gz …) an Ort und Stelle entpacken */
  /** `timeoutMs`: große Archive brauchen länger als die übliche Frist */
  decompressFile(identifier: string, root: string, file: string, timeoutMs?: number): Promise<void>;
  /** Datei von einer Adresse im Internet direkt auf den Server laden */
  /** `background`: nicht auf das Ende des Ladens warten (für große Dateien – der Fortschritt zeigt sich an der Dateigröße) */
  pullFile(identifier: string, url: string, directory: string, filename: string, background?: boolean): Promise<void>;
  /** Server im Panel umbenennen */
  renameServer(id: number, name: string): Promise<void>;

  /* ---- Backups ---- */
  listBackups(identifier: string): Promise<PteroBackup[]>;
  createBackup(identifier: string, name: string): Promise<PteroBackup>;
  backupDownloadUrl(identifier: string, uuid: string): Promise<string>;
  /** Backup einspielen. truncate = vorher alle Dateien des Servers löschen */
  restoreBackup(identifier: string, uuid: string, truncate: boolean): Promise<void>;
  deleteBackup(identifier: string, uuid: string): Promise<void>;

  /* ---- Servertyp/Version wechseln ---- */
  updateServerStartup(id: number, spec: { eggId: number; dockerImage: string; startup: string; environment: Record<string, string> }): Promise<void>;
  /** Installations-Skript erneut ausführen (vorhandene Dateien bleiben, sofern das Egg sie nicht überschreibt) */
  reinstallServer(id: number): Promise<void>;

  /**
   * Zugang zur Live-Konsole des Servers (Websocket des Daemons). Wird NIE an Dritte weitergegeben – darüber ließe
   * sich der Server auch starten. null = nicht verfügbar (z. B. im Mock-Modus).
   */
  consoleSocket(identifier: string): Promise<{ url: string; token: string; origin: string } | null>;

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
