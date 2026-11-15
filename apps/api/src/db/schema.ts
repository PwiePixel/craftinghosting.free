/**
 * Datenbankschema (MariaDB / MySQL) – Drizzle ORM.
 * Migrationen erzeugen: npm run db:generate  ·  anwenden: npm run db:migrate
 *
 * Alle Zeitstempel werden in UTC gespeichert.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

const ts = (name: string) => datetime(name, { mode: 'date', fsp: 3 });
const now = () => new Date();

/* ------------------------------------------------------------------ users */

export const users = mysqlTable(
  'users',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    email: varchar('email', { length: 254 }).notNull(),
    role: mysqlEnum('role', ['user', 'admin']).notNull().default('user'),
    status: mysqlEnum('status', ['active', 'locked']).notNull().default('active'),
    emailVerifiedAt: ts('email_verified_at'),
    acceptedTermsAt: ts('accepted_terms_at').notNull(),
    /** Verknüpftes Pterodactyl-Konto (die Website speichert keine Passwörter) */
    pteroUserId: int('ptero_user_id'),
    pteroUsername: varchar('ptero_username', { length: 191 }),
    /** Sprache für E-Mails, Chat-Hinweise und Panel-Beschreibung (zuletzt auf der Website verwendet) */
    locale: mysqlEnum('locale', ['de', 'en']).notNull().default('en'),
    lastLoginAt: ts('last_login_at'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email), uniqueIndex('users_ptero_uq').on(t.pteroUserId)],
);

/* --------------------------------------------------------------- sessions */

export const authSessions = mysqlTable(
  'auth_sessions',
  {
    /** SHA-256 des Session-Tokens – das Token selbst wird nie gespeichert. */
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull().$defaultFn(now),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 255 }),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('auth_sessions_user_idx').on(t.userId), index('auth_sessions_expires_idx').on(t.expiresAt)],
);

export const emailTokens = mysqlTable(
  'email_tokens',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** verify_email: Bestätigung + Anmeldung · login: Anmeldelink */
    type: mysqlEnum('type', ['verify_email', 'login']).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex('email_tokens_hash_uq').on(t.tokenHash), index('email_tokens_user_idx').on(t.userId, t.type)],
);

/* ---------------------------------------------------------------- servers */

export const SERVER_STATUSES = ['waitlist', 'pending', 'provisioning', 'provisioning_failed', 'active', 'expiring', 'suspended', 'deleted'] as const;
export const POWER_STATES = ['unknown', 'offline', 'starting', 'running', 'stopping', 'installing'] as const;

export const servers = mysqlTable(
  'servers',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 64 }).notNull(),
    planId: varchar('plan_id', { length: 32 }).notNull(),
    serverType: varchar('server_type', { length: 32 }).notNull(),
    version: varchar('version', { length: 32 }).notNull(),

    /** pending = wartet auf E-Mail-Bestätigung bzw. Panel-Zugang */
    status: mysqlEnum('status', SERVER_STATUSES).notNull().default('pending'),
    suspensionReason: mysqlEnum('suspension_reason', ['cycle_expired', 'admin', 'abuse']),
    powerState: mysqlEnum('power_state', POWER_STATES).notNull().default('unknown'),
    powerStateAt: ts('power_state_at'),

    /** Ressourcen-Snapshot zum Erstellzeitpunkt */
    memoryMb: int('memory_mb').notNull(),
    cpuPercent: int('cpu_percent').notNull(),
    diskMb: int('disk_mb').notNull(),

    /** Pterodactyl-Verknüpfung */
    pteroServerId: int('ptero_server_id'),
    pteroIdentifier: varchar('ptero_identifier', { length: 16 }),
    pteroUuid: varchar('ptero_uuid', { length: 36 }),
    address: varchar('address', { length: 128 }),

    /** 30-Tage-Zyklus */
    cycleNumber: int('cycle_number').notNull().default(1),
    cycleStartedAt: ts('cycle_started_at').notNull(),
    cycleEndsAt: ts('cycle_ends_at').notNull(),
    reactivationCount: int('reactivation_count').notNull().default(0),
    lastReactivatedAt: ts('last_reactivated_at'),
    expiringSince: ts('expiring_since'),
    suspendedAt: ts('suspended_at'),

    /** Fair-Use-Pause */
    pausedAt: ts('paused_at'),
    pausedUntil: ts('paused_until'),
    pauseReason: mysqlEnum('pause_reason', ['max_session', 'weekly_offline', 'manual']),

    /** Provisionierung */
    provisioningAttempts: int('provisioning_attempts').notNull().default(0),
    provisioningError: varchar('provisioning_error', { length: 500 }),
    lastProvisionAttemptAt: ts('last_provision_attempt_at'),
    postProvisionDone: boolean('post_provision_done').notNull().default(false),
    backupScheduleId: int('backup_schedule_id'),
    /** Warteliste (Early Access): Platz wird bei der E-Mail-Bestätigung vergeben */
    waitlistPosition: int('waitlist_position'),
    waitlistJoinedAt: ts('waitlist_joined_at'),
    /** Hardware-Stufe (aus der Warteliste): bestimmt die Pterodactyl-Location */
    nodeTier: mysqlEnum('node_tier', ['epyc', 'xeon']),
    /** Zuletzt im Panel gesetzte Server-Beschreibung (Status-Anzeige in Pterodactyl) */
    panelDescription: varchar('panel_description', { length: 255 }),

    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('servers_user_idx').on(t.userId),
    index('servers_status_idx').on(t.status),
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
export const serverSessions = mysqlTable(
  'server_sessions',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    serverId: varchar('server_id', { length: 36 })
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    startedAt: ts('started_at').notNull(),
    endedAt: ts('ended_at'),
    endReason: mysqlEnum('end_reason', ['detected', 'user', 'fair_use_session', 'fair_use_weekly', 'cycle', 'deleted']),
    openMarker: tinyint('open_marker').generatedAlwaysAs(sql`(case when \`ended_at\` is null then 1 else null end)`, {
      mode: 'stored',
    }),
  },
  (t) => [
    index('server_sessions_server_idx').on(t.serverId, t.startedAt),
    uniqueIndex('server_sessions_open_uq').on(t.serverId, t.openMarker),
  ],
);

