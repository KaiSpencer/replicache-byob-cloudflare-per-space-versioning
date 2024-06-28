import { Hono } from "hono";
import type { Bindings, DB, Variables } from "..";
import { db, serverID } from "../db/middleware";
import { and, eq, gt } from "drizzle-orm/sql";
import * as schema from "../db/schema";
import type { PatchOperation, PullRequestV1, PullResponse } from "replicache";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
export default app;

/***
 * Relative to root app
 * Effective path:
 * /api/replicache/pull
 */
app.post("/", db, async (c) => {
	const db = c.get("db");
	const spaceID = c.req.query("spaceID");
	if (!spaceID) {
		throw new Error("Missing spaceID");
	}
	const pull = (await c.req.json()) as PullRequestV1;
	console.log("Processing pull", JSON.stringify(pull));
	const { clientGroupID } = pull;
	const fromVersion = (pull.cookie as number | null) ?? 0;
	const t0 = Date.now();

	try {
		// Read all data in a single transaction so it's consistent.
		const batchResponse = await db.batch([
			db.query.replicacheSpace.findMany({
				where: eq(schema.replicacheSpace.id, spaceID),
			}),
			db.query.replicacheClient.findMany({
				where: and(
					eq(schema.replicacheClient.clientGroupId, clientGroupID),
					gt(schema.replicacheClient.version, fromVersion),
				),
			}),
			db.query.message.findMany({
				where: and(
					gt(schema.message.lastModifiedVersion, fromVersion),
					eq(schema.message.spaceID, spaceID),
				),
			}),
		]);
		const [spaceRecord, clientRecords, changed] = batchResponse;
		const lastMutationIDChanges = Object.fromEntries(
			clientRecords.map((r) => [r.id, r.lastMutationId]),
		);

		if (spaceRecord.length !== 1) {
			console.log("space does not exist");
			return c.text("space does not exist");
		}
		const currentVersion = spaceRecord?.[0]?.version ?? 0;
		if (currentVersion === null) {
			throw new Error("Server version not found");
		}

		if (currentVersion && fromVersion > currentVersion) {
			throw new Error(
				`fromVersion ${fromVersion} is from the future - aborting. This can happen in development if the server restarts. In that case, clear appliation data in browser and refresh.`,
			);
		}

		// Build and return response.
		const patch: PatchOperation[] = [];
		for (const row of changed) {
			const {
				id,
				sender,
				content,
				ord,
				lastModifiedVersion: rowVersion,
				deleted,
			} = row;
			if (deleted) {
				if (rowVersion > fromVersion) {
					patch.push({
						op: "del",
						key: `message/${id}`,
					});
				}
			} else {
				patch.push({
					op: "put",
					key: `message/${id}`,
					value: {
						from: sender,
						content,
						order: ord,
					},
				});
			}
		}

		const body: PullResponse = {
			lastMutationIDChanges: lastMutationIDChanges ?? {},
			cookie: currentVersion,
			patch,
		};
		return c.json(body);
	} catch (e) {
		console.error(e);
		c.status(500);
		return c.text(e as string);
	} finally {
		console.log("Processed pull in", Date.now() - t0);
	}
});

async function getLastMutationIDChanges(
	db: DB,
	clientGroupID: string,
	fromVersion: number,
) {
	const rows = await db.query.replicacheClient.findMany({
		where: and(
			eq(schema.replicacheClient.clientGroupId, clientGroupID),
			gt(schema.replicacheClient.version, fromVersion),
		),
	});
	return Object.fromEntries(rows?.map((r) => [r.id, r.lastMutationId]));
}
