PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_server_addons` (
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
	`auto_renew` integer DEFAULT false NOT NULL,
	`customer_id` text,
	`mandate_id` text,
	`renew_for` integer,
	`subscription_canceled_at` integer,
	`fulfilment` text DEFAULT 'none' NOT NULL,
	`consent_at` integer,
	`end_reason` text,
	`admin_note` text,
	`created_at` integer NOT NULL,
	`activated_at` integer,
	`ended_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_server_addons`("id", "ref", "user_id", "server_id", "addon_id", "name", "icon", "effect", "price_cents", "period_days", "status", "paid_until", "renewal_requested_at", "checkout_id", "checkout_url", "checkout_at", "checkout_count", "fulfilment", "consent_at", "end_reason", "admin_note", "created_at", "activated_at", "ended_at") SELECT "id", "ref", "user_id", "server_id", "addon_id", "name", "icon", "effect", "price_cents", "period_days", "status", "paid_until", "renewal_requested_at", "checkout_id", "checkout_url", "checkout_at", "checkout_count", "fulfilment", "consent_at", "end_reason", "admin_note", "created_at", "activated_at", "ended_at" FROM `server_addons`;--> statement-breakpoint
DROP TABLE `server_addons`;--> statement-breakpoint
ALTER TABLE `__new_server_addons` RENAME TO `server_addons`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `server_addons_ref_uq` ON `server_addons` (`ref`);--> statement-breakpoint
CREATE UNIQUE INDEX `server_addons_checkout_uq` ON `server_addons` (`checkout_id`);--> statement-breakpoint
CREATE INDEX `server_addons_server_idx` ON `server_addons` (`server_id`,`status`);--> statement-breakpoint
CREATE INDEX `server_addons_status_idx` ON `server_addons` (`status`,`paid_until`);--> statement-breakpoint
CREATE INDEX `server_addons_user_idx` ON `server_addons` (`user_id`);