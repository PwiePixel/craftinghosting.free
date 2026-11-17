ALTER TABLE `auth_sessions` ADD `persistent` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `stay_signed_in` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `login_password_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `login_fails` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `login_locked_until` integer;