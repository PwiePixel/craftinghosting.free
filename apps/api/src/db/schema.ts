/**
 * Datenbankschema (SQLite, verschlüsselte Datei über libSQL) – Drizzle ORM.
 * Migrationen erzeugen: npm run db:generate  ·  anwenden: npm run db:migrate
 *
 * Alle Zeitstempel werden als Millisekunden seit 1970 (UTC) gespeichert.
 * IP-Adressen und User-Agents werden zusätzlich feldweise verschlüsselt (lib/crypto.ts → encryptField).
 */
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const ts = (name: string) => integer(name, { mode: 'timestamp_ms' });
const now = () => new Date();

/* ------------------------------------------------------------------ users */

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
    status: text('status', { enum: ['active', 'locked'] }).notNull().default('active'),
    emailVerifiedAt: ts('email_verified_at'),
    acceptedTermsAt: ts('accepted_terms_at').notNull(),
    /** Verknüpftes Pterodactyl-Konto (die Website speichert keine Passwörter) */
    pteroUserId: integer('ptero_user_id'),
    pteroUsername: text('ptero_username'),
    /** Sprache für E-Mails, Chat-Hinweise und Panel-Beschreibung (zuletzt auf der Website verwendet) */
    locale: text('locale', { enum: ['de', 'en'] }).notNull().default('en'),
    lastLoginAt: ts('last_login_at'),
    /** IP bei der Registrierung bzw. beim letzten Login – verschlüsselt (encryptField) */
    /** Beta-Zugang: darf die Beta-Instanz nutzen (Admin → Nutzer) */
    beta: integer('beta', { mode: 'boolean' }).notNull().default(false),
    registrationIp: text('registration_ip'),
    lastLoginIp: text('last_login_ip'),
    /** Verknüpftes Discord-Konto (ein Discord-Konto gehört zu höchstens einem Account) */
    discordId: text('discord_id'),
    discordUsername: text('discord_username'),
    discordLinkedAt: ts('discord_linked_at'),
    /** Customer-Rolle auf dem Discord-Server: zuletzt gesetzter Stand und Zeitpunkt des letzten Abgleichs */
    discordCustomerRole: integer('discord_customer_role', { mode: 'boolean' }).notNull().default(false),
    discordSyncAt: ts('discord_sync_at'),
    /**
     * Zweite Stufe bei der Anmeldung (nach dem Code per E-Mail): eigenes Passwort oder Authenticator-App.
     * Passwort nur als scrypt-Hash, TOTP-Schlüssel verschlüsselt (encryptField), Wiederherstellungscodes als Hash.
     */
    twoFactorMethod: text('two_factor_method', { enum: ['password', 'totp'] }),
    passwordHash: text('password_hash'),
    totpSecret: text('totp_secret'),
    /** Schlüssel während der Einrichtung – wird erst nach der Bestätigung mit einem Code aktiv */
    totpPending: text('totp_pending'),
    /** Zuletzt verwendeter Zeitschritt – derselbe Code gilt nicht zweimal */
    totpLastStep: integer('totp_last_step'),
    twoFactorRecovery: text('two_factor_recovery', { mode: 'json' }).$type<string[]>(),
    twoFactorFails: integer('two_factor_fails').notNull().default(0),
    twoFactorLockedUntil: ts('two_factor_locked_until'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email), uniqueIndex('users_ptero_uq').on(t.pteroUserId), uniqueIndex('users_discord_uq').on(t.discordId)],
);

/* --------------------------------------------------------------- sessions */

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    /** SHA-256 des Session-Tokens – das Token selbst wird nie gespeichert. `ip`/`user_agent` sind verschlüsselt. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull().$defaultFn(now),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('auth_sessions_user_idx').on(t.userId), index('auth_sessions_expires_idx').on(t.expiresAt)],
);

export const emailTokens = sqliteTable(
  'email_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** verify_email: Bestätigung + Anmeldung · login: Anmeldung – beide per sechsstelligem Code aus der E-Mail */
    type: text('type', { enum: ['verify_email', 'login'] }).notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    /** Fehlversuche bei der Code-Eingabe – nach fünf ist der Code verbraucht */
    attempts: integer('attempts').notNull().default(0),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex('email_tokens_hash_uq').on(t.tokenHash), index('email_tokens_user_idx').on(t.userId, t.type)],
);

/* ---------------------------------------------------------------- servers */

export const SERVER_STATUSES = ['waitlist', 'pending', 'provisioning', 'provisioning_failed', 'active', 'expiring', 'suspended', 'deleted'] as const;
export const POWER_STATES = ['unknown', 'offline', 'starting', 'running', 'stopping', 'installing'] as const;

