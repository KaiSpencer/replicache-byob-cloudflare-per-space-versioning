import { Hono } from "hono";
import type { Bindings, DB, Variables } from "..";
import {
	type MessageWithID,
	oneOrNullFromFindMany,
} from "@replicache-byob-cloudflare-per-space-versioning/shared";
import { eq } from "drizzle-orm";
import type { PushRequestV1, MutationV1 } from "replicache";
import { db, serverID } from "../db/middleware";
import * as schema from "./../db/schema";
import { Pusher } from "./../pusher";
import { Resource } from "sst";
import { BatchItem } from "drizzle-orm/batch";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
export default app;

export async function getCookie(
	db: DB,
	spaceID: string,
): Promise<number | undefined> {
	console.log("Getting cookie for space", spaceID);

	const spaceRecord = await db.query.replicacheSpace.findFirst({
		where: eq(schema.replicacheSpace.id, spaceID),
	});
	console.log("spaceRecord", spaceRecord);

	if (!spaceRecord || spaceRecord.version === null) {
		await db.insert(schema.replicacheSpace).values({
			id: spaceID,
			version: 1,
			lastModified: new Date(),
		});
		return 1;
	}
	return spaceRecord.version;
}

/***
 * Relative to root app
 * Effective path:
 * /api/replicache/push
 */
app.post("/", db, async (c) => {
	const db = c.get("db");
	const spaceID = c.req.query("spaceID");
	const push = await c.req.json<PushRequestV1>();
	const clientGroupID = push.clientGroupID;

	if (!spaceID) {
		throw new Error("Missing spaceID query parameter");
	}
	const prevVersion = await getCookie(db, spaceID);
	if (prevVersion === undefined) {
		console.log("No previous version found, returning early");
		throw new Error("Space not exists");
	}
	const t0 = Date.now();

	console.log("Processing push", JSON.stringify(push));

	const nextVersion = prevVersion + 1;
	const clientIDs = [...new Set(push.mutations.map((m) => m.clientID))];

	const lastMutationIDs = await getLastMutationIDs(db, clientIDs);

	console.log(JSON.stringify({ prevVersion, nextVersion, lastMutationIDs }));

	try {
		// Iterate each mutation in the push.
		for (const mutation of push.mutations) {
			try {
				const { clientID } = mutation;

				console.log("Client ID", clientID);

				const lastMutationID = lastMutationIDs[clientID];
				if (lastMutationID === undefined) {
					throw new Error(
						`invalid state - lastMutationID not found for client: ${clientID}`,
					);
				}
				const expectedMutationID = lastMutationID + 1;

				if (mutation.id < expectedMutationID) {
					console.log(
						`Mutation ${mutation.id} has already been processed - skipping`,
					);
					continue;
				}
				if (mutation.id > expectedMutationID) {
					console.warn(`Mutation ${mutation.id} is from the future - aborting`);
					break;
				}

				console.log("Processing mutation:", JSON.stringify(mutation, null, ""));

				const t1 = Date.now();

				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				switch (mutation.name) {
					case "createMessage":
						await createMessage(
							db,
							mutation.args as MessageWithID,
							nextVersion,
							spaceID,
						);
						break;
					default:
						throw new Error(`Unknown mutation: ${mutation.name}`);
				}

				lastMutationIDs[clientID] = expectedMutationID;
				console.log("Processed mutation in", Date.now() - t1);
			} catch (e) {
				console.error("Caught error from mutation", mutation, e);

				// Handle errors inside mutations by skipping and moving on. This is
				// convenient in development but you may want to reconsider as your app
				// gets close to production:
				// https://doc.replicache.dev/reference/server-push#error-handling
				// await processMutation(db, push.clientGroupID, mutation, lastMutationIDs, e as string);
			}
		}

		async function setLastMutationID(
			db: DB,
			clientID: string,
			clientGroupID: string,
			lastMutationID: number,
			version: number,
		): Promise<void> {
			await db.insert(schema.replicacheClient).values({
				id: clientID,
				clientGroupId: clientGroupID,
				lastMutationId: lastMutationID,
				version: version,
				lastModified: new Date(),
			});
		}

		async function setLastMutationIDs(
			db: DB,
			clientGroupID: string,
			lmids: Record<string, number>,
			version: number,
		) {
			return await Promise.all(
				[...Object.entries(lmids)].map(([clientID, lmid]) =>
					setLastMutationID(db, clientID, clientGroupID, lmid, version),
				),
			);
		}

		async function setCookie(
			db: DB,
			spaceID: string,
			version: number,
		): Promise<void> {
			await db
				.update(schema.replicacheSpace)
				.set({ version: version, lastModified: new Date() })
				.where(eq(schema.replicacheSpace.id, spaceID));
		}

		// await db.batch([
		// Object.entries(lastMutationIDs).map(([clientID, lmid]) =>
		// 	db.insert(schema.replicacheClient).values({
		// 		id: clientID,
		// 		clientGroupId: clientGroupID,
		// 		lastMutationId: lmid,
		// 		version: nextVersion,
		// 		lastModified: new Date(),
		// 	}),
		// ),
		// ])

		await Promise.all([
			setLastMutationIDs(db, clientGroupID, lastMutationIDs, nextVersion),
			setCookie(db, spaceID, nextVersion),
		]);

		console.log("Processed all mutations in", Date.now() - t0);

		await sendPoke(spaceID);
		return c.json({});
	} catch (e) {
		console.error(e);
		c.status(500);
		return c.text(e as string);
	} finally {
		console.log("Processed push in", Date.now() - t0);
	}
});

export async function getLastMutationID(db: DB, clientID: string) {
	const clientRow = await db.query.replicacheClient
		.findMany({
			where: eq(schema.replicacheClient.id, clientID),
		})
		.then(oneOrNullFromFindMany);
	if (!clientRow) {
		return 0;
	}
	return clientRow.lastMutationId;
}

export async function getLastMutationIDs(db: DB, clientIDs: string[]) {
	return Object.fromEntries(
		await Promise.all(
			clientIDs.map(async (cid) => {
				const lmid = await getLastMutationID(db, cid);
				return [cid, lmid ?? 0] as const;
			}),
		),
	);
}

async function createMessage(
	db: DB,
	{ content, from, id, order }: MessageWithID,
	version: number,
	spaceID: string,
) {
	await db.insert(schema.message).values({
		content,
		deleted: false,
		ord: order,
		sender: from,
		lastModifiedVersion: version,
		id: id,
		spaceID,
	});
}

async function sendPoke(spaceID: string) {
	const pusher = new Pusher(
		Resource.PusherAppId.value,
		Resource.PusherKey.value,
		Resource.PusherSecret.value,
		Resource.PusherCluster.value,
	);
	const t0 = Date.now();
	await pusher.trigger("default", `poke:${spaceID}`, {});
	console.log("Sent poke in", Date.now() - t0);
}
