/**
 * Datenobjekte, die die API an das Frontend ausliefert.
 */
import type {
  CycleState,
  FairUseState,
  ReactivationGate,
  ServerStatus,
  StartGate,
  SuspensionReason,
} from './rules/fair-use';

export type PowerState = 'unknown' | 'offline' | 'starting' | 'running' | 'stopping' | 'installing';
export type PowerAction = 'start' | 'stop' | 'restart' | 'kill';

export interface UserDTO {
  id: string;
  email: string;
  emailVerified: boolean;
  /** Pterodactyl-Konto ist verknüpft */
  panelLinked: boolean;
  panelUsername: string | null;
  role: 'user' | 'admin';
  /** Sprache für E-Mails und Hinweise im Panel */
  locale: 'de' | 'en';
  createdAt: string;
}

/** Nächster Schritt nach dem Klick auf einen E-Mail-Link */
export type VerifyNext = 'panel_setup' | 'done' | 'overview' | 'waitlist';

export interface VerifyResult {
  user: UserDTO;
  next: VerifyNext;
  /** Es gab bereits ein Panel-Konto mit dieser E-Mail – bekannte Zugangsdaten nutzen */
  existingPanelAccount: boolean;
  panelUrl: string;
  /** Nur bei next = waitlist: Platz in der Warteliste */
  waitlist?: WaitlistInfo | null;
}

export interface ServerDTO {
  id: string;
  name: string;
  planId: string;
  planName: string;
  serverType: string;
  serverTypeName: string;
  version: string;
  status: ServerStatus;
  suspensionReason: SuspensionReason | null;
  powerState: PowerState;
  address: string | null;
  limits: { memoryMb: number; cpuPercent: number; diskMb: number };
  cycle: CycleState;
  fairUse: FairUseState;
  startGate: StartGate;
  reactivation: ReactivationGate;
  reactivationCount: number;
  provisioningError: string | null;
  /** Direktlink zum Server im Pterodactyl-Panel. null solange nicht angelegt. */
  panelUrl: string | null;
  createdAt: string;
  /** Warteliste (Early Access): Platz und Server-Hardware */
  waitlist: WaitlistInfo | null;
  /** Nach Ablauf + Ruhetag: Zeitpunkt der automatischen Löschung ohne Reaktivierung */
  deleteAt: string | null;
}

export interface NotificationDTO {
  id: string;
  type: string;
  title: string;
  body: string;
  serverId: string | null;
  readAt: string | null;
  createdAt: string;
}

export type ComponentStatus = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance' | 'unknown';

export interface StatusComponentDTO {
  id: string;
  name: string;
  description: string;
  status: ComponentStatus;
  latencyMs: number | null;
  checkedAt: string;
  /** Verfügbarkeit der letzten 30 Tage in Prozent (null = noch keine Daten) */
  uptime30d: number | null;
}

export type IncidentKind = 'incident' | 'maintenance' | 'notice';
export type IncidentImpact = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance';

export interface StatusIncidentDTO {
  id: string;
  kind: IncidentKind;
  impact: IncidentImpact;
  components: string[];
  title: { en: string; de: string };
  message: { en: string; de: string };
  startsAt: string;
  endsAt: string | null;
  resolvedAt: string | null;
  /** aktiv = läuft gerade, geplant = Wartung in der Zukunft, beendet = gelöst/vorbei */
  state: 'active' | 'scheduled' | 'resolved';
  createdAt: string;
  updatedAt: string;
}

