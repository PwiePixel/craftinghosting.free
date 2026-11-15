CREATE TABLE `newsletter_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_de` text NOT NULL,
	`subject_en` text NOT NULL,
	`body_de` text NOT NULL,
	`body_en` text NOT NULL,
	`cta_label_de` text DEFAULT '' NOT NULL,
	`cta_label_en` text DEFAULT '' NOT NULL,
	`cta_url` text DEFAULT '' NOT NULL,
	`audience` text DEFAULT 'subscribers' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `newsletter_campaigns_status_idx` ON `newsletter_campaigns` (`status`);--> statement-breakpoint
CREATE TABLE `newsletter_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` text NOT NULL,
	`email` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`subscriber_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`sent_at` integer,
	FOREIGN KEY (`campaign_id`) REFERENCES `newsletter_campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `newsletter_deliveries_uq` ON `newsletter_deliveries` (`campaign_id`,`email`);--> statement-breakpoint
CREATE INDEX `newsletter_deliveries_status_idx` ON `newsletter_deliveries` (`campaign_id`,`status`);--> statement-breakpoint
CREATE TABLE `newsletter_subscribers` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text DEFAULT 'website' NOT NULL,
	`ip` text,
	`created_at` integer NOT NULL,
	`confirmed_at` integer,
	`unsubscribed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `newsletter_subscribers_email_uq` ON `newsletter_subscribers` (`email`);--> statement-breakpoint
CREATE INDEX `newsletter_subscribers_status_idx` ON `newsletter_subscribers` (`status`);