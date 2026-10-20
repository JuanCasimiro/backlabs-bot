import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { InboundChannel } from "@backlabs/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Queryable } from "../src/db.ts";
import { webhookHandler } from "../src/index.ts";
import {
	DATABASE_URL,
	received,
	type TestDatabase,
	testDatabase,
} from "./support.ts";

/** Accepts requests with `x-token: ok` and turns the body text into a message. */
const inbound: InboundChannel = {
	parse(request) {
		if (request.headers["x-token"] !== "ok")
			return { ok: false, reason: "unauthorized" };
		if (request.body === "") return { ok: false, reason: "invalid" };
		return {
			ok: true,
			event: received(request.body, { eventId: `e-${request.body}` }),
		};
	},
};

let server: Server | undefined;

async function serve(db: Queryable): Promise<string> {
	server = createServer(webhookHandler({ inbound, db }));
	server.listen(0);
	await once(server, "listening");
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const post = (url: string, body: string, token = "ok") =>
	fetch(url, { method: "POST", headers: { "x-token": token }, body });

afterEach(() => {
	server?.close();
});

describe("webhook handler", () => {
	it("answers 401 to a request the channel rejects", async () => {
		const url = await serve({
			query: async () => ({ rows: [], rowCount: 0 }),
		} as never);
		expect((await post(url, "hola", "bad")).status).toBe(401);
	});

	it("answers 400 to a request the channel cannot read", async () => {
		const url = await serve({
			query: async () => ({ rows: [], rowCount: 0 }),
		} as never);
		expect((await post(url, "")).status).toBe(400);
	});

	it("answers 500 when the event cannot be stored, so the channel retries", async () => {
		const failing = {
			query: async () => {
				throw new Error("database down");
			},
		} as unknown as Queryable;
		const url = await serve(failing);

		expect((await post(url, "hola")).status).toBe(500);
	});
});

describe.skipIf(!DATABASE_URL)("webhook handler with Postgres", () => {
	let db: TestDatabase;
	beforeAll(async () => {
		db = await testDatabase();
	});
	afterAll(() => db.close());

	it("stores the event and answers 200", async () => {
		const url = await serve(db.pool);

		const response = await post(url, "hola");

		expect(response.status).toBe(200);
		const { rows } = await db.pool.query("select event_id from inbox");
		expect(rows).toEqual([{ event_id: "e-hola" }]);
	});
});
