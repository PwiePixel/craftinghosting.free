CREATE TABLE `discord_invites` (
	`invitee_id` text PRIMARY KEY NOT NULL,
	`inviter_id` text NOT NULL,
	`code` text,
	`joined_at` integer NOT NULL,
	`left_at` integer
);
--> statement-breakpoint
CREATE INDEX `discord_invites_inviter_idx` ON `discord_invites` (`inviter_id`);--> statement-breakpoint
CREATE TABLE `invite_rewards` (
	`id` text PRIMARY KEY NOT NULL,
	`discord_id` text NOT NULL,
	`tier_id` text NOT NULL,
	`invites` integer NOT NULL,
	`reward` text NOT NULL,
	`plan_rule` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`user_id` text,
	`kind` text,
	`plan_id` text,
	`notified_via` text,
	`created_at` integer NOT NULL,
	`redeemed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_rewards_tier_uq` ON `invite_rewards` (`discord_id`,`tier_id`);--> statement-breakpoint
CREATE INDEX `invite_rewards_user_idx` ON `invite_rewards` (`user_id`);