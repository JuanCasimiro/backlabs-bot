import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueue } from "../src/index.ts";
import {
	DATABASE_URL,
	received,
	type TestDatabase,
	testDatabase,
} from "./support.ts";

describe.skipIf(!DATABASE_URL)("inbox", () => {
	let db: TestDatabase;
	beforeAll(async () => {
		db = await testDatabase();
	});
	afterAll(() => db.close());

	it("stores an event once even when it is delivered twice", async () => {
		const event = received("hola", { conversationId: "dup" });

		const first = await enqueue(db.pool, event);
		const second = await enqueue(db.pool, event);

		expect(first).toEqual({ stored: true });
		expect(second).toEqual({ stored: false });
		const { rows } = await db.pool.query(
			"select count(*)::int as n from inbox where conversation_id = 'dup'",
		);
		expect(rows[0].n).toBe(1);
	});

	it("does not run an agent: the event waits unprocessed", async () => {
		await enqueue(db.pool, received("hola", { conversationId: "waits" }));

		const { rows } = await db.pool.query(
			"select processed_at from inbox where conversation_id = 'waits'",
		);
		expect(rows).toEqual([{ processed_at: null }]);
	});
});
