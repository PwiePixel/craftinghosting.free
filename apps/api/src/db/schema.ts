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
    registrationIp: text('registration_ip'),
    lastLoginIp: text('last_login_ip'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email), uniqueIndex('users_ptero_uq').on(t.pteroUserId)],
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
    /** verify_email: Bestätigung + Anmeldung · login: Anmeldelink */
    type: text('type', { enum: ['verify_email', 'login'] }).notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
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
    pauseReason: text('pause_reason', { enum: ['max_session', 'weekly_offline', 'manual'] }),

    /** Provisionierung */
    provisioningAttempts: integer('provisioning_attempts').notNull().default(0),
    provisioningError: text('provisioning_error'),
    lastProvisionAttemptAt: ts('last_provision_attempt_at'),
    postProvisionDone: integer('post_provision_done', { mode: 'boolean' }).notNull().default(false),
    backupScheduleId: integer('backup_schedule_id'),
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
