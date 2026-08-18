PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agency_name` text NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`carrier` text DEFAULT 'Independent' NOT NULL,
	`city` text NOT NULL,
	`state` text DEFAULT 'CO' NOT NULL,
	`website` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Identified' NOT NULL,
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
	`fit_score` integer DEFAULT 0 NOT NULL,
	`need_score` integer DEFAULT 0 NOT NULL,
	`intent_score` integer DEFAULT 0 NOT NULL,
	`urgency_score` integer DEFAULT 0 NOT NULL,
	`reachability_score` integer DEFAULT 0 NOT NULL,
	`qualification_status` text DEFAULT 'Unqualified' NOT NULL,
	`business_objective` text DEFAULT '' NOT NULL,
	`pain_point` text DEFAULT '' NOT NULL,
	`current_provider` text DEFAULT '' NOT NULL,
	`decision_maker` text DEFAULT '' NOT NULL,
	`budget_range` text DEFAULT '' NOT NULL,
	`desired_timeline` text DEFAULT '' NOT NULL,
	`next_committed_step` text DEFAULT '' NOT NULL,
	`objection` text DEFAULT '' NOT NULL,
	`loss_reason` text DEFAULT '' NOT NULL,
	`deal_value` integer DEFAULT 0 NOT NULL,
	`sequence_status` text DEFAULT 'Not started' NOT NULL,
	`sequence_step` integer DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_leads`("id", "agency_name", "contact_name", "carrier", "city", "state", "website", "email", "phone", "status", "rating", "review_count", "score", "visibility_score", "conversion_score", "technical_score", "trust_score", "last_contacted_at", "next_follow_up_at", "last_audit_at", "report_views", "report_token", "fit_score", "need_score", "intent_score", "urgency_score", "reachability_score", "qualification_status", "business_objective", "pain_point", "current_provider", "decision_maker", "budget_range", "desired_timeline", "next_committed_step", "objection", "loss_reason", "deal_value", "sequence_status", "sequence_step", "notes", "created_at", "updated_at") SELECT "id", "agency_name", "contact_name", "carrier", "city", "state", "website", "email", "phone", "status", "rating", "review_count", "score", "visibility_score", "conversion_score", "technical_score", "trust_score", "last_contacted_at", "next_follow_up_at", "last_audit_at", "report_views", "report_token", "fit_score", "need_score", "intent_score", "urgency_score", "reachability_score", "qualification_status", "business_objective", "pain_point", "current_provider", "decision_maker", "budget_range", "desired_timeline", "next_committed_step", "objection", "loss_reason", "deal_value", "sequence_status", "sequence_step", "notes", "created_at", "updated_at" FROM `leads`;--> statement-breakpoint
DROP TABLE `leads`;--> statement-breakpoint
ALTER TABLE `__new_leads` RENAME TO `leads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `leads_report_token_unique` ON `leads` (`report_token`);