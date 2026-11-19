CREATE TABLE `banned_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`hash` text NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `banned_identities_uq` ON `banned_identities` (`kind`,`hash`);--> statement-breakpoint
CREATE INDEX `banned_identities_user_idx` ON `banned_identities` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_warnings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`server_id` text,
	`server_name` text,
	`reason` text NOT NULL,
	`note` text,
	`notification_key` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_warnings_user_idx` ON `user_warnings` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `suspended_until` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `banned_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `ban_delete_at` integer;