/* ---------------------------------------------------------- notifications */

export const notifications = mysqlTable(
  'notifications',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    serverId: varchar('server_id', { length: 36 }),
    type: varchar('type', { length: 48 }).notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    body: text('body').notNull(),
    /** Verhindert doppelte Benachrichtigungen bei wiederholten Job-Läufen. */
    dedupeKey: varchar('dedupe_key', { length: 191 }).notNull(),
    emailStatus: mysqlEnum('email_status', ['none', 'pending', 'sent', 'failed']).notNull().default('none'),
    emailAttempts: int('email_attempts').notNull().default(0),
    emailLastError: varchar('email_last_error', { length: 500 }),
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

export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    userId: varchar('user_id', { length: 36 }),
    serverId: varchar('server_id', { length: 36 }),
    actor: mysqlEnum('actor', ['user', 'system', 'admin']).notNull(),
    action: varchar('action', { length: 64 }).notNull(),
    message: varchar('message', { length: 500 }).notNull(),
    meta: json('meta'),
    ip: varchar('ip', { length: 64 }),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => [
    index('audit_logs_server_idx').on(t.serverId, t.createdAt),
    index('audit_logs_user_idx').on(t.userId, t.createdAt),
    index('audit_logs_created_idx').on(t.createdAt),
  ],
);

/* ---------------------------------------------------------- dedupe marks */

/**
 * Markierungen für einmalige Nebenwirkungen (z. B. In-Game-Warnungen).
 * INSERT IGNORE auf den Schlüssel → jede Warnung wird genau einmal gesendet.
 */
export const dedupeMarks = mysqlTable('dedupe_marks', {
  key: varchar('key', { length: 191 }).primaryKey(),
  createdAt: ts('created_at').notNull().$defaultFn(now),
});

/* ------------------------------------------------------------------- jobs */

export const jobLocks = mysqlTable('job_locks', {
  name: varchar('name', { length: 64 }).primaryKey(),
  owner: varchar('owner', { length: 64 }),
  lockedUntil: ts('locked_until'),
  updatedAt: ts('updated_at').notNull().$defaultFn(now),
});

export const jobRuns = mysqlTable(
  'job_runs',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    job: varchar('job', { length: 64 }).notNull(),
    status: mysqlEnum('status', ['running', 'success', 'failed']).notNull(),
    startedAt: ts('started_at').notNull(),
    finishedAt: ts('finished_at'),
    stats: json('stats'),
    error: text('error'),
  },
  (t) => [index('job_runs_job_idx').on(t.job, t.startedAt)],
);

/* --------------------------------------------------------------- settings */

/** Im Admin-Bereich änderbare Einstellungen (Schlüssel „site“ = SiteSettings als JSON) */
export const settings = mysqlTable('settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: json('value').notNull(),
  updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
});

/* ------------------------------------------------------------ status page */

export const statusIncidents = mysqlTable(
  'status_incidents',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    kind: mysqlEnum('kind', ['incident', 'maintenance', 'notice']).notNull(),
    impact: mysqlEnum('impact', ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance']).notNull(),
    components: json('components').$type<string[]>().notNull(),
    titleEn: varchar('title_en', { length: 160 }).notNull(),
    titleDe: varchar('title_de', { length: 160 }).notNull(),
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
export const statusChecks = mysqlTable(
  'status_checks',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    component: varchar('component', { length: 32 }).notNull(),
    status: mysqlEnum('status', ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance', 'unknown']).notNull(),
    checkedAt: ts('checked_at').notNull(),
  },
  (t) => [index('status_checks_component_idx').on(t.component, t.checkedAt)],
);

export type User = typeof users.$inferSelect;
export type Server = typeof servers.$inferSelect;
export type ServerSession = typeof serverSessions.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
