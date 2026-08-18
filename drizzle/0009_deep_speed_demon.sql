ALTER TABLE `audit_runs` ADD `confidence` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_runs` ADD `checks_verified` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_runs` ADD `checks_total` integer DEFAULT 0 NOT NULL;