import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const replicacheSpace = sqliteTable("replicache_space", {
	id: text("id").primaryKey(),
	version: integer("version"),
	lastModified: integer("last_modified", { mode: "timestamp" }),
});

export const replicacheClientGroup = sqliteTable("replicache_client_group", {
	id: text("id").primaryKey().notNull(),
	userID: text("user_id").notNull(),
	spaceID: text("space_id").notNull(),
});

export const replicacheClient = sqliteTable("replicache_client", {
	id: text("id", { length: 36 }).primaryKey().notNull(),
	clientGroupId: text("client_group_id").notNull(),
	lastMutationId: integer("last_mutation_id").notNull(),
	version: integer("version").notNull(),
	lastModified: integer("last_modified", { mode: "timestamp" }).notNull(),
});

export const message = sqliteTable("message", {
	id: text("id").primaryKey().notNull(),
	sender: text("sender").notNull(),
	content: text("content").notNull(),
	ord: integer("ord").notNull(),
	deleted: integer("deleted", { mode: "boolean" }).notNull(),
	lastModifiedVersion: integer("last_modified_version").notNull(),
	spaceID: text("space_id").notNull(),
});