export const servers = sqliteTable(
  'servers',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Art des Servers: Minecraft-Server oder Discord-Bot */
    kind: text('kind', { enum: ['minecraft', 'discord'] }).notNull().default('minecraft'),
    planId: text('plan_id').notNull(),
    serverType: text('server_type').notNull(),
    version: text('version').notNull(),

    /** pending = wartet auf E-Mail-Bestätigung bzw. Panel-Zugang */
    status: text('status', { enum: SERVER_STATUSES }).notNull().default('pending'),
    suspensionReason: text('suspension_reason', { enum: ['cycle_expired', 'admin', 'abuse'] }),
    powerState: text('power_state', { enum: POWER_STATES }).notNull().default('unknown'),
    powerStateAt: ts('power_state_at'),

    /** Ressourcen-Snapshot zum Erstellzeitpunkt */
    memoryMb: integer('memory_mb').notNull(),
    cpuPercent: integer('cpu_percent').notNull(),
    diskMb: integer('disk_mb').notNull(),

    /** Pterodactyl-Verknüpfung */
    pteroServerId: integer('ptero_server_id'),
    pteroIdentifier: text('ptero_identifier'),
    pteroUuid: text('ptero_uuid'),
    address: text('address'),

    /** 30-Tage-Zyklus */
    cycleNumber: integer('cycle_number').notNull().default(1),
    cycleStartedAt: ts('cycle_started_at').notNull(),
    cycleEndsAt: ts('cycle_ends_at').notNull(),
    reactivationCount: integer('reactivation_count').notNull().default(0),
    lastReactivatedAt: ts('last_reactivated_at'),
    expiringSince: ts('expiring_since'),
    suspendedAt: ts('suspended_at'),

    /** Fair-Use-Pause */
    pausedAt: ts('paused_at'),
    pausedUntil: ts('paused_until'),
    pauseReason: text('pause_reason', { enum: ['max_session', 'weekly_offline', 'manual', 'cpu_overload'] }),
    /** Fair-Use für Discord-Bots: seit wann die CPU-Last ununterbrochen über der Schwelle liegt (null = normal) */
    overloadSince: ts('overload_since'),

    /** Provisionierung */
    provisioningAttempts: integer('provisioning_attempts').notNull().default(0),
    provisioningError: text('provisioning_error'),
    lastProvisionAttemptAt: ts('last_provision_attempt_at'),
    postProvisionDone: integer('post_provision_done', { mode: 'boolean' }).notNull().default(false),
    backupScheduleId: integer('backup_schedule_id'),
    /** Frist für eine offene Anfrage, die auf die Discord-Verbindung wartet – danach wird sie gelöscht (gesetzt mit der Erinnerungsmail) */
    pendingDeadlineAt: ts('pending_deadline_at'),
    /** Warteliste (Early Access): Platz wird bei der E-Mail-Bestätigung vergeben */
    waitlistPosition: integer('waitlist_position'),
    waitlistJoinedAt: ts('waitlist_joined_at'),
    /** Hardware-Stufe (aus der Warteliste): bestimmt die Pterodactyl-Location */
    nodeTier: text('node_tier', { enum: ['epyc', 'xeon'] }),
    /** Zuletzt im Panel gesetzte Server-Beschreibung (Status-Anzeige in Pterodactyl) */
    panelDescription: text('panel_description'),

    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('servers_user_idx').on(t.userId),
    index('servers_status_idx').on(t.status),
    index('servers_kind_idx').on(t.kind),
    index('servers_cycle_idx').on(t.status, t.cycleEndsAt),
    uniqueIndex('servers_ptero_server_uq').on(t.pteroServerId),
    uniqueIndex('servers_waitlist_position_uq').on(t.waitlistPosition),
  ],
);

/**
 * Laufzeit-Sessions: ein Eintrag pro Online-Phase eines Servers.
 * `open_marker` ist 1 für die offene Session und sonst NULL – der Unique-Index
 * garantiert, dass es pro Server höchstens EINE offene Session gibt
 * (Idempotenz auch bei parallelen Worker-Läufen).
 */
export const serverSessions = sqliteTable(
  'server_sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    startedAt: ts('started_at').notNull(),
    endedAt: ts('ended_at'),
    endReason: text('end_reason', { enum: ['detected', 'user', 'fair_use_session', 'fair_use_weekly', 'cycle', 'deleted'] }),
    openMarker: integer('open_marker').generatedAlwaysAs(sql`(case when "ended_at" is null then 1 else null end)`, {
      mode: 'stored',
    }),
  },
  (t) => [
    index('server_sessions_server_idx').on(t.serverId, t.startedAt),
    uniqueIndex('server_sessions_open_uq').on(t.serverId, t.openMarker),
  ],
);

