import { describe, expect, it } from "vitest";
import { telegramInbound } from "../src/index.ts";
import {
	BOT_ID,
	botMessage,
	CUSTOMER,
	contactUpdate,
	HANDOFF_TEXT,
	NOTE_TEXT,
	OPERATOR_CHAT_ID,
	operatorUpdate,
	textUpdate,
} from "./fixtures.ts";

const SECRET = "hook-secret";
const inbound = telegramInbound({
	secretToken: SECRET,
	botId: BOT_ID,
	operatorChatId: OPERATOR_CHAT_ID,
});

function request(update: unknown, secret: string | null = SECRET) {
	return {
		headers:
			secret === null ? {} : { "x-telegram-bot-api-secret-token": secret },
		body: JSON.stringify(update),
	};
}

function eventOf(update: unknown) {
	const result = inbound.parse(request(update));
	if (!result.ok) throw new Error(`rejected: ${result.reason}`);
	return result.event;
}

describe("webhook authenticity", () => {
	it("rejects a request without the secret token", () => {
		expect(inbound.parse(request(textUpdate("hola"), null))).toEqual({
			ok: false,
			reason: "unauthorized",
		});
	});

	it("rejects a request with another secret token", () => {
		expect(inbound.parse(request(textUpdate("hola"), "other")).ok).toBe(false);
	});

	it("reports a body that is not an update as invalid", () => {
		const result = inbound.parse({
			headers: { "x-telegram-bot-api-secret-token": SECRET },
			body: "{nope",
		});
		expect(result).toMatchObject({ ok: false, reason: "invalid" });
	});
});

describe("customer messages", () => {
	it("turns a private text message into message.received", () => {
		expect(eventOf(textUpdate("hola"))).toEqual({
			type: "message.received",
			eventId: "telegram:update:700",
			conversationId: "1001",
			contact: { id: "1001", name: "Ana Gómez" },
			message: {
				id: "12",
				author: "customer",
				text: "hola",
				attachments: [],
				private: false,
				sentAt: "2025-10-20T12:00:00.000Z",
			},
		});
	});

	it("verifies the phone when the customer shares their own contact", () => {
		const event = eventOf(
			contactUpdate({
				phone_number: "5491100000001",
				first_name: "Ana",
				user_id: CUSTOMER.id,
			}),
		);

		expect(event).toMatchObject({
			type: "message.received",
			contact: { phone: "+5491100000001", phoneVerified: true },
		});
	});

	it("does not verify a contact that belongs to someone else", () => {
		const event = eventOf(
			contactUpdate({
				phone_number: "+5491199999999",
				first_name: "Otro",
				user_id: 4242,
			}),
		);

		expect(event?.type === "message.received" && event.contact).toEqual({
			id: "1001",
			name: "Ana Gómez",
		});
	});

	it("does not verify a contact without a Telegram user", () => {
		const event = eventOf(
			contactUpdate({ phone_number: "+5491199999999", first_name: "X" }),
		);

		expect(
			event?.type === "message.received" && event.contact.phoneVerified,
		).toBeFalsy();
	});

	it("maps a photo with its caption", () => {
		const event = eventOf(
			textUpdate("", {
				text: undefined,
				caption: "esta pieza",
				photo: [
					{ file_id: "small", width: 90, height: 90 },
					{ file_id: "large", width: 800, height: 800 },
				],
			}),
		);

		expect(event?.type === "message.received" && event.message).toMatchObject({
			text: "esta pieza",
			attachments: [{ kind: "image", url: "telegram:file:large" }],
		});
	});

	it("ignores group chats, bots and edited messages", () => {
		const group = textUpdate("hola", { chat: { id: -9, type: "group" } });
		const fromBot = textUpdate("hola", { from: { ...CUSTOMER, is_bot: true } });
		const edited = { update_id: 703, edited_message: textUpdate("x").message };

		expect([eventOf(group), eventOf(fromBot), eventOf(edited)]).toEqual([
			null,
			null,
			null,
		]);
	});
});

