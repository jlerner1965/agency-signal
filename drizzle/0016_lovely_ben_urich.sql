ALTER TABLE `proposals` ADD `price_display` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `retainer` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `minimum_applied` integer DEFAULT false NOT NULL;