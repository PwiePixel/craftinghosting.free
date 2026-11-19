DROP INDEX `banned_identities_uq`;--> statement-breakpoint
CREATE INDEX `banned_identities_hash_idx` ON `banned_identities` (`kind`,`hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `banned_identities_uq` ON `banned_identities` (`kind`,`hash`,`user_id`);--> statement-breakpoint
ALTER TABLE `servers` ADD `eula_accepted_at` integer;