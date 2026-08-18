CREATE TABLE `competitor_audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`name` text NOT NULL,
	`website` text NOT NULL,
	`score` integer NOT NULL,
	`visibility_score` integer NOT NULL,
	`conversion_score` integer NOT NULL,
	`technical_score` integer NOT NULL,
	`trust_score` integer NOT NULL,
	`pages_audited` integer DEFAULT 1 NOT NULL,
	`confidence_score` integer DEFAULT 0 NOT NULL,
	`checks_passed` integer DEFAULT 0 NOT NULL,
	`checks_failed` integer DEFAULT 0 NOT NULL,
	`check_summary` text DEFAULT '[]' NOT NULL,
	`lighthouse_summary` text DEFAULT 'null' NOT NULL,
	`screenshot_key` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `audits` ADD `screenshot_key` text DEFAULT '' NOT NULL;