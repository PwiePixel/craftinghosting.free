CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`server_id` text,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`message` text NOT NULL,
	`meta` text,
	`ip` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_server_idx` ON `audit_logs` (`server_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_user_idx` ON `audit_logs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expires_idx` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `consent_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`choice` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `consent_logs_created_idx` ON `consent_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `dedupe_marks` (
	`key` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_tokens_hash_uq` ON `email_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `email_tokens_user_idx` ON `email_tokens` (`user_id`,`type`);--> statement-breakpoint
CREATE TABLE `job_locks` (
	`name` text PRIMARY KEY NOT NULL,
	`owner` text,
	`locked_until` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`stats` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `job_runs_job_idx` ON `job_runs` (`job`,`started_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`server_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`email_status` text DEFAULT 'none' NOT NULL,
	`email_attempts` integer DEFAULT 0 NOT NULL,
	`email_last_error` text,
	`email_sent_at` integer,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe_uq` ON `notifications` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_email_idx` ON `notifications` (`email_status`);--> statement-breakpoint
CREATE TABLE `server_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`end_reason` text,
	`open_marker` integer GENERATED ALWAYS AS ((case when "ended_at" is null then 1 else null end)) STORED,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `server_sessions_server_idx` ON `server_sessions` (`server_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `server_sessions_open_uq` ON `server_sessions` (`server_id`,`open_marker`);--> statement-breakpoint
CREATE TABLE `servers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'minecraft' NOT NULL,
	`plan_id` text NOT NULL,
	`server_type` text NOT NULL,
	`version` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`suspension_reason` text,
	`power_state` text DEFAULT 'unknown' NOT NULL,
	`power_state_at` integer,
	`memory_mb` integer NOT NULL,
	`cpu_percent` integer NOT NULL,
	`disk_mb` integer NOT NULL,
	`ptero_server_id` integer,
	`ptero_identifier` text,
	`ptero_uuid` text,
	`address` text,
	`cycle_number` integer DEFAULT 1 NOT NULL,
	`cycle_started_at` integer NOT NULL,
	`cycle_ends_at` integer NOT NULL,
	`reactivation_count` integer DEFAULT 0 NOT NULL,
	`last_reactivated_at` integer,
	`expiring_since` integer,
	`suspended_at` integer,
	`paused_at` integer,
	`paused_until` integer,
	`pause_reason` text,
	`overload_since` integer,
	`provisioning_attempts` integer DEFAULT 0 NOT NULL,
	`provisioning_error` text,
	`last_provision_attempt_at` integer,
	`post_provision_done` integer DEFAULT false NOT NULL,
	`backup_schedule_id` integer,
	`waitlist_position` integer,
	`waitlist_joined_at` integer,
	`node_tier` text,
	`panel_description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `servers_user_idx` ON `servers` (`user_id`);--> statement-breakpoint
CREATE INDEX `servers_status_idx` ON `servers` (`status`);--> statement-breakpoint
CREATE INDEX `servers_kind_idx` ON `servers` (`kind`);--> statement-breakpoint
CREATE INDEX `servers_cycle_idx` ON `servers` (`status`,`cycle_ends_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `servers_ptero_server_uq` ON `servers` (`ptero_server_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `servers_waitlist_position_uq` ON `servers` (`waitlist_position`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `status_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`component` text NOT NULL,
	`status` text NOT NULL,
	`checked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `status_checks_component_idx` ON `status_checks` (`component`,`checked_at`);--> statement-breakpoint
CREATE TABLE `status_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`impact` text NOT NULL,
	`components` text NOT NULL,
	`title_en` text NOT NULL,
	`title_de` text NOT NULL,
	`message_en` text NOT NULL,
	`message_de` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `status_incidents_starts_idx` ON `status_incidents` (`starts_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`email_verified_at` integer,
	`accepted_terms_at` integer NOT NULL,
	`ptero_user_id` integer,
	`ptero_username` text,
	`locale` text DEFAULT 'en' NOT NULL,
	`last_login_at` integer,
	`registration_ip` text,
	`last_login_ip` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_ptero_uq` ON `users` (`ptero_user_id`);