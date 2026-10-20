import type {
	Action,
	ActionResult,
	ChannelPort,
	Message,
} from "@backlabs/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	createDispatcher,
	enqueue,
	planActions,
	startRun,
} from "../src/index.ts";
import {
	DATABASE_URL,
	received,
	type TestDatabase,
	testDatabase,
} from "./support.ts";

class RetryableError extends Error {
	readonly retryable = true;
}

/** Fails the first `failures` performs with the given error, then succeeds. */
class FlakyChannel implements ChannelPort {
	readonly performed: Action[] = [];
	#failures: number;
	readonly #error: Error;

	constructor(failures: number, error: Error) {
		this.#failures = failures;
		this.#error = error;
	}

	async history(): Promise<Message[]> {
		return [];
	}

	async perform(action: Action): Promise<ActionResult> {
		if (this.#failures > 0) {
			this.#failures -= 1;
			throw this.#error;
		}
		this.performed.push(action);
		return { externalId: `ext-${this.performed.length}` };
	}
}

describe.skipIf(!DATABASE_URL)("dispatcher", () => {
	let db: TestDatabase;
	beforeAll(async () => {
		db = await testDatabase();
	});
	afterAll(() => db.close());
	beforeEach(async () => {
		await db.pool.query(
			"truncate outbox, runs, inbox, conversations restart identity cascade",
		);
	});

	async function plan(conversationId: string, texts: string[]) {
		await enqueue(db.pool, received("hola", { conversationId }));
		const runId = await startRun(db.pool, {
			conversationId,
			agent: "a",
			model: "m",
		});
		await planActions(
			db.pool,
			runId,
			texts.map((text, n) => ({
				type: "reply" as const,
				conversationId,
				idempotencyKey: `${runId}:${n}`,
				text,
			})),
		);
	}

	async function statuses() {
		const { rows } = await db.pool.query(
			"select action->>'text' as text, status, attempts from outbox order by seq",
		);
		return rows;
	}

	it("performs planned actions in order and marks them succeeded", async () => {
		const channel = new FlakyChannel(0, new Error());
		const dispatcher = createDispatcher({
			pool: db.pool,
			channel,
			retryDelayMs: 0,
		});
		await plan("c1", ["uno", "dos"]);

		while (await dispatcher.dispatchNext()) {}

		expect(channel.performed.map((a) => a.type === "reply" && a.text)).toEqual([
			"uno",
			"dos",
		]);
		expect(await statuses()).toEqual([
			{ text: "uno", status: "SUCCEEDED", attempts: 1 },
			{ text: "dos", status: "SUCCEEDED", attempts: 1 },
		]);
	});

	it("planning the same idempotency key twice keeps one action", async () => {
		await plan("c1", ["uno"]);
		const { rows } = await db.pool.query(
			"select run_id, idempotency_key from outbox",
		);

		await planActions(db.pool, rows[0].run_id, [
			{
				type: "reply",
				conversationId: "c1",
				idempotencyKey: rows[0].idempotency_key,
				text: "uno",
			},
		]);

		expect(await statuses()).toHaveLength(1);
	});

	it("retries a retryable error later, and gives up after the maximum attempts", async () => {
		const channel = new FlakyChannel(10, new RetryableError("429"));
		const dispatcher = createDispatcher({
			pool: db.pool,
			channel,
			retryDelayMs: 0,
			maxAttempts: 3,
		});
		await plan("c1", ["uno"]);

		while (await dispatcher.dispatchNext()) {}

		expect(await statuses()).toEqual([
			{ text: "uno", status: "FAILED", attempts: 3 },
		]);
	});

	it("marks a non-retryable error as failed without retrying", async () => {
		const channel = new FlakyChannel(1, new Error("400 bad request"));
		const dispatcher = createDispatcher({
			pool: db.pool,
			channel,
			retryDelayMs: 0,
		});
		await plan("c1", ["uno"]);

		while (await dispatcher.dispatchNext()) {}

		expect(await statuses()).toEqual([
			{ text: "uno", status: "FAILED", attempts: 1 },
		]);
	});

	it("never performs an action of a conversation before the earlier ones", async () => {
		const channel = new FlakyChannel(1, new RetryableError("503"));
		const dispatcher = createDispatcher({
			pool: db.pool,
			channel,
			retryDelayMs: 60_000,
		});
		await plan("c1", ["uno", "dos"]);
		await plan("c2", ["otra"]);

		while (await dispatcher.dispatchNext()) {}

		// "uno" waits for its retry; "dos" must wait behind it; c2 is independent.
		expect(channel.performed.map((a) => a.type === "reply" && a.text)).toEqual([
			"otra",
		]);
	});
});