/* ---------------------------------------------------------- notifications */

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    serverId: text('server_id'),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Verhindert doppelte Benachrichtigungen bei wiederholten Job-Läufen. */
    dedupeKey: text('dedupe_key').notNull(),
    emailStatus: text('email_status', { enum: ['none', 'pending', 'sent', 'failed'] }).notNull().default('none'),
    emailAttempts: integer('email_attempts').notNull().default(0),
    emailLastError: text('email_last_error'),
    emailSentAt: ts('email_sent_at'),
    readAt: ts('read_at'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex('notifications_dedupe_uq').on(t.dedupeKey),
    index('notifications_user_idx').on(t.userId, t.createdAt),
    index('notifications_email_idx').on(t.emailStatus),
  ],
);

/* ------------------------------------------------------------- audit logs */

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id'),
    serverId: text('server_id'),
    actor: text('actor', { enum: ['user', 'system', 'admin'] }).notNull(),
    action: text('action').notNull(),
    message: text('message').notNull(),
    meta: text('meta', { mode: 'json' }),
    ip: text('ip'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => [
    index('audit_logs_server_idx').on(t.serverId, t.createdAt),
    index('audit_logs_user_idx').on(t.userId, t.createdAt),
    index('audit_logs_created_idx').on(t.createdAt),
  ],
);

/* ---------------------------------------------------------- consent logs */

/** Nachweis der Cookie-/Einwilligungs-Entscheidung. `ip` und `user_agent` sind verschlüsselt (encryptField). */
export const consentLogs = sqliteTable(
  'consent_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id'),
    choice: text('choice', { enum: ['essential', 'all'] }).notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('consent_logs_created_idx').on(t.createdAt)],
);

/* ----------------------------------------------------------------- assets */

/** Hochgeladene Dateien aus dem Admin-Bereich (z. B. das Logo) – als Base64 in der verschlüsselten Datenbank */
export const assets = sqliteTable('assets', {
  key: text('key').primaryKey(),
  mime: text('mime').notNull(),
  data: text('data').notNull(),
  size: integer('size').notNull(),
  updatedAt: ts('updated_at').notNull().$defaultFn(now),
});

/* ------------------------------------------------------------- newsletter */

/** Newsletter-Abonnenten (Double-Opt-in). `ip` ist verschlüsselt (encryptField) und dient als Nachweis der Anmeldung. */
export const newsletterSubscribers = sqliteTable(
  'newsletter_subscribers',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    locale: text('locale', { enum: ['de', 'en'] }).notNull().default('en'),
    /** pending = Bestätigung steht aus · active = bestätigt · unsubscribed = abgemeldet */
    status: text('status', { enum: ['pending', 'active', 'unsubscribed'] }).notNull().default('pending'),
    /** website = Formular · signup = Häkchen beim Erstellen eines Servers */
    source: text('source').notNull().default('website'),
    ip: text('ip'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    confirmedAt: ts('confirmed_at'),
    unsubscribedAt: ts('unsubscribed_at'),
  },
  (t) => [uniqueIndex('newsletter_subscribers_email_uq').on(t.email), index('newsletter_subscribers_status_idx').on(t.status)],
);

