ALTER TABLE `proposals` ADD `opening_source` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `opening_blocked` text DEFAULT '' NOT NULL;