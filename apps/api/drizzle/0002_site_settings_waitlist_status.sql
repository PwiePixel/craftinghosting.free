CREATE TABLE `settings` (
	`key` varchar(64) NOT NULL,
	`value` json NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `status_checks` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`component` varchar(32) NOT NULL,
	`status` enum('operational','degraded','partial_outage','major_outage','maintenance','unknown') NOT NULL,
	`checked_at` datetime(3) NOT NULL,
	CONSTRAINT `status_checks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `status_incidents` (
	`id` varchar(36) NOT NULL,
	`kind` enum('incident','maintenance','notice') NOT NULL,
	`impact` enum('operational','degraded','partial_outage','major_outage','maintenance') NOT NULL,
	`components` json NOT NULL,
	`title_en` varchar(160) NOT NULL,
	`title_de` varchar(160) NOT NULL,
	`message_en` text NOT NULL,
	`message_de` text NOT NULL,
	`starts_at` datetime(3) NOT NULL,
	`ends_at` datetime(3),
	`resolved_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `status_incidents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `servers` MODIFY COLUMN `status` enum('waitlist','pending','provisioning','provisioning_failed','active','expiring','suspended','deleted') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `locale` enum('de','en') NOT NULL DEFAULT 'en';--> statement-breakpoint
ALTER TABLE `servers` ADD `waitlist_position` int;--> statement-breakpoint
ALTER TABLE `servers` ADD `waitlist_joined_at` datetime(3);--> statement-breakpoint
ALTER TABLE `servers` ADD `node_tier` enum('epyc','xeon');--> statement-breakpoint
ALTER TABLE `servers` ADD CONSTRAINT `servers_waitlist_position_uq` UNIQUE(`waitlist_position`);--> statement-breakpoint
CREATE INDEX `status_checks_component_idx` ON `status_checks` (`component`,`checked_at`);--> statement-breakpoint
CREATE INDEX `status_incidents_starts_idx` ON `status_incidents` (`starts_at`);