ALTER TABLE `audit_run_modules` ADD `check_summary` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_run_modules` ADD `max_attempts` integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_run_modules` ADD `retry_after` text;--> statement-breakpoint
ALTER TABLE `audit_run_modules` ADD `retry_reason` text DEFAULT '' NOT NULL;