import { channelContract } from "@backlabs/testing";
import { describe, expect, it } from "vitest";
import {
	TelegramApiError,
	type TelegramChannelOptions,
	telegramChannel,
} from "../src/index.ts";
import { fakeTelegram, OPERATOR_CHAT_ID } from "./fixtures.ts";

const key = { idempotencyKey: "k", conversationId: "1001" };

function channelWith(
	api = fakeTelegram(),
	extra: Partial<TelegramChannelOptions> = {},
) {
	const channel = telegramChannel({
		token: "123:abc",
		operatorChatId: OPERATOR_CHAT_ID,
		shareButtonText: "Compartir mi número",
		fetch: api.fetch,
		...extra,
	});
	return { channel, calls: api.calls };
}

channelContract("Telegram (fake Bot API)", async () => ({
	channel: channelWith().channel,
	conversationId: "1001",
}));

describe("perform", () => {
	it("declares itself a direct channel, with no inbox behind it", () => {
		expect(channelWith().channel.direct).toBe(true);
	});

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

	it("the default handoff message names both ways to answer and `/resume`", async () => {
		const { channel, calls } = channelWith();

		await channel.perform({ ...key, type: "handoff" });

		const text = String(calls[0]?.body.text);
		expect(text).toMatch(/reply to this message/i);
		expect(text).toContain("/bot");
		expect(text).toContain("/resume 1001");
	});

	it("uses the configured texts when given", async () => {
		const { channel, calls } = channelWith(fakeTelegram(), {
			briefCommand: "bot",
			texts: {
				handoff:
					"Necesita una persona{team}. Respondé o usá /{brief}; /{resume} {id}",
				note: "Nota: {text}",
			},
		});

		await channel.perform({ ...key, type: "handoff", team: "taller" });
		await channel.perform({ ...key, type: "note", text: "<pastillas>" });

		expect(calls[0]?.body.text).toContain(
			"Necesita una persona (taller). Respondé o usá /bot; /resume 1001",
		);
		expect(calls[0]?.body.text).toContain("tg://user?id=1001");
		expect(calls[1]?.body.text).toContain("Nota: &lt;pastillas&gt;");
		expect(calls[1]?.body.text).toContain("1001");
	});

	it("sends a human reply to the customer verbatim", async () => {
		const { channel, calls } = channelWith();

		const result = await channel.perform({
			...key,
			type: "relay",
			text: "Hola, soy <Juli> & te ayudo",
			sourceMessageId: "40",
		});

		expect(calls).toEqual([
			{
				method: "sendMessage",
				body: { chat_id: "1001", text: "Hola, soy <Juli> & te ayudo" },
			},
		]);
		expect(await channel.history("1001")).toEqual([
			expect.objectContaining({
				id: result.externalId,
				author: "human",
				private: false,
			}),
		]);
	});

	it("reports a failed delivery back to the operator chat, as a reply to the operator's message", async () => {
		const { channel, calls } = channelWith(
			fakeTelegram({
				sendMessage: [
					{
						ok: false,
						error_code: 403,
						description: "Forbidden: bot was blocked by the user",
					},
				],
			}),
		);

		const relay = channel.perform({
			...key,
			type: "relay",
			text: "Hola",
			sourceMessageId: "40",
		});

		await expect(relay).rejects.toBeInstanceOf(TelegramApiError);
		expect(calls[1]?.body).toMatchObject({
			chat_id: OPERATOR_CHAT_ID,
			parse_mode: "HTML",
			reply_parameters: { message_id: 40, allow_sending_without_reply: true },
		});
		expect(calls[1]?.body.text).toContain("1001");
		expect(calls[1]?.body.text).toContain("blocked by the user");
	});

	it("does not report a failed delivery that a retry may fix", async () => {
		const { channel, calls } = channelWith(
			fakeTelegram({
				sendMessage: [{ ok: false, error_code: 429, description: "Too Many" }],
			}),
		);

		const relay = channel.perform({
			...key,
			type: "relay",
			text: "Hola",
			sourceMessageId: "40",
		});

		await expect(relay).rejects.toMatchObject({ retryable: true });
		expect(calls).toHaveLength(1);
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
