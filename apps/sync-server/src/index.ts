import { Hono } from "hono";
import { cors } from "hono/cors";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import push from "./replicache/push";
import pull from "./replicache/pull";
import { eq } from "drizzle-orm";
import { db } from "./db/middleware";

export type DB = DrizzleD1Database<typeof schema>;

// biome-ignore lint/complexity/noBannedTypes: .
export type Bindings = {};
export type Variables = {
	db: DrizzleD1Database<typeof schema>;
};
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("/api/*", cors());
app.get("/", async (c) => {
	return c.text("Hello Hono!");
});

app.get("/api/replicache/spaceExists/:spaceID", db, async (c) => {
	const db = c.get("db");
	const spaceID = c.req.param("spaceID");
	const spaceRecord = await db.query.replicacheSpace.findFirst({
		where: eq(schema.replicacheSpace.id, spaceID),
	});
	return c.json({ exists: spaceRecord !== null });
});
app.post("/api/replicache/space/:spaceID", db, async (c) => {
	const db = c.get("db");
	const spaceID = c.req.param("spaceID");
	const insertResponse = await db.insert(schema.replicacheSpace).values({
		id: spaceID,
		version: 0,
		lastModified: new Date(),
	});
	if (insertResponse.success) {
		return c.json({ success: true });
	}
	console.error("Failed to insert replicacheSpace", insertResponse);
	return c.json({
		success: false,
		message: "Failed to insert replicacheSpace",
	});
});

app.route("/api/replicache/push", push);
app.route("/api/replicache/pull", pull);

export default app;
