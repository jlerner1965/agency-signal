CREATE TABLE `activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`activity_type` text NOT NULL,
	`description` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_findings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`audit_id` integer NOT NULL,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`evidence` text NOT NULL,
	`recommendation` text NOT NULL,
	`impact` text NOT NULL,
	`affected_url` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`website` text NOT NULL,
	`score` integer NOT NULL,
	`visibility_score` integer NOT NULL,
	`conversion_score` integer NOT NULL,
	`technical_score` integer NOT NULL,
	`trust_score` integer NOT NULL,
	`response_status` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agency_name` text NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`carrier` text DEFAULT 'Independent' NOT NULL,
	`city` text NOT NULL,
	`state` text DEFAULT 'CO' NOT NULL,
	`website` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'New' NOT NULL,
	`rating` real,
	`review_count` integer DEFAULT 0 NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`visibility_score` integer DEFAULT 0 NOT NULL,
	`conversion_score` integer DEFAULT 0 NOT NULL,
	`technical_score` integer DEFAULT 0 NOT NULL,
	`trust_score` integer DEFAULT 0 NOT NULL,
	`last_contacted_at` text,
	`next_follow_up_at` text,
	`last_audit_at` text,
	`report_views` integer DEFAULT 0 NOT NULL,
	`report_token` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_report_token_unique` ON `leads` (`report_token`);--> statement-breakpoint
CREATE TABLE `report_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
