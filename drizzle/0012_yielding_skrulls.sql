ALTER TABLE `leads` ADD `score_source` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `score_confidence` integer DEFAULT 0 NOT NULL;