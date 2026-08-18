ALTER TABLE `audits` ADD `confidence_score` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `audits` ADD `checks_passed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `audits` ADD `checks_failed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `audits` ADD `checks_unverified` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `audits` ADD `check_summary` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `audits` ADD `lighthouse_summary` text DEFAULT 'null' NOT NULL;--> statement-breakpoint
UPDATE `leads` SET `score` = 0, `visibility_score` = 0, `conversion_score` = 0, `technical_score` = 0, `trust_score` = 0, `last_audit_at` = NULL WHERE `id` IN (SELECT `lead_id` FROM `audits` WHERE `confidence_score` = 0);
