CREATE TABLE `ai_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`action` text NOT NULL,
	`model` text NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`result` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
