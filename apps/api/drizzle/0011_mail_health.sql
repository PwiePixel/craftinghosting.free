ALTER TABLE `notifications` ADD `dm_sent_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `email_fail_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `email_undeliverable_at` integer;