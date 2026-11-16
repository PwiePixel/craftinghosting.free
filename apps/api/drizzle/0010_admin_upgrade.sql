ALTER TABLE `servers` ADD `node_id` integer;--> statement-breakpoint
ALTER TABLE `servers` ADD `upgraded_at` integer;--> statement-breakpoint
ALTER TABLE `servers` ADD `upgrade_note` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `transfer_node_id` integer;--> statement-breakpoint
ALTER TABLE `servers` ADD `transfer_started_at` integer;--> statement-breakpoint
ALTER TABLE `servers` ADD `transfer_mode` text;