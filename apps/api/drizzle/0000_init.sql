CREATE TABLE `audit_logs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` varchar(36),
	`server_id` varchar(36),
	`actor` enum('user','system','admin') NOT NULL,
	`action` varchar(64) NOT NULL,
	`message` varchar(500) NOT NULL,
	`meta` json,
	`ip` varchar(64),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` varchar(64) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	`ip` varchar(64),
	`user_agent` varchar(255),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `auth_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dedupe_marks` (
	`key` varchar(191) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `dedupe_marks_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `email_tokens` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`type` enum('verify_email','login') NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`used_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `email_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_tokens_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `job_locks` (
	`name` varchar(64) NOT NULL,
	`owner` varchar(64),
	`locked_until` datetime(3),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `job_locks_name` PRIMARY KEY(`name`)
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`job` varchar(64) NOT NULL,
	`status` enum('running','success','failed') NOT NULL,
	`started_at` datetime(3) NOT NULL,
	`finished_at` datetime(3),
	`stats` json,
	`error` text,
	CONSTRAINT `job_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`server_id` varchar(36),
	`type` varchar(48) NOT NULL,
	`title` varchar(160) NOT NULL,
	`body` text NOT NULL,
	`dedupe_key` varchar(191) NOT NULL,
	`email_status` enum('none','pending','sent','failed') NOT NULL DEFAULT 'none',
	`email_attempts` int NOT NULL DEFAULT 0,
	`email_last_error` varchar(500),
	`email_sent_at` datetime(3),
	`read_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `notifications_dedupe_uq` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `server_sessions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`server_id` varchar(36) NOT NULL,
	`started_at` datetime(3) NOT NULL,
	`ended_at` datetime(3),
	`end_reason` enum('detected','user','fair_use_session','fair_use_weekly','cycle','deleted'),
	`open_marker` tinyint GENERATED ALWAYS AS ((case when `ended_at` is null then 1 else null end)) STORED,
	CONSTRAINT `server_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `server_sessions_open_uq` UNIQUE(`server_id`,`open_marker`)
);
--> statement-breakpoint
CREATE TABLE `servers` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`name` varchar(64) NOT NULL,
	`plan_id` varchar(32) NOT NULL,
	`server_type` varchar(32) NOT NULL,
	`version` varchar(32) NOT NULL,
	`status` enum('pending','provisioning','provisioning_failed','active','expiring','suspended','deleted') NOT NULL DEFAULT 'pending',
	`suspension_reason` enum('cycle_expired','admin','abuse'),
	`power_state` enum('unknown','offline','starting','running','stopping','installing') NOT NULL DEFAULT 'unknown',
	`power_state_at` datetime(3),
	`memory_mb` int NOT NULL,
	`cpu_percent` int NOT NULL,
	`disk_mb` int NOT NULL,
	`ptero_server_id` int,
	`ptero_identifier` varchar(16),
	`ptero_uuid` varchar(36),
	`address` varchar(128),
	`cycle_number` int NOT NULL DEFAULT 1,
	`cycle_started_at` datetime(3) NOT NULL,
	`cycle_ends_at` datetime(3) NOT NULL,
	`reactivation_count` int NOT NULL DEFAULT 0,
	`last_reactivated_at` datetime(3),
	`expiring_since` datetime(3),
	`suspended_at` datetime(3),
	`paused_at` datetime(3),
	`paused_until` datetime(3),
	`pause_reason` enum('max_session','weekly_offline','manual'),
	`provisioning_attempts` int NOT NULL DEFAULT 0,
	`provisioning_error` varchar(500),
	`last_provision_attempt_at` datetime(3),
	`post_provision_done` boolean NOT NULL DEFAULT false,
	`backup_schedule_id` int,
	`panel_description` varchar(255),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`deleted_at` datetime(3),
	CONSTRAINT `servers_id` PRIMARY KEY(`id`),
	CONSTRAINT `servers_ptero_server_uq` UNIQUE(`ptero_server_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(254) NOT NULL,
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`status` enum('active','locked') NOT NULL DEFAULT 'active',
	`email_verified_at` datetime(3),
	`accepted_terms_at` datetime(3) NOT NULL,
	`ptero_user_id` int,
	`ptero_username` varchar(191),
	`last_login_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_uq` UNIQUE(`email`),
	CONSTRAINT `users_ptero_uq` UNIQUE(`ptero_user_id`)
);
--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `email_tokens` ADD CONSTRAINT `email_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `server_sessions` ADD CONSTRAINT `server_sessions_server_id_servers_id_fk` FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `servers` ADD CONSTRAINT `servers_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_logs_server_idx` ON `audit_logs` (`server_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_user_idx` ON `audit_logs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expires_idx` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `email_tokens_user_idx` ON `email_tokens` (`user_id`,`type`);--> statement-breakpoint
CREATE INDEX `job_runs_job_idx` ON `job_runs` (`job`,`started_at`);--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_email_idx` ON `notifications` (`email_status`);--> statement-breakpoint
CREATE INDEX `server_sessions_server_idx` ON `server_sessions` (`server_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `servers_user_idx` ON `servers` (`user_id`);--> statement-breakpoint
CREATE INDEX `servers_status_idx` ON `servers` (`status`);--> statement-breakpoint
CREATE INDEX `servers_cycle_idx` ON `servers` (`status`,`cycle_ends_at`);