export const newsletterCampaigns = sqliteTable(
  'newsletter_campaigns',
  {
    id: text('id').primaryKey(),
    subjectDe: text('subject_de').notNull(),
    subjectEn: text('subject_en').notNull(),
    bodyDe: text('body_de').notNull(),
    bodyEn: text('body_en').notNull(),
    ctaLabelDe: text('cta_label_de').notNull().default(''),
    ctaLabelEn: text('cta_label_en').notNull().default(''),
    ctaUrl: text('cta_url').notNull().default(''),
    /** subscribers = Newsletter-Abonnenten · all_users = alle bestätigten Konten (betriebliche Hinweise) */
    audience: text('audience', { enum: ['subscribers', 'all_users'] }).notNull().default('subscribers'),
    status: text('status', { enum: ['draft', 'sending', 'sent', 'cancelled'] }).notNull().default('draft'),
    total: integer('total').notNull().default(0),
    sent: integer('sent').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    createdBy: text('created_by'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('newsletter_campaigns_status_idx').on(t.status)],
);

/** Eine Zeile pro Empfänger einer Ausgabe – der Worker arbeitet die offenen Zeilen ab (jede Mail genau einmal). */
export const newsletterDeliveries = sqliteTable(
  'newsletter_deliveries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => newsletterCampaigns.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    locale: text('locale', { enum: ['de', 'en'] }).notNull().default('en'),
    /** Abonnent (für den Abmeldelink) – null bei betrieblichen Hinweisen an Konten */
    subscriberId: text('subscriber_id'),
    status: text('status', { enum: ['pending', 'sent', 'failed'] }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    sentAt: ts('sent_at'),
  },
  (t) => [uniqueIndex('newsletter_deliveries_uq').on(t.campaignId, t.email), index('newsletter_deliveries_status_idx').on(t.campaignId, t.status)],
);

/* ---------------------------------------------------------- dedupe marks */

/**
 * Markierungen für einmalige Nebenwirkungen (z. B. In-Game-Warnungen).
 * INSERT … ON CONFLICT DO NOTHING auf den Schlüssel → jede Warnung wird genau einmal gesendet.
 */
export const dedupeMarks = sqliteTable('dedupe_marks', {
  key: text('key').primaryKey(),
  createdAt: ts('created_at').notNull().$defaultFn(now),
});

/* ------------------------------------------------------------------- jobs */

export const jobLocks = sqliteTable('job_locks', {
  name: text('name').primaryKey(),
  owner: text('owner'),
  lockedUntil: ts('locked_until'),
  updatedAt: ts('updated_at').notNull().$defaultFn(now),
});

export const jobRuns = sqliteTable(
  'job_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    job: text('job').notNull(),
    status: text('status', { enum: ['running', 'success', 'failed'] }).notNull(),
    startedAt: ts('started_at').notNull(),
    finishedAt: ts('finished_at'),
    stats: text('stats', { mode: 'json' }),
    error: text('error'),
  },
  (t) => [index('job_runs_job_idx').on(t.job, t.startedAt)],
);

/* --------------------------------------------------------------- settings */

/** Im Admin-Bereich änderbare Einstellungen (Schlüssel „site“ = SiteSettings als JSON) */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
});

/* ---------------------------------------------------------------- discord */

/** Support-Tickets, die der Discord-Bot angelegt hat */
export const discordTickets = sqliteTable(
  'discord_tickets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Ticket-Kanal auf dem Discord-Server (null, solange er angelegt wird) */
    channelId: text('channel_id'),
    discordUserId: text('discord_user_id').notNull(),
    /** Account und Produkt auf der Website, falls das Discord-Konto verknüpft ist */
    userId: text('user_id'),
    serverId: text('server_id'),
    subject: text('subject').notNull().default(''),
    status: text('status', { enum: ['open', 'closed'] }).notNull().default('open'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    closedAt: ts('closed_at'),
  },
  (t) => [index('discord_tickets_user_idx').on(t.discordUserId, t.status), index('discord_tickets_channel_idx').on(t.channelId)],
);

/* ---------------------------------------------------------------- support chat */

/** Unterhaltungen im Support-Chat der Website. Der Besucher hält nur ein Cookie; hier steht dessen Hash. */
export const chatConversations = sqliteTable(
  'chat_conversations',
  {
    id: text('id').primaryKey(),
    /** SHA-256 des Cookie-Werts – der Wert selbst wird nie gespeichert */
    tokenHash: text('token_hash').notNull(),
    /** Angemeldeter Account bzw. das für die Weitergabe verbundene Discord-Konto */
    userId: text('user_id'),
    discordId: text('discord_id'),
    discordUsername: text('discord_username'),
    lang: text('lang', { enum: ['de', 'en'] }).notNull().default('de'),
    status: text('status', { enum: ['open', 'handoff_pending', 'handed_off'] }).notNull().default('open'),
    /** Discord-Ticket, an das übergeben wurde */
    ticketId: integer('ticket_id'),
    /** IP beim Start – verschlüsselt (encryptField), nur zur Missbrauchsabwehr */
    ip: text('ip'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
  },
  (t) => [uniqueIndex('chat_conversations_token_uq').on(t.tokenHash), index('chat_conversations_updated_idx').on(t.updatedAt)],
);

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    source: text('source', { enum: ['user', 'canned', 'ai', 'system'] }).notNull(),
    text: text('text').notNull(),
    actions: text('actions', { mode: 'json' }).$type<unknown[]>(),
    /** Verbrauch der KI für diese Antwort */
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('chat_messages_conversation_idx').on(t.conversationId, t.id)],
);

/* ------------------------------------------------------------ Einladungen auf Discord */

