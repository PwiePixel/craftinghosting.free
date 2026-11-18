CREATE TABLE `partner_players` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text,
	`blocked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partner_players_external_uq` ON `partner_players` (`partner_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `partner_servers` (
	`server_id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`player_id` text NOT NULL,
	`host_active` integer DEFAULT false NOT NULL,
	`heartbeat_at` integer,
	`session_started_at` integer,
	`run_seconds` integer DEFAULT 0 NOT NULL,
	`counted_at` integer,
	`last_start_at` integer,
	`last_stop_at` integer,
	`stop_reason` text,
	`cooldown_until` integer,
	`warned_minutes` integer,
	`eula_accepted_at` integer,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `partner_players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `partner_servers_partner_idx` ON `partner_servers` (`partner_id`);--> statement-breakpoint
CREATE INDEX `partner_servers_player_idx` ON `partner_servers` (`player_id`);--> statement-breakpoint
CREATE INDEX `partner_servers_active_idx` ON `partner_servers` (`host_active`);--> statement-breakpoint
CREATE TABLE `partners` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`user_id` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`plan_id` text NOT NULL,
	`max_servers` integer DEFAULT 100 NOT NULL,
	`max_servers_per_player` integer DEFAULT 1 NOT NULL,
	`session_max_hours` integer DEFAULT 24 NOT NULL,
	`cooldown_hours` integer DEFAULT 2 NOT NULL,
	`heartbeat_timeout_seconds` integer DEFAULT 180 NOT NULL,
	`delete_after_idle_days` integer DEFAULT 30 NOT NULL,
	`node_ids` text DEFAULT '[]' NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partners_key_uq` ON `partners` (`key_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `partners_user_uq` ON `partners` (`user_id`);--> statement-breakpoint
ALTER TABLE `servers` ADD `partner_id` text;--> statement-breakpoint
CREATE INDEX `servers_partner_idx` ON `servers` (`partner_id`);