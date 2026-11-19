CREATE TABLE `warning_carry` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`kind` text NOT NULL,
	`hash` text NOT NULL,
	`reason` text NOT NULL,
	`server_name` text,
	`warned_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `warning_carry_hash_idx` ON `warning_carry` (`kind`,`hash`);--> statement-breakpoint
CREATE INDEX `warning_carry_group_idx` ON `warning_carry` (`group_id`);