/** Wer wen auf den Discord-Server eingeladen hat. Jedes eingeladene Konto zählt nur einmal – für die erste Person, die es eingeladen hat. */
export const discordInvites = sqliteTable(
  'discord_invites',
  {
    /** Discord-ID des eingeladenen Mitglieds */
    inviteeId: text('invitee_id').primaryKey(),
    /** Discord-ID der Person, deren Einladungslink benutzt wurde */
    inviterId: text('inviter_id').notNull(),
    code: text('code'),
    joinedAt: ts('joined_at').notNull(),
    /** Gesetzt, solange das Mitglied den Server verlassen hat – dann zählt die Einladung nicht */
    leftAt: ts('left_at'),
  },
  (t) => [index('discord_invites_inviter_idx').on(t.inviterId)],
);

/** Freigeschaltete Belohnungen für Einladungen. Eingelöst ergeben sie einen zusätzlichen Slot für den Website-Account. */
export const inviteRewards = sqliteTable(
  'invite_rewards',
  {
    id: text('id').primaryKey(),
    /** Discord-ID der Person, die eingeladen hat */
    discordId: text('discord_id').notNull(),
    /** Stufe aus den Einstellungen – jede Stufe gibt es je Person nur einmal */
    tierId: text('tier_id').notNull(),
    invites: integer('invites').notNull(),
    reward: text('reward', { enum: ['choice', 'minecraft', 'discord'] }).notNull(),
    /** Paket-Regel der Stufe zum Zeitpunkt der Vergabe: '' = jedes Paket · 'smallest' · Paket-ID */
    planRule: text('plan_rule').notNull().default(''),
    status: text('status', { enum: ['available', 'redeemed'] }).notNull().default('available'),
    /** Nach dem Einlösen: Account, Angebot und (bei gebundenen Slots) das Paket */
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['minecraft', 'discord'] }),
    planId: text('plan_id'),
    /** dm = per Direktnachricht benachrichtigt · channel = im Ersatz-Kanal erwähnt · none = nicht zustellbar */
    notifiedVia: text('notified_via', { enum: ['dm', 'channel', 'none'] }),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    redeemedAt: ts('redeemed_at'),
  },
  (t) => [uniqueIndex('invite_rewards_tier_uq').on(t.discordId, t.tierId), index('invite_rewards_user_idx').on(t.userId)],
);

/**
 * Server-Boosts je Discord-Konto. Discord nennt Bots keine Anzahl – gezählt werden die Boost-Meldungen im
 * Systemkanal, solange das Mitglied boostet. `manual` überschreibt die Zählung (Korrektur im Admin-Bereich).
 */
export const discordBoosts = sqliteTable('discord_boosts', {
  discordId: text('discord_id').primaryKey(),
  /** Mitglied boostet gerade (premium_since ist gesetzt) */
  premium: integer('premium', { mode: 'boolean' }).notNull().default(false),
  /** Gezählte Boost-Meldungen seit Beginn des aktuellen Boosts */
  messages: integer('messages').notNull().default(0),
  /** Von Hand gesetzte Anzahl (null = automatisch zählen) */
  manual: integer('manual'),
  /** Anzahl, für die zuletzt Belohnungen angewendet und gemeldet wurden */
  applied: integer('applied').notNull().default(0),
  updatedAt: ts('updated_at').notNull().$defaultFn(now),
});

/* ------------------------------------------------------------ status page */

export const statusIncidents = sqliteTable(
  'status_incidents',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['incident', 'maintenance', 'notice'] }).notNull(),
    impact: text('impact', { enum: ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'] }).notNull(),
    components: text('components', { mode: 'json' }).$type<string[]>().notNull(),
    titleEn: text('title_en').notNull(),
    titleDe: text('title_de').notNull(),
    messageEn: text('message_en').notNull(),
    messageDe: text('message_de').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at'),
    resolvedAt: ts('resolved_at'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
  },
  (t) => [index('status_incidents_starts_idx').on(t.startsAt)],
);

/** Verlauf der Status-Prüfungen (alle 5 Minuten) – Grundlage für die Uptime */
export const statusChecks = sqliteTable(
  'status_checks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    component: text('component').notNull(),
    status: text('status', { enum: ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance', 'unknown'] }).notNull(),
    checkedAt: ts('checked_at').notNull(),
  },
  (t) => [index('status_checks_component_idx').on(t.component, t.checkedAt)],
);

export type User = typeof users.$inferSelect;
export type Server = typeof servers.$inferSelect;
export type ServerSession = typeof serverSessions.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type InviteReward = typeof inviteRewards.$inferSelect;
export type DiscordBoost = typeof discordBoosts.$inferSelect;
