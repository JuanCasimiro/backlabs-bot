import { describe, expect, it } from "vitest";
import { telegramInbound } from "../src/index.ts";
import {
	CUSTOMER,
	contactUpdate,
	OPERATOR_CHAT_ID,
	operatorUpdate,
	textUpdate,
} from "./fixtures.ts";

const SECRET = "hook-secret";
const inbound = telegramInbound({
	secretToken: SECRET,
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
});
