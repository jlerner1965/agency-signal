CREATE TABLE `proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`token` text NOT NULL,
	`offer_id` text NOT NULL,
	`title` text NOT NULL,
	`service` text NOT NULL,
	`outcome` text NOT NULL,
	`scope` text NOT NULL,
	`deliverables` text DEFAULT '[]' NOT NULL,
	`price` integer NOT NULL,
	`timeline` text NOT NULL,
	`status` text DEFAULT 'Sent' NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`signer_name` text DEFAULT '' NOT NULL,
	`signer_email` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proposals_token_unique` ON `proposals` (`token`);--> statement-breakpoint
ALTER TABLE `leads` ADD `fit_score` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `need_score` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `intent_score` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `urgency_score` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `reachability_score` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `qualification_status` text DEFAULT 'Unqualified' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `business_objective` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `pain_point` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `current_provider` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `decision_maker` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `budget_range` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `desired_timeline` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `next_committed_step` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `objection` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `loss_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `deal_value` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `sequence_status` text DEFAULT 'Not started' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `sequence_step` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `leads` SET `status` = 'Identified' WHERE `status` = 'New';--> statement-breakpoint
UPDATE `leads` SET `status` = 'Audited' WHERE `status` = 'Audit ready';--> statement-breakpoint
UPDATE `leads` SET `status` = 'Contacted' WHERE `status` IN ('Report viewed', 'Follow-up due');--> statement-breakpoint
UPDATE `leads` SET `status` = 'Discovery scheduled' WHERE `status` = 'Meeting booked';
