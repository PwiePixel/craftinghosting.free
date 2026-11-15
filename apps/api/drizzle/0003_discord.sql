CREATE TABLE `discord_tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` text,
	`discord_user_id` text NOT NULL,
	`user_id` text,
	`server_id` text,
	`subject` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`closed_at` integer
);
--> statement-breakpoint
CREATE INDEX `discord_tickets_user_idx` ON `discord_tickets` (`discord_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `discord_tickets_channel_idx` ON `discord_tickets` (`channel_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `discord_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `discord_username` text;--> statement-breakpoint
ALTER TABLE `users` ADD `discord_linked_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `discord_customer_role` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `discord_sync_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `users_discord_uq` ON `users` (`discord_id`);