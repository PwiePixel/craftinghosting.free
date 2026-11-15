CREATE TABLE `discord_boosts` (
	`discord_id` text PRIMARY KEY NOT NULL,
	`premium` integer DEFAULT false NOT NULL,
	`messages` integer DEFAULT 0 NOT NULL,
	`manual` integer,
	`applied` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
