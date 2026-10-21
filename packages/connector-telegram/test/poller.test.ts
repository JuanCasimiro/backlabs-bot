import type { Event } from "@backlabs/core";
import { describe, expect, it } from "vitest";
import { botIdFromToken, pollTelegram } from "../src/index.ts";
import { fakeTelegram, OPERATOR_CHAT_ID, textUpdate } from "./fixtures.ts";

describe("long polling", () => {
	it("hands every update to the inbox and asks only for newer ones", async () => {
		const first = textUpdate("hola");
		const second = { ...textUpdate("¿siguen?"), update_id: 701 };
		const api = fakeTelegram({
			getUpdates: [
				{ ok: true, result: [first, second] },
				{ ok: true, result: [] },
			],
		});
		const events: Event[] = [];
		const controller = new AbortController();

		await pollTelegram({
			token: "123:abc",
			operatorChatId: OPERATOR_CHAT_ID,
			fetch: api.fetch,
			signal: controller.signal,
			onEvent: async (event) => {
				events.push(event);
			},
			onIdle: () => controller.abort(),
		});

		expect(events.map((e) => e.eventId)).toEqual([
			"telegram:update:700",
			"telegram:update:701",
		]);
		expect(api.calls.map((c) => c.body.offset)).toEqual([undefined, 702]);
	});

	it("does not move past an update the inbox could not store", async () => {
		const update = textUpdate("hola");
		const api = fakeTelegram({
			getUpdates: [
				{ ok: true, result: [update] },
				{ ok: true, result: [update] },
				{ ok: true, result: [] },
			],
		});
		const controller = new AbortController();
		const errors: unknown[] = [];
		let attempts = 0;

		await pollTelegram({
			token: "123:abc",
			operatorChatId: OPERATOR_CHAT_ID,
			fetch: api.fetch,
			signal: controller.signal,
			retryDelayMs: 0,
			onEvent: async () => {
				attempts += 1;
				if (attempts === 1) throw new Error("database down");
			},
			onError: (error) => errors.push(error),
			onIdle: () => controller.abort(),
		});

		expect(attempts).toBe(2);
		expect(errors).toHaveLength(1);
		expect(api.calls.map((c) => c.body.offset)).toEqual([
			undefined,
			undefined,
			701,
		]);
	});

	it("stops with the error when Telegram rejects the configuration", async () => {
		const api = fakeTelegram({
			getUpdates: [
				{
					ok: false,
					error_code: 409,
					description: "Conflict: webhook is active",
				},
			],
		});

		await expect(
			pollTelegram({
				token: "123:abc",
				operatorChatId: OPERATOR_CHAT_ID,
				fetch: api.fetch,
				signal: new AbortController().signal,
				onEvent: async () => {},
				onError: () => {},
			}),
		).rejects.toMatchObject({ status: 409 });
	});
});

describe("bot id", () => {
	it("reads the bot id from the token", () => {
		expect(botIdFromToken("123:abc")).toBe(123);
	});

	it("refuses a token without the bot id", () => {
		expect(() => botIdFromToken("abc")).toThrow(/bot id/);
	});
});
