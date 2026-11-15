/**
 * Datenobjekte, die die API an das Frontend ausliefert.
 */
import type { PlanConfig, ProductKind } from './config/freehosting.config';
import type { ChatSettings } from './chat-settings';
import type { DiscordSettings } from './discord-settings';
import type { ServerLimits } from './server-limits';
import type { Localized } from './i18n';
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
  /** Darf die Beta-Instanz nutzen (vom Admin freigeschaltet – Admins immer) */
  beta: boolean;
  /** Sprache für E-Mails und Hinweise im Panel */
  locale: 'de' | 'en';
  /** Verknüpftes Discord-Konto (null = nicht verknüpft) */
  discord: { id: string; username: string } | null;
  createdAt: string;
}

/** Zweite Stufe bei der Anmeldung: eigenes Passwort oder Authenticator-App */
export type TwoFactorMethod = 'password' | 'totp';

/** Sicherheit des Accounts („Meine Server“) */
export interface SecurityDTO {
  method: TwoFactorMethod | null;
  /** Noch unbenutzte Wiederherstellungscodes */
  recoveryCodesLeft: number;
}

/** Einrichtung der Authenticator-App: Schlüssel zum Abtippen, Link zum Öffnen der App und QR-Code (Bild als data:-Adresse) */
export interface TotpSetupDTO {
  secret: string;
  uri: string;
  qr: string;
}

/** Antwort auf die Code-Eingabe: fertig angemeldet – oder es fehlt noch die zweite Stufe */
export type VerifyResponse = VerifyResult | { twoFactor: { method: TwoFactorMethod; ticket: string } };

/** Nächster Schritt nach der Bestätigung des Codes aus der E-Mail */
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
  /** Offene Anfrage, die auf die Discord-Verbindung wartet: Zeitpunkt, zu dem sie gelöscht wird (null = keine Frist) */
  pendingDeadlineAt: string | null;
  /** Minecraft-Server oder Discord-Bot */
  kind: ProductKind;
  /** Gilt das Fair-Use-System (max. Laufzeit am Stück, Wochen-Offline-Zeit) für diesen Server? */
  fairUseEnabled: boolean;
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

/** Zustand eines Tages im Verlauf der Statusseite (none = keine Messdaten) */
export type StatusDayState = 'operational' | 'degraded' | 'maintenance' | 'outage' | 'none';
/** Die vier Kategorien der Legende */
export type StatusCategory = Exclude<StatusDayState, 'none'>;

export interface StatusDayDTO {
  /** Kalendertag (YYYY-MM-DD, Zeitzone der Website) – bei Stunden-Balken der Beginn der Stunde (ISO-Zeit) */
  date: string;
  state: StatusDayState;
  /** Verfügbarkeit in diesem Zeitabschnitt (Tag bzw. Stunde) in Prozent (null = keine Messdaten) */
  uptime: number | null;
}

/** Woher der Status einer Komponente kommt */
export type StatusSource = 'manual' | 'service' | 'api' | 'panel' | 'nodes' | 'node' | 'website' | 'http';
export const statusSources: StatusSource[] = ['manual', 'service', 'website', 'api', 'panel', 'nodes', 'node', 'http'];

export const statusIcons = ['network', 'server', 'cpu', 'globe', 'database', 'shield', 'bot', 'gamepad', 'cloud', 'activity', 'mail', 'lock', 'zap', 'box'] as const;
export type StatusIcon = (typeof statusIcons)[number];

export interface StatusGroupSetting {
  id: string;
  name: Localized;
  icon: StatusIcon;
}

export interface StatusComponentSetting {
  id: string;
  /** ID der Gruppe */
  group: string;
  name: Localized;
  /** Kleine Zeile unter dem Namen, z. B. „DE-XEON-01 · Dual Intel Xeon Gold 6230“ */
  subtitle: Localized;
  source: StatusSource;
  /** Bei „node“: ID des Pterodactyl-Nodes · bei „http“: Adresse, die geprüft wird */
  target: string;
  /** Eigener Text für „Betriebsbereit“, z. B. „Aktiv“ (leer = Standard) */
  operationalLabel: Localized;
  visible: boolean;
}

