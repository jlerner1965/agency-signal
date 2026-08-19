CREATE TABLE `audit_run_modules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`module` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`cost_cents` integer DEFAULT 0 NOT NULL,
	`finding_count` integer DEFAULT 0 NOT NULL,
	`payload_ids` text DEFAULT '[]' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `audit_run_modules_run_idx` ON `audit_run_modules` (`run_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `audit_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`website` text NOT NULL,
	`status` text DEFAULT 'Queued' NOT NULL,
	`overall_score` integer,
	`visibility_score` integer,
	`conversion_score` integer,
	`technical_score` integer,
	`trust_score` integer,
	`reachable` integer,
	`cost_cents` integer DEFAULT 0 NOT NULL,
	`review_status` text DEFAULT 'Unreviewed' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`started_at` text,
	`finished_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_runs_lead_idx` ON `audit_runs` (`lead_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `findings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`module` text NOT NULL,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`evidence` text NOT NULL,
	`recommendation` text DEFAULT '' NOT NULL,
	`impact_note` text DEFAULT '' NOT NULL,
	`impact_score` integer DEFAULT 3 NOT NULL,
	`effort_score` integer DEFAULT 3 NOT NULL,
	`priority` real DEFAULT 0 NOT NULL,
	`affected_url` text DEFAULT '' NOT NULL,
	`evidence_screenshot_key` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `findings_run_idx` ON `findings` (`run_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `raw_payloads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`module` text NOT NULL,
	`source` text NOT NULL,
	`request_key` text NOT NULL,
	`fetched_on` text NOT NULL,
	`ok` integer DEFAULT true NOT NULL,
	`failure_reason` text DEFAULT '' NOT NULL,
	`payload` text DEFAULT 'null' NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `raw_payloads_cache_idx` ON `raw_payloads` (`request_key`,`fetched_on`);--> statement-breakpoint
CREATE INDEX `raw_payloads_run_idx` ON `raw_payloads` (`run_id`);--> statement-breakpoint
ALTER TABLE `leads` ADD `place_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `resolved_website_at` text;