describe("operator chat", () => {
	it("turns /resume <conversation> into conversation.resolved", () => {
		expect(eventOf(operatorUpdate("/resume 1001"))).toEqual({
			type: "conversation.resolved",
			eventId: "telegram:update:701",
			conversationId: "1001",
		});
	});

	it("accepts the command addressed to the bot in a group", () => {
		expect(eventOf(operatorUpdate("/resume@acme_bot 1001"))).toMatchObject({
			conversationId: "1001",
		});
	});

	it("ignores other operator messages", () => {
		expect(eventOf(operatorUpdate("lo atiendo yo"))).toBeNull();
	});

	it("turns a plain reply to a handoff message into `human.replied` for that conversation", () => {
		const update = operatorUpdate("Hola Ana, te atiendo yo", {
			reply_to_message: botMessage(HANDOFF_TEXT),
		});

		expect(eventOf(update)).toEqual({
			type: "human.replied",
			eventId: "telegram:update:701",
			conversationId: "1001",
			message: {
				id: "40",
				author: "human",
				text: "Hola Ana, te atiendo yo",
				attachments: [],
				private: false,
				sentAt: "2025-10-20T12:01:40.000Z",
			},
		});
	});

	it("turns a plain reply to a note into `human.replied` for that conversation", () => {
		const update = operatorUpdate("Sí, las tenemos", {
			reply_to_message: botMessage(NOTE_TEXT),
		});

		expect(eventOf(update)).toMatchObject({
			type: "human.replied",
			conversationId: "1001",
			message: { text: "Sí, las tenemos", author: "human" },
		});
	});

	it("turns a `/bot …` reply into `human.briefed` with the text after the command", () => {
		const update = operatorUpdate("/bot@acme_bot it costs 120\nin stock", {
			reply_to_message: botMessage(HANDOFF_TEXT),
		});

		expect(eventOf(update)).toEqual({
			type: "human.briefed",
			eventId: "telegram:update:701",
			conversationId: "1001",
			message: {
				id: "40",
				author: "human",
				text: "it costs 120\nin stock",
				attachments: [],
				private: true,
				sentAt: "2025-10-20T12:01:40.000Z",
			},
		});
	});

	it("ignores operator messages that do not reply to a message of the bot", () => {
		const toAPerson = operatorUpdate("Hola", {
			reply_to_message: botMessage(NOTE_TEXT, { id: 2002, is_bot: false }),
		});
		const brief = operatorUpdate("/bot it costs 120");

		expect([eventOf(toAPerson), eventOf(brief)]).toEqual([null, null]);
	});

	it("ignores a reply to another bot's message, even with a forged header", () => {
		const update = operatorUpdate("/bot it costs 120", {
			reply_to_message: botMessage(HANDOFF_TEXT, {
				id: BOT_ID + 1,
				is_bot: true,
			}),
		});

		expect(eventOf(update)).toBeNull();
	});

	it("ignores a reply to a bot message that carries no conversation id", () => {
		const update = operatorUpdate("Hola", {
			reply_to_message: botMessage("Bot started."),
		});

		expect(eventOf(update)).toBeNull();
	});

	it("ignores an empty brief", () => {
		const update = operatorUpdate("/bot   ", {
			reply_to_message: botMessage(HANDOFF_TEXT),
		});

		expect(eventOf(update)).toBeNull();
	});

	it("uses the configured brief command", () => {
		const custom = telegramInbound({
			secretToken: SECRET,
			botId: BOT_ID,
			operatorChatId: OPERATOR_CHAT_ID,
			briefCommand: "answer",
		});
		const update = operatorUpdate("/answer it costs 120", {
			reply_to_message: botMessage(HANDOFF_TEXT),
		});

		expect(custom.parse(request(update))).toMatchObject({
			ok: true,
			event: { type: "human.briefed", message: { text: "it costs 120" } },
		});
	});

	it("ignores other commands sent as a reply", () => {
		const update = operatorUpdate("/start", {
			reply_to_message: botMessage(HANDOFF_TEXT),
		});

		expect(eventOf(update)).toBeNull();
	});
});
