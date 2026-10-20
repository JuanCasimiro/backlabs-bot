import { channelContract } from "@backlabs/testing";
import { describe, expect, it } from "vitest";
import { TelegramApiError, telegramChannel } from "../src/index.ts";
import { fakeTelegram, OPERATOR_CHAT_ID } from "./fixtures.ts";

const key = { idempotencyKey: "k", conversationId: "1001" };

function channelWith(api = fakeTelegram()) {
	const channel = telegramChannel({
		token: "123:abc",
		operatorChatId: OPERATOR_CHAT_ID,
		shareButtonText: "Compartir mi número",
		fetch: api.fetch,
	});
	return { channel, calls: api.calls };
}

channelContract("Telegram (fake Bot API)", async () => ({
	channel: channelWith().channel,
	conversationId: "1001",
}));

describe("perform", () => {
	it("replies in the customer's chat and removes any pending keyboard", async () => {
		const { channel, calls } = channelWith();

		const result = await channel.perform({
			...key,
			type: "reply",
			text: "¡Hola!",
		});

		expect(result).toEqual({ externalId: "101" });
		expect(calls).toEqual([
			{
				method: "sendMessage",
				body: {
					chat_id: "1001",
					text: "¡Hola!",
					reply_markup: { remove_keyboard: true },
				},
			},
		]);
	});

	it("asks for the phone with a share-contact button", async () => {
		const { channel, calls } = channelWith();

		await channel.perform({
			...key,
			type: "request_phone",
			text: "Compartí tu número",
		});

		expect(calls[0]?.body).toEqual({
			chat_id: "1001",
			text: "Compartí tu número",
			reply_markup: {
				keyboard: [[{ text: "Compartir mi número", request_contact: true }]],
				one_time_keyboard: true,
				resize_keyboard: true,
			},
		});
	});

	it("posts notes to the operator chat, never to the customer", async () => {
		const { channel, calls } = channelWith();

		await channel.perform({
			...key,
			type: "note",
			text: "Wants <brakes> & oil",
		});

		expect(calls).toHaveLength(1);
		expect(calls[0]?.body).toMatchObject({
			chat_id: OPERATOR_CHAT_ID,
			parse_mode: "HTML",
		});
		expect(calls[0]?.body.text).toContain("Wants &lt;brakes&gt; &amp; oil");
		expect(calls[0]?.body.text).toContain("1001");
	});

	it("tells the operator chat about a handoff and how to give it back", async () => {
		const { channel, calls } = channelWith();

		await channel.perform({ ...key, type: "handoff", team: "workshop" });

		expect(calls[0]?.body.chat_id).toBe(OPERATOR_CHAT_ID);
		expect(calls[0]?.body.text).toContain("workshop");
		expect(calls[0]?.body.text).toContain("/resume 1001");
		expect(calls[0]?.body.text).toContain("tg://user?id=1001");
	});

	it("has no visible effect for labels, attributes and resolve", async () => {
		const { channel, calls } = channelWith();

		await channel.perform({ ...key, type: "add_labels", labels: ["x"] });
		await channel.perform({
			...key,
			type: "set_attributes",
			attributes: { a: 1 },
		});
		await channel.perform({ ...key, type: "resolve" });

		expect(calls).toEqual([]);
	});

	it("throws a TelegramApiError that says whether a retry can help", async () => {
		const { channel } = channelWith(
			fakeTelegram({
				sendMessage: [
					{
						ok: false,
						error_code: 429,
						description: "Too Many Requests",
						parameters: { retry_after: 3 },
					},
					{
						ok: false,
						error_code: 403,
						description: "Forbidden: bot was blocked by the user",
					},
				],
			}),
		);
		const send = () => channel.perform({ ...key, type: "reply", text: "x" });

		await expect(send()).rejects.toMatchObject({
			retryable: true,
			status: 429,
		});
		await expect(send()).rejects.toBeInstanceOf(TelegramApiError);
		await expect(send()).resolves.toBeDefined();
	});
});
