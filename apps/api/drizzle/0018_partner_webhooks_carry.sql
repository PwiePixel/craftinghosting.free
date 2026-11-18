CREATE TABLE `partner_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`delivered_at` integer,
	`failed_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `partner_webhook_events_due_idx` ON `partner_webhook_events` (`delivered_at`,`failed_at`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `partner_webhook_events_partner_idx` ON `partner_webhook_events` (`partner_id`);--> statement-breakpoint
ALTER TABLE `partner_players` ADD `carry_run_seconds` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `partner_players` ADD `carry_last_stop_at` integer;--> statement-breakpoint
ALTER TABLE `partner_players` ADD `carry_cooldown_until` integer;--> statement-breakpoint
ALTER TABLE `partner_servers` ADD `installed_notified` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `partner_servers` ADD `running_notified` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `partner_servers` ADD `cooldown_notified` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `partner_servers` ADD `deletion_warned_at` integer;--> statement-breakpoint
ALTER TABLE `partners` ADD `webhook_url` text;--> statement-breakpoint
ALTER TABLE `partners` ADD `webhook_secret` text;