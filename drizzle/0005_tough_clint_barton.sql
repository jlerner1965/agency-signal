ALTER TABLE `leads` ADD `google_profile_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `google_primary_category` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `google_review_recency_days` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `google_response_rate` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `google_photo_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `google_post_recency_days` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `google_profile_completeness` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `google_nap_consistent` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `google_reviewed_at` text;