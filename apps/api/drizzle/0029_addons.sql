CREATE TABLE `addon_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`server_addon_id` text NOT NULL,
	`ref` text NOT NULL,
	`user_id` text NOT NULL,
	`server_id` text NOT NULL,
	`addon_id` text NOT NULL,
	`addon_name` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`period_days` integer NOT NULL,
	`provider` text NOT NULL,
	`provider_ref` text,
	`confirmed_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `addon_payments_provider_ref_uq` ON `addon_payments` (`provider_ref`);--> statement-breakpoint
CREATE INDEX `addon_payments_addon_idx` ON `addon_payments` (`server_addon_id`);--> statement-breakpoint
CREATE INDEX `addon_payments_created_idx` ON `addon_payments` (`created_at`);--> statement-breakpoint
CREATE TABLE `server_addons` (
	`id` text PRIMARY KEY NOT NULL,
	`ref` text NOT NULL,
	`user_id` text NOT NULL,
	`server_id` text NOT NULL,
	`addon_id` text NOT NULL,
	`name` text NOT NULL,
	`icon` text DEFAULT 'plus' NOT NULL,
	`effect` text NOT NULL,
	`price_cents` integer NOT NULL,
	`period_days` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`paid_until` integer,
	`renewal_requested_at` integer,
	`checkout_id` text,
	`checkout_url` text,
	`checkout_at` integer,
	`checkout_count` integer DEFAULT 0 NOT NULL,
	`fulfilment` text DEFAULT 'none' NOT NULL,
	`consent_at` integer,
	`end_reason` text,
	`admin_note` text,
	`created_at` integer NOT NULL,
	`activated_at` integer,
	`ended_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `server_addons_ref_uq` ON `server_addons` (`ref`);--> statement-breakpoint
CREATE UNIQUE INDEX `server_addons_checkout_uq` ON `server_addons` (`checkout_id`);--> statement-breakpoint
CREATE INDEX `server_addons_server_idx` ON `server_addons` (`server_id`,`status`);--> statement-breakpoint
CREATE INDEX `server_addons_status_idx` ON `server_addons` (`status`,`paid_until`);--> statement-breakpoint
CREATE INDEX `server_addons_user_idx` ON `server_addons` (`user_id`);--> statement-breakpoint
ALTER TABLE `servers` ADD `always_on_since` integer;--> statement-breakpoint
ALTER TABLE `servers` ADD `fair_use_reset_at` integer;