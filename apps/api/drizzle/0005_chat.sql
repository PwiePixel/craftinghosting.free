CREATE TABLE `chat_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text,
	`discord_id` text,
	`discord_username` text,
	`lang` text DEFAULT 'de' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`ticket_id` integer,
	`ip` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_conversations_token_uq` ON `chat_conversations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `chat_conversations_updated_idx` ON `chat_conversations` (`updated_at`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`source` text NOT NULL,
	`text` text NOT NULL,
	`actions` text,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_messages_conversation_idx` ON `chat_messages` (`conversation_id`,`id`);