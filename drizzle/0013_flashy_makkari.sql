CREATE TABLE `mockups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`lead_id` integer NOT NULL,
	`token` text NOT NULL,
	`kind` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`html` text NOT NULL,
	`brand_tokens` text DEFAULT '{}' NOT NULL,
	`source` text DEFAULT 'template' NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mockups_token_unique` ON `mockups` (`token`);--> statement-breakpoint
CREATE INDEX `mockups_run_idx` ON `mockups` (`run_id`);--> statement-breakpoint
CREATE TABLE `recommendations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`service_line` text NOT NULL,
	`label` text NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`rationale_source` text DEFAULT 'none' NOT NULL,
	`finding_ids` text DEFAULT '[]' NOT NULL,
	`priority` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recommendations_run_idx` ON `recommendations` (`run_id`,`sort_order`);--> statement-breakpoint
ALTER TABLE `proposals` ADD `run_id` integer;--> statement-breakpoint
ALTER TABLE `proposals` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `tier` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `scope_items` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `opening_prose` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `pricing_placeholder` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `voice_placeholder` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `approved_at` text;