/** Nachgetragener Zeitraum im Verlauf, z. B. „vom 1.9. bis 14.10. war alles betriebsbereit“ */
export interface StatusRangeSetting {
  /** ID der Komponente oder „*“ für alle */
  component: string;
  /** Erster und letzter Tag (YYYY-MM-DD, jeweils einschließlich) */
  from: string;
  to: string;
  state: StatusCategory;
  /** true = nur Tage ohne Messdaten füllen, gemessene Tage bleiben wie sie sind */
  onlyEmpty: boolean;
}

export interface StatusPageSettings {
  /** Überschrift und Einleitung (leer = Standardtext) */
  title: Localized;
  intro: Localized;
  /** Was ein Balken im Verlauf zeigt: day = ein Kalendertag · hour = eine Stunde */
  unit: 'day' | 'hour';
  /** Länge des Verlaufs in Tagen (7–90) – gilt bei unit = day */
  days: number;
  /** Länge des Verlaufs in Stunden (12–168) – gilt bei unit = hour */
  hours: number;
  showBanner: boolean;
  showBars: boolean;
  showUptime: boolean;
  showLegend: boolean;
  showLatency: boolean;
  /** Vergangene Meldungen der letzten 14 Tage */
  showPast: boolean;
  /** Link zur Statusseite des Hauptanbieters unter der Seite (Adresse: Einstellungen → Links) */
  showExternalLink: boolean;
  /** Bezeichnungen der vier Zustände (Legende und Status je Komponente) */
  labels: Record<StatusCategory, Localized>;
  /** Text im Banner über der Seite je Gesamtzustand */
  banners: Record<StatusCategory, Localized>;
  /** Farben als Hex-Wert (#rrggbb) */
  colors: Record<StatusDayState, string>;
}

export interface StatusComponentDTO {
  id: string;
  group: string;
  name: Localized;
  subtitle: Localized;
  /** Eigener Text für „Betriebsbereit“ (leer = Standard) */
  operationalLabel: Localized;
  status: ComponentStatus;
  latencyMs: number | null;
  checkedAt: string;
  /** Verfügbarkeit im angezeigten Zeitraum in Prozent (null = noch keine Daten) */
  uptime: number | null;
  /** Ein Eintrag je Tag, ältester zuerst, letzter = heute */
  days: StatusDayDTO[];
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
  page: StatusPageSettings;
  groups: StatusGroupSetting[];
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
  site: { maintenance: boolean; registrationMode: RegistrationMode; limits: ServerLimits; waitlistConfirmed: number; waitlistUnconfirmed: number };
  /** Belegung je Produkt (Minecraft / Discord-Bots) */
  products: { kind: ProductKind; enabled: boolean; count: number; reserved: number; capacity: number | null }[];
  users: { total: number; verified: number; locked: number; admins: number; newLast7Days: number };
  servers: { byStatus: Record<string, number>; online: number; paused: number; total: number };
  plans: { id: string; kind: ProductKind; name: string; count: number; reserved: number; capacity: number | null }[];
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

/**
 * Worauf eine offene Anfrage (Status „pending“) wartet:
 * email = E-Mail noch nicht bestätigt · panel = noch kein Panel-Konto · discord_* = Discord-Pflicht nicht erfüllt ·
 * stuck = alles erfüllt, der Server wurde aber nicht erstellt (Fehler – „Erneut versuchen“)
 */
export type PendingReason = 'email' | 'panel' | 'discord_not_linked' | 'discord_not_member' | 'discord_unavailable' | 'stuck';

export interface AdminServerDTO {
  id: string;
  name: string;
  kind: ProductKind;
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
  /** Nur bei offenen Anfragen (status = pending), sonst null */
  pendingReason: PendingReason | null;
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
  /** Beta-Zugang freigeschaltet */
  beta: boolean;
  /** Zweite Stufe bei der Anmeldung (null = aus) */
  twoFactor: TwoFactorMethod | null;
  /** IP-Adressen (verschlüsselt gespeichert, nur im Admin-Bereich sichtbar) */
  registrationIp: string | null;
  lastLoginIp: string | null;
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

/** Accounts, deren Server noch auf die Discord-Verbindung wartet (Admin → E-Mails) */
export interface AdminDiscordWaitingDTO {
  users: { userId: string; email: string; servers: string[]; reason: 'discord_not_linked' | 'discord_not_member'; deadline: string | null }[];
}

/** Abuse-Bereich: versendete Abuse-Mails (von Hand und automatisch) und die Gründe für neue */
export interface AdminAbuseDTO {
  reasons: { id: string; label: string }[];
  mails: { id: string; createdAt: string; userEmail: string; type: string; manual: boolean; title: string; body: string; emailStatus: string; emailLastError: string | null; serverName: string | null }[];
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
    /** Wie viele kostenlose Server eine Person haben darf – je Angebot, zusammen und je Paket */
    limits: ServerLimits;
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
  /** Produkte: Minecraft-Server und Discord-Bots – jeweils mit eigenen Paketen, Kapazität, Nodes und Eggs */
  products: Record<ProductKind, ProductSettings>;
  /**
   * Private Pterodactyl-Nodes: Auf ihnen wird nie ein kostenloser Server erstellt – auch nicht ersatzweise,
   * wenn alle anderen Nodes voll sind. Eine private Node kann keinem Produkt zugewiesen sein.
   */
  privateNodeIds: number[];
  /** Angaben zur Hardware auf der Website */
  hardware: {
    /** Rechenzentrums-Standorte (Ländercode + Name) */
    locations: HardwareLocation[];
    cpus: string[];
  };
  /** Fair-Use-System für Discord-Bots (Dauerbetrieb, aber faire Nutzung der geteilten Hardware) */
  botFairUse: BotFairUseSettings;
  /** Links und Kontakt der Marke (leer = Standard aus Konfiguration bzw. .env) */
  brand: BrandSettings;
  /** Regeln: Fair-Use für Minecraft und der Laufzeit-Zyklus (früher fest im Code) */
  rules: RuleSettings;
  /** Auswählbare Versionen je Minecraft-Servertyp (fehlt ein Typ, gilt die Standardliste) */
  versions: Record<string, string[]>;
  /** Weitere Domains, unter denen die Website erreichbar ist (HTTPS wird automatisch eingerichtet) */
  domains: { extra: DomainSetting[] };
  newsletter: NewsletterSettings;
  /** Hinweisleiste oben auf jeder Seite */
  announcement: AnnouncementSettings;
  /** Gesperrte E-Mail-Adressen und -Domains (Registrierung und Newsletter) */
  blocklist: BlocklistSettings;
  seo: SeoSettings;
  /** Discord-Anbindung: Verknüpfung, Pflicht-Mitgliedschaft, Rollen, Willkommensnachricht, Tickets */
  discord: DiscordSettings;
  /** Support-Chat „Crafting AI“ */
  chat: ChatSettings;
  /** Eigenes Logo (die Bilddatei selbst liegt getrennt in der Datenbank – Upload im Admin-Bereich) */
  branding: {
    /** icon = Bild ersetzt den Würfel, der Schriftzug bleibt · full = Bild ersetzt Würfel und Schriftzug */
    logoMode: 'icon' | 'full';
  };
  /** Spenden-Seite (Zahlungslink von SumUp) */
  donate: {
    enabled: boolean;
    /** Zahlungslink, z. B. https://pay.sumup.com/b2c/… */
    url: string;
  };
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
    /** Darstellung der Statusseite */
    page: StatusPageSettings;
    groups: StatusGroupSetting[];
    components: StatusComponentSetting[];
    /** Nodes direkt anpingen (Wings), nicht nur den Wartungsmodus aus dem Panel lesen */
    pingNodes: boolean;
    /** Nachträgliche Korrekturen am Verlauf: Komponente → Tag (YYYY-MM-DD) → Zustand */
    history: Record<string, Record<string, StatusCategory>>;
    /** Nachgetragene Zeiträume – gelten vor den Korrekturen einzelner Tage, spätere Einträge gewinnen */
    ranges: StatusRangeSetting[];
  };
}

export interface WaitlistBlock {
  /** Block liegt hinter dieser Warteliste-Position (null = noch nicht verankert → hinter alle bisherigen) */
  after: number | null;
  count: number;
  /** Zeitpunkt des Hinzufügens */
  at: string | null;
}

/**
 * Fair-Use-System für Discord-Bots. Bots dürfen durchgehend online sein – statt Laufzeit-Pausen
 * gelten Regeln für die geteilte Hardware:
 *  1. CPU-Dauerlast: liegt die CPU-Last länger als `cpuWindowMinutes` am Stück über `cpuThresholdPercent`
 *     des Paket-Limits, wird der Bot nach einer Vorwarnung gestoppt und pausiert `cooldownMinutes`.
 *  2. Verwarnungen: `maxStrikes` solcher Stopps innerhalb von `strikeWindowDays` Tagen → Sperre durch das System.
 *  3. Inaktivität: ist der Bot `inactiveDays` Tage am Stück offline, wird der Platz freigegeben
 *     (Laufzeit endet vorzeitig, Reaktivierung wie nach den 30 Tagen).
 */
export interface BotFairUseSettings {
  enabled: boolean;
  /** Schwelle in Prozent des CPU-Limits des Pakets (z. B. 90) */
  cpuThresholdPercent: number;
  /** So viele Minuten am Stück über der Schwelle gelten als Dauerlast */
  cpuWindowMinutes: number;
  /** Pause nach einem automatischen Stopp */
  cooldownMinutes: number;
  /** Stopps innerhalb von `strikeWindowDays`, ab denen der Bot gesperrt wird (0 = nie sperren) */
  maxStrikes: number;
  strikeWindowDays: number;
  /** Tage am Stück offline, nach denen der Platz freigegeben wird (0 = aus) */
  inactiveDays: number;
  /** Erinnerung per E-Mail so viele Tage vorher */
  inactiveWarningDays: number;
}

export interface BrandSettings {
  discordUrl: string;
  supportEmail: string;
  /** Hauptmarke (crafting.host) und deren Preisseite */
  parentUrl: string;
  parentPricingUrl: string;
  statusUrl: string;
}

export interface RuleSettings {
  /** Fair-Use für Minecraft-Server (und für Discord-Bots, falls dort eingeschaltet) */
  fairUse: {
    maxSessionHours: number;
    sessionWarningMinutes: number;
    cooldownMinutes: number;
    weeklyOfflineHours: number;
    weeklyOfflineWarningHours: number;
  };
  cycle: {
    /** Laufzeit in Tagen */
    days: number;
    /** Erinnerungen X Tage vor Ablauf */
    reminderDaysBefore: number[];
    /** Ruhezeit nach Ablauf in Minuten (1440 = 1 Ruhetag, 0 = keine) */
    reactivationCooldownMinutes: number;
    /** Löschung so viele Stunden nach der Ruhezeit (0 = nie) */
    deleteAfterRestHours: number;
    deleteReminderHours: number;
  };
}

export interface DomainSetting {
  /** Hostname ohne Protokoll, z. B. free.example.com */
  host: string;
  /** true = dauerhaft auf die Hauptdomain weiterleiten (empfohlen für SEO) · false = Website dort ausliefern */
  redirect: boolean;
  addedAt: string | null;
}

export interface NewsletterSettings {
  enabled: boolean;
  /** Anmeldeformular im Footer */
  footerForm: boolean;
  /** Häkchen „Newsletter abonnieren“ beim Erstellen eines Servers */
  signupCheckbox: boolean;
  /** Höchstzahl E-Mails pro Minute beim Versand (schont den Mailserver) */
  ratePerMinute: number;
}

export interface AnnouncementSettings {
  enabled: boolean;
  tone: 'info' | 'success' | 'warning';
  text: Localized;
  /** Optionaler Link hinter dem Text */
  linkUrl: string;
  linkLabel: Localized;
}

export interface BlocklistSettings {
  /** Bekannte Wegwerf-Adressen (eingebaute Liste) ablehnen */
  disposable: boolean;
  emailDomains: string[];
  emails: string[];
}

export interface SeoSettings {
  /** Eigener Seitentitel / eigene Beschreibung der Startseite (leer = Standardtexte) */
  title: Localized;
  description: Localized;
  /** false = Suchmaschinen sollen die Website nicht aufnehmen (noindex) */
  indexing: boolean;
  /** Kurzbeschreibung für KI-Assistenten und Suchmaschinen (llms.txt, strukturierte Daten). Leer = automatisch */
  summary: Localized;
}

export interface HardwareLocation {
  /** Ländercode, z. B. DE */
  code: string;
  name: Localized;
}

/** Ein Paket, wie es im Admin-Bereich gepflegt wird */
export interface PlanSetting extends PlanConfig {
  /** false = nicht mehr wählbar (bestehende Server laufen weiter) */
  enabled: boolean;
  /** Außerhalb dieser Website belegte Plätze (z. B. Server im alten System auf denselben Nodes) */
  reserved: number;
}

/** Egg in Pterodactyl (Nest + Egg) */
export interface EggRef {
  nestId: number;
  eggId: number;
  /** Anzeigename (nur zur Orientierung im Admin-Bereich) */
  name: string;
}

export interface ProductSettings {
  /** Produkt wird auf der Website angeboten */
  enabled: boolean;
  /** Höchstzahl gleichzeitiger Server dieses Produkts über alle Pakete (null = unbegrenzt) */
  capacity: number | null;
  /** Außerhalb dieser Website belegte Plätze */
  reserved: number;
  /** Fair-Use-System (max. Laufzeit am Stück + Wochen-Offline-Zeit). Aus = Dauerbetrieb, nur der 30-Tage-Zyklus gilt */
  fairUse: boolean;
  plans: PlanSetting[];
  /**
   * Pterodactyl-Nodes, auf denen Server dieses Produkts erstellt werden (leer = automatisch über
   * die Locations aus der .env). Für Discord-Bots: die eigene Bot-Node.
   */
  nodeIds: number[];
  /** Egg je Servertyp (Schlüssel = Servertyp-ID, z. B. paper, python, nodejs). Fehlt ein Eintrag, gilt die .env bzw. die automatische Erkennung */
  eggs: Record<string, EggRef>;
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

/** Paket mit Belegung für die Website */
export interface PublicPlanDTO extends PlanConfig, PlanAvailabilityDTO {
  kind: ProductKind;
}

/** Produkt mit Paketen und Belegung für die Website */
export interface PublicProductDTO {
  kind: ProductKind;
  enabled: boolean;
  fairUse: boolean;
  capacity: number | null;
  used: number;
  remaining: number | null;
  available: boolean;
  /** Nur aktive Pakete */
  plans: PublicPlanDTO[];
  /** Servertypen: ob ein Egg dafür eingerichtet ist und welche Versionen wählbar sind */
  serverTypes: { id: string; available: boolean; versions: string[] }[];
}

export interface WaitlistInfo {
  /** Platz in der Warteliste (1 = erster) */
  position: number;
  tier: NodeTier;
}

/** Öffentliche Einstellungen + Kennzahlen für die Website */
export interface PublicSiteDTO {
  maintenance: { enabled: boolean; message: { en: string; de: string }; until: string | null };
  registration: { mode: RegistrationMode; limits: ServerLimits };
  waitlist: { total: number | null; epycSlots: number; epycUsed: number; epycRemaining: number };
  /** Belegung aller Pakete (beide Produkte) */
  plans: PlanAvailabilityDTO[];
  products: Record<ProductKind, PublicProductDTO>;
  hardware: { locations: HardwareLocation[]; cpus: string[]; storage: string; network: string };
  donate: { enabled: boolean; url: string | null };
  /** Support-Chat: Anzeige auf der Website (null = ausgeschaltet) */
  chat: { name: string; teaser: Localized; welcome: Localized; quick: { id: string; question: Localized }[]; ai: boolean; handoff: boolean; retentionDays: number } | null;
  /** Discord: verfügbar = vollständig eingerichtet · required = Mitgliedschaft ist Pflicht für kostenlose Server */
  discord: { available: boolean; required: boolean; inviteUrl: string | null; note: Localized };
  botFairUse: BotFairUseSettings;
  /** Aufgelöste Links (Admin-Einstellung → .env → Standard) */
  brand: BrandSettings;
  rules: RuleSettings;
  /** Weitere Domains (für Weiterleitungen und die Ursprungsprüfung) */
  domains: { host: string; redirect: boolean }[];
  newsletter: { enabled: boolean; footerForm: boolean; signupCheckbox: boolean };
  /** null = keine Hinweisleiste */
  announcement: Omit<AnnouncementSettings, 'enabled'> | null;
  seo: SeoSettings;
  /** Hochgeladenes Logo (null = Standard-Bildmarke) */
  logo: { url: string; mode: 'icon' | 'full' } | null;
  /** Tatsächliche Sitzungsdauer (für die Cookie-Hinweise) */
  session: { idleMinutes: number; maxHours: number; persistent: boolean; cookieName: string };
  /**
   * Beta-Programm: `instance` = diese Installation IST die Beta-Instanz · `url` = Adresse der Beta-Instanz
   * (nur auf der Hauptseite gesetzt) · `mainUrl` = Adresse der Hauptseite (nur auf der Beta-Instanz)
   */
  beta: { instance: boolean; url: string | null; mainUrl: string | null };
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
  kind: ProductKind;
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

/* -------------------------------------------------------------------------- */
/*  Pterodactyl im Admin-Bereich (Nodes und Eggs werden automatisch erkannt)   */
/* -------------------------------------------------------------------------- */

export interface AdminPanelNodeDTO {
  id: number;
  name: string;
  fqdn: string;
  locationId: number;
  locationName: string | null;
  memoryMb: number;
  diskMb: number;
  maintenance: boolean;
  /** Freie Ports (Allokationen) – ohne freie Allokation kann kein Server erstellt werden */
  freeAllocations: number | null;
}

export interface AdminPanelEggDTO {
  nestId: number;
  nestName: string;
  eggId: number;
  name: string;
  description: string;
  dockerImages: string[];
}

export interface AdminPanelDTO {
  mode: 'live' | 'mock';
  url: string;
  /** Verbindung zum Panel steht (API-Keys gültig) */
  connected: boolean;
  error: string | null;
  nodes: AdminPanelNodeDTO[];
  eggs: AdminPanelEggDTO[];
  /** Vorschlag der automatischen Erkennung je Servertyp */
  suggestedEggs: Record<string, EggRef>;
}

/** Aktionen für alle Server auf einmal (Admin-Bereich) */
export type BulkServerAction = 'suspend' | 'unsuspend' | 'delete';

export interface BulkServerInput {
  action: BulkServerAction;
  /** all = alle Server · minecraft / discord = nur dieses Produkt */
  kind: ProductKind | 'all';
  /** E-Mail-Adressen der Konten, deren Server NICHT betroffen sind (zusätzlich zu allen Admin-Konten) */
  exemptEmails: string[];
  /** true = nur zählen, nichts ändern (Vorschau vor der Bestätigung) */
  dryRun?: boolean;
  /** Höchstzahl Server pro Aufruf – die Website ruft so lange auf, bis `remaining` 0 ist */
  limit?: number;
  /** So viele Treffer überspringen (bisher fehlgeschlagene Server, damit die Runde nicht hängen bleibt) */
  skip?: number;
}

export interface BulkServerResult {
  processed: number;
  failed: number;
  /** Noch betroffene Server nach diesem Aufruf */
  remaining: number;
  /** Ausgenommene Server (Admin-Konten + ausgewählte Konten) */
  exempt: number;
  /** Ausnahme-Adressen, zu denen es kein Konto gibt */
  unknownEmails: string[];
  errors: string[];
}

/* -------------------------------------------------------------------------- */
/*  Newsletter                                                                 */
/* -------------------------------------------------------------------------- */

export type NewsletterStatus = 'pending' | 'active' | 'unsubscribed';

export interface AdminSubscriberDTO {
  id: string;
  email: string;
  locale: 'de' | 'en';
  status: NewsletterStatus;
  source: string;
  createdAt: string;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
}

/** all_users = alle bestätigten Konten – nur für betriebliche Hinweise (z. B. Wartung, Umzug), nicht für Werbung */
export type CampaignAudience = 'subscribers' | 'all_users';

export interface CampaignInput {
  subject: Localized;
  /** Text mit Absätzen; **fett** und Links (https://…) werden erkannt */
  body: Localized;
  audience: CampaignAudience;
  /** Optionaler Button */
  ctaLabel: Localized;
  ctaUrl: string;
}

export interface AdminCampaignDTO extends CampaignInput {
  id: string;
  status: 'draft' | 'sending' | 'sent' | 'cancelled';
  total: number;
  sent: number;
  failed: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AdminNewsletterDTO {
  counts: Record<NewsletterStatus, number>;
  /** Bestätigte Konten (Empfänger betrieblicher Hinweise) */
  verifiedUsers: number;
  campaigns: AdminCampaignDTO[];
  smtpConfigured: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Domains und Tunnel                                                         */
/* -------------------------------------------------------------------------- */

export interface AdminDomainDTO {
  host: string;
  /** Hauptdomain aus der Installation (APP_URL) – nicht entfernbar */
  primary: boolean;
  /** Domain der Beta-Instanz (vom Installer eingerichtet) – nicht entfernbar */
  beta?: boolean;
  redirect: boolean;
  /** IP-Adressen, auf die die Domain zeigt */
  addresses: string[];
  /** DNS zeigt auf diesen Server (null = unbekannt, z. B. weil die eigene IP nicht ermittelt werden konnte) */
  pointsHere: boolean | null;
  /** Website ist über https://host erreichbar */
  reachable: boolean;
  /** Kurzer Hinweis, was noch zu tun ist */
  hint: string | null;
}

export interface AdminTunnelDTO {
  /** cloudflared ist auf dem Server installiert */
  installed: boolean;
  version: string | null;
  /** Bei Cloudflare angemeldet (Zertifikat vorhanden) */
  loggedIn: boolean;
  /** Link zum Freigeben der Domain – nur während der Anmeldung */
  loginUrl: string | null;
  loginPending: boolean;
  /** Tunnel angelegt */
  tunnelId: string | null;
  /** Domains, die über den Tunnel laufen */
  hosts: string[];
  /** Tunnel-Dienst läuft und ist mit Cloudflare verbunden */
  running: boolean;
  connections: number | null;
  error: string | null;
}

export interface AdminDomainsDTO {
  primary: string;
  /** Öffentliche IP-Adressen dieses Servers (für den DNS-Eintrag) */
  serverAddresses: string[];
  domains: AdminDomainDTO[];
  tunnel: AdminTunnelDTO;
}

/* ---------------------------------------------------------------- Discord */

/** Stand der Discord-Verknüpfung eines Accounts („Meine Server“) */
export interface DiscordMeDTO {
  /** Verknüpfen ist möglich (Anbindung vollständig eingerichtet) */
  available: boolean;
  /** Ohne Mitgliedschaft auf dem Discord-Server gibt es keine kostenlosen Server */
  required: boolean;
  linked: { id: string; username: string } | null;
  /** Warum gerade keine Server freigeschaltet werden (null = alles in Ordnung) */
  blocked: 'not_linked' | 'not_member' | 'unavailable' | null;
}

export interface DiscordSetupStep {
  name: string;
  ok: boolean;
  detail: string;
}

/** Belohnungssystem im Admin-Bereich: wer am meisten eingeladen hat und wer boostet */
export interface AdminRewardsDTO {
  inviters: { discordId: string; username: string | null; email: string | null; total: number; qualified: number; rewards: number; redeemed: number }[];
  boosters: { discordId: string; username: string | null; email: string | null; boosts: number; manual: boolean }[];
}

/** Übersicht der Discord-Anbindung im Admin-Bereich – Token und Secret werden nie übertragen */
export interface AdminDiscordDTO {
  hasBotToken: boolean;
  hasClientSecret: boolean;
  botReady: boolean;
  linkReady: boolean;
  /** Muss im Discord Developer Portal unter OAuth2 → Redirects eingetragen sein */
  redirectUri: string;
  /** Link, mit dem der Bot auf den Server eingeladen wird */
  botInviteUrl: string | null;
  /** Vom Bot erstellter Einladungslink (wird auf der Website überall verwendet) */
  inviteUrl: string | null;
  bot: { id: string; username: string; avatar: string | null } | null;
  guild: { name: string; icon: string | null; memberCount: number | null } | null;
  commandsAt: string | null;
  setupAt: string | null;
  gateway: { status: 'off' | 'connecting' | 'online' | 'error'; at: string; error: string | null };
  /** Letzter Fehler beim Vergeben der Customer-Rolle */
  roleError: { at: string; message: string } | null;
  /** Letzter Fehler beim Posten einer Status-Meldung (null = zuletzt hat es geklappt) */
  statusFeedError: { at: string; message: string } | null;
  /** Letzter Fehler beim automatischen Bann im Honeypot-Kanal */
  honeypotError: { at: string; message: string } | null;
  linkedUsers: number;
}

/* ---------------------------------------------------------------- Support-Chat */

/** Knopf unter einer Chat-Nachricht */
export type ChatAction =
  /** „Mit einem Mitarbeiter sprechen“ */
  | { type: 'handoff' }
  /** Discord-Konto verbinden (Verbindungslink, nicht der Einladungslink) */
  | { type: 'connect_discord'; url: string }
  /** Das eröffnete Ticket auf Discord */
  | { type: 'open_ticket'; url: string }
  | { type: 'link'; url: string; label: Localized };

export interface ChatMessageDTO {
  id: number;
  role: 'user' | 'assistant';
  /** canned = vorgefertigte Antwort · ai = von der KI erzeugt · system = Ablauf (z. B. Weitergabe) */
  source: 'user' | 'canned' | 'ai' | 'system';
  text: string;
  at: string;
  actions: ChatAction[];
}

export interface ChatConversationDTO {
  /** open = läuft · handoff_pending = wartet auf die Discord-Verbindung · handed_off = Ticket eröffnet */
  status: 'open' | 'handoff_pending' | 'handed_off';
  messages: ChatMessageDTO[];
  /** Weitere Nachrichten sind möglich (Obergrenze je Unterhaltung nicht erreicht) */
  canSend: boolean;
}

/** Übersicht des Chats im Admin-Bereich – der API-Schlüssel wird nie übertragen */
export interface AdminChatDTO {
  hasApiKey: boolean;
  /** Modell, das „auto“ gerade verwendet */
  model: string;
  /** Verbrauch im laufenden Kalendermonat */
  usage: { month: string; requests: number; inputTokens: number; outputTokens: number; costUsd: number };
  budgetReached: boolean;
  /** Letzter Fehler der KI-Anbindung (z. B. ungültiger Schlüssel) */
  lastError: { at: string; message: string } | null;
  conversations: { id: string; startedAt: string; updatedAt: string; messages: number; status: ChatConversationDTO['status']; firstMessage: string; ai: number }[];
}
