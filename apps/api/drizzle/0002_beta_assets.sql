CREATE TABLE `assets` (
	`key` text PRIMARY KEY NOT NULL,
	`mime` text NOT NULL,
	`data` text NOT NULL,
	`size` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD `beta` integer DEFAULT false NOT NULL;