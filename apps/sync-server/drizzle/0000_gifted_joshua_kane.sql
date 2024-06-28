CREATE TABLE `message` (
	`id` text PRIMARY KEY NOT NULL,
	`sender` text NOT NULL,
	`content` text NOT NULL,
	`ord` integer NOT NULL,
	`deleted` integer NOT NULL,
	`last_modified_version` integer NOT NULL,
	`space_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `replicache_client` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_group_id` text NOT NULL,
	`last_mutation_id` integer NOT NULL,
	`version` integer NOT NULL,
	`last_modified` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `replicache_client_group` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`space_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `replicache_space` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer,
	`last_modified` integer
);