export interface StatusDTO {
  overall: ComponentStatus;
  components: StatusComponentDTO[];
  incidents: StatusIncidentDTO[];
  provider: string;
  updatedAt: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

/* -------------------------------------------------------------------------- */
/*  Admin-Bereich                                                              */
/* -------------------------------------------------------------------------- */

export interface AdminJobDTO {
  name: string;
  intervalSeconds: number;
  lastStatus: 'running' | 'success' | 'failed' | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  /** Letzter Lauf liegt länger als 3 Intervalle zurück → Worker läuft vermutlich nicht */
  stale: boolean;
}

export interface AdminOverviewDTO {
  site: { maintenance: boolean; registrationMode: RegistrationMode; maxServersPerUser: number; waitlistConfirmed: number; waitlistUnconfirmed: number };
  users: { total: number; verified: number; locked: number; admins: number; newLast7Days: number };
  servers: { byStatus: Record<string, number>; online: number; paused: number; total: number };
  plans: { id: string; name: string; count: number; reserved: number; capacity: number | null }[];
  mails: { pending: number; failed: number; lastError: string | null };
  jobs: AdminJobDTO[];
  system: {
    pterodactylMode: 'live' | 'mock';
    panelUrl: string;
    smtpConfigured: boolean;
    smtpTarget: string | null;
    mailFrom: string;
    adminEmailsConfigured: number;
  };
}

export interface AdminServerDTO {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail: string;
  ownerLocale: 'de' | 'en';
  planId: string;
  serverType: string;
  version: string;
  status: string;
  suspensionReason: string | null;
  powerState: string;
  address: string | null;
  cycleNumber: number;
  cycleEndsAt: string;
  reactivationCount: number;
  suspendedAt: string | null;
  pausedUntil: string | null;
  pauseReason: string | null;
  provisioningAttempts: number;
  provisioningError: string | null;
  panelDescription: string | null;
  pteroServerId: number | null;
  panelAdminUrl: string | null;
  createdAt: string;
}

export interface AdminUserDTO {
  id: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'locked';
  locale: 'de' | 'en';
  emailVerified: boolean;
  panelUsername: string | null;
  pteroUserId: number | null;
  panelAdminUrl: string | null;
  servers: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminAuditDTO {
  id: number;
  createdAt: string;
  actor: 'user' | 'system' | 'admin';
  action: string;
  message: string;
  userEmail: string | null;
  serverId: string | null;
  ip: string | null;
}

export interface AdminMailDTO {
  id: string;
  createdAt: string;
  type: string;
  title: string;
  userEmail: string;
  emailStatus: string;
  emailAttempts: number;
  emailLastError: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Einstellungen (im Admin-Bereich änderbar, in der Datenbank gespeichert)    */
/* -------------------------------------------------------------------------- */

export type RegistrationMode = 'open' | 'preregistration' | 'closed';
export type NodeTier = 'epyc' | 'xeon';

export interface SiteSettings {
  maintenance: {
    enabled: boolean;
    /** Hinweis auf der Wartungsseite (leer = Standardtext) */
    message: { en: string; de: string };
    /** Voraussichtliches Ende (ISO) – optional */
    until: string | null;
    /** Zeitpunkt, zu dem die Wartung zuletzt beendet wurde (Schutzfrist für automatische Löschungen) */
    endedAt: string | null;
  };
  registration: {
    /** open = Server direkt erstellen · preregistration = Warteliste (Early Access) · closed = keine Anmeldungen */
    mode: RegistrationMode;
    maxServersPerUser: number;
  };
  waitlist: {
    /** Die ersten N Plätze der Warteliste bekommen einen Server auf dem AMD EPYC, danach Intel Xeon */
    epycSlots: number;
    showCounter: boolean;
    /** Summe aller Vormerkungen außerhalb dieser Website (= Summe der Blöcke) – zählt öffentlich mit */
    externalCount: number;
    /**
     * Vormerkungen außerhalb dieser Website als Blöcke in der Warteschlange: Jeder Block belegt
     * `count` Plätze direkt hinter der Position `after` – wer später kommt, reiht sich dahinter ein.
     */
    blocks: WaitlistBlock[];
    /** EPYC-Plätze, die außerhalb dieser Website schon belegt sind (z. B. Server im alten System) */
    epycReserved: number;
  };
  /** Kapazität je Paket (Schlüssel = Paket-ID) */
  plans: Record<string, PlanCapacitySetting>;
  stats: {
    /** Zahlen auf der Startseite anzeigen */
    show: boolean;
    /** auto = aus der Datenbank (+ Zusatz, z. B. Nutzer im Altsystem) · manual = fester Wert */
    users: { mode: 'auto' | 'manual'; value: number; offset: number };
    servers: { mode: 'auto' | 'manual'; value: number; offset: number };
    /** auto = aus dem Status-Verlauf der letzten 30 Tage · manual = fester Wert (z. B. aus externem Monitoring) */
    uptime: { mode: 'auto' | 'manual'; value: number };
  };
  status: {
    /** Manueller Status je Komponente (auto = automatische Prüfung) */
    overrides: Record<string, IncidentImpact | 'auto'>;
  };
}

export interface WaitlistBlock {
  /** Block liegt hinter dieser Warteliste-Position (null = noch nicht verankert → hinter alle bisherigen) */
  after: number | null;
  count: number;
  /** Zeitpunkt des Hinzufügens */
  at: string | null;
}

export interface PlanCapacitySetting {
  /** Höchstzahl gleichzeitiger Server dieses Pakets (null = unbegrenzt) */
  capacity: number | null;
  /** Außerhalb dieser Website belegte Plätze (z. B. Server im alten System auf denselben Nodes) */
  reserved: number;
}

/** Belegung eines Pakets */
export interface PlanAvailabilityDTO {
  id: string;
  capacity: number | null;
  /** belegt = Server über diese Website + außerhalb belegte Plätze */
  used: number;
  remaining: number | null;
  available: boolean;
}

export interface WaitlistInfo {
  /** Platz in der Warteliste (1 = erster) */
  position: number;
  tier: NodeTier;
}

/** Öffentliche Einstellungen + Kennzahlen für die Website */
export interface PublicSiteDTO {
  maintenance: { enabled: boolean; message: { en: string; de: string }; until: string | null };
  registration: { mode: RegistrationMode; maxServersPerUser: number };
  waitlist: { total: number | null; epycSlots: number; epycUsed: number; epycRemaining: number };
  plans: PlanAvailabilityDTO[];
  stats: { users: number; activeServers: number; uptime: number | null } | null;
}

/** Seitenweise Listen im Admin-Bereich */
export const ADMIN_PAGE_SIZE = 50;

export interface PageInfo {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}

/** Vormerkungs-Block in der Admin-Liste mit den Plätzen, die er belegt */
export interface AdminWaitlistBlockDTO {
  after: number;
  count: number;
  at: string | null;
  fromRank: number;
  toRank: number;
}

export interface AdminWaitlistDTO {
  id: string;
  name: string;
  email: string;
  locale: 'de' | 'en';
  planId: string;
  serverType: string;
  version: string;
  /** null = E-Mail noch nicht bestätigt (noch kein Platz) */
  position: number | null;
  rank: number | null;
  tier: NodeTier | null;
  panelLinked: boolean;
  joinedAt: string | null;
  createdAt: string;
}

export interface AdminIncidentInput {
  kind: IncidentKind;
  impact: IncidentImpact;
  components: string[];
  title: { en: string; de: string };
  message: { en: string; de: string };
  startsAt: string | null;
  endsAt: string | null;
}
