import { describe, expect, it } from "vitest";
import { chatwootInbound } from "../src/index.ts";
import {
	conversationResolved,
	messageCreated,
	NOW,
	NOW_SECONDS,
	SECRET,
	signed,
	signedRaw,
} from "./fixtures.ts";

const inbound = chatwootInbound({ secret: SECRET, now: () => NOW });

describe("signature", () => {
	it("accepts a request signed with the bot secret", () => {
		expect(inbound.parse(signed(messageCreated())).ok).toBe(true);
	});

	it("rejects a request signed with another secret", () => {
		const result = inbound.parse(signed(messageCreated(), { secret: "other" }));
		expect(result).toEqual({ ok: false, reason: "unauthorized" });
	});

	it("rejects a body changed after signing", () => {
		const request = signed(messageCreated());
		const result = inbound.parse({
			...request,
			body: request.body.replace("Gol", "Golf"),
		});
		expect(result).toEqual({ ok: false, reason: "unauthorized" });
	});

	it("rejects a request older than the tolerance", () => {
		const result = inbound.parse(
			signed(messageCreated(), { timestamp: NOW_SECONDS - 301 }),
		);
		expect(result).toEqual({ ok: false, reason: "unauthorized" });
	});

	it("rejects a request without signature headers", () => {
		const result = inbound.parse({
			headers: {},
			body: JSON.stringify(messageCreated()),
		});
		expect(result).toEqual({ ok: false, reason: "unauthorized" });
	});
});

describe("message_created", () => {
	it("turns an incoming message into message.received", () => {
		const result = inbound.parse(signed(messageCreated()));

		expect(result).toEqual({
			ok: true,
			event: {
				type: "message.received",
				eventId: "chatwoot:message:501",
				conversationId: "42",
				contact: {
					id: "77",
					name: "Juan Pérez",
					phone: "+5491100000000",
					phoneVerified: true,
				},
				message: {
					id: "501",
					author: "customer",
					text: "Hola, ¿tienen pastillas de freno para un Gol 2015?",
					attachments: [],
					private: false,
					sentAt: "2026-10-19T11:59:58.000Z",
				},
			},
		});
	});

	it("does not verify the phone on channels that do not prove it", () => {
		const base = messageCreated();
		const result = inbound.parse(
			signed({
				...base,
				conversation: { ...base.conversation, channel: "Channel::WebWidget" },
			}),
		);

		expect(result.ok && result.event?.type === "message.received").toBe(true);
		if (result.ok && result.event?.type === "message.received") {
			expect(result.event.contact.phone).toBe("+5491100000000");
			expect(result.event.contact.phoneVerified).toBeUndefined();
		}
	});

	it("keeps the same event id when Chatwoot retries the delivery", () => {
		const first = inbound.parse(signed(messageCreated(), { delivery: "a" }));
		const retry = inbound.parse(signed(messageCreated(), { delivery: "b" }));

		expect(first.ok && first.event?.eventId).toBe(
			retry.ok && retry.event?.eventId,
		);
	});

	it("maps attachments and allows a message without text", () => {
		const result = inbound.parse(
			signed(
				messageCreated({
					content: null,
					attachments: [
						{ id: 9, file_type: "image", data_url: "https://cw/photo.jpg" },
						{ id: 10, file_type: "audio", data_url: "https://cw/voice.ogg" },
						{ id: 11, file_type: "story_mention", data_url: "https://cw/s" },
					],
				}),
			),
		);

		expect(result.ok && result.event?.type === "message.received").toBe(true);
		if (!result.ok || result.event?.type !== "message.received") return;
		expect(result.event.message.text).toBe("");
		expect(result.event.message.attachments).toEqual([
			{ kind: "image", url: "https://cw/photo.jpg" },
			{ kind: "audio", url: "https://cw/voice.ogg" },
			{ kind: "other", url: "https://cw/s" },
		]);
	});

	it("turns a public reply by a human agent into human.replied", () => {
		const result = inbound.parse(
			signed(
				messageCreated({
					message_type: "outgoing",
					content: "Te atiendo yo, Juan.",
					sender: { id: 5, name: "Ana", email: "ana@acme.test", type: "user" },
				}),
			),
		);

		expect(result.ok && result.event).toMatchObject({
			type: "human.replied",
			conversationId: "42",
			message: { author: "human", text: "Te atiendo yo, Juan." },
		});
	});

	it("ignores the bot's own messages", () => {
		const result = inbound.parse(
			signed(
				messageCreated({
					message_type: "outgoing",
					sender: { id: 1, name: "Acme Bot", type: "agent_bot" },
				}),
			),
		);
		expect(result).toEqual({ ok: true, event: null });
	});

	it("ignores private notes", () => {
		const result = inbound.parse(
			signed(
				messageCreated({
					message_type: "outgoing",
					private: true,
					sender: { id: 5, name: "Ana", type: "user" },
				}),
			),
		);
		expect(result).toEqual({ ok: true, event: null });
	});

	it("ignores activity messages", () => {
		const result = inbound.parse(
			signed(messageCreated({ message_type: "activity", sender: null })),
		);
		expect(result).toEqual({ ok: true, event: null });
	});

	it("reports a payload it cannot read as invalid", () => {
		const result = inbound.parse(
			signed(messageCreated({ conversation: undefined })),
		);
		expect(result.ok).toBe(false);
		expect(!result.ok && result.reason).toBe("invalid");
	});
});

describe("conversation_resolved", () => {
	it("turns it into conversation.resolved", () => {
		const result = inbound.parse(signed(conversationResolved()));

		expect(result).toEqual({
			ok: true,
			event: {
				type: "conversation.resolved",
				eventId: "chatwoot:conversation_resolved:42:1760875200.123",
				conversationId: "42",
			},
		});
	});
});

describe("conversation_status_changed", () => {
	const statusChanged = (status: string) =>
		signed({
			event: "conversation_status_changed",
			id: 42,
			status,
			updated_at: 1760875300.5,
		});

	it("turns a status change to pending into conversation.handed_back", () => {
		expect(inbound.parse(statusChanged("pending"))).toEqual({
			ok: true,
			event: {
				type: "conversation.handed_back",
				eventId: "chatwoot:conversation_status_changed:42:pending:1760875300.5",
				conversationId: "42",
			},
		});
	});

	it("turns a status change to open into conversation.taken_over", () => {
		expect(inbound.parse(statusChanged("open"))).toEqual({
			ok: true,
			event: {
				type: "conversation.taken_over",
				eventId: "chatwoot:conversation_status_changed:42:open:1760875300.5",
				conversationId: "42",
			},
		});
	});

	it("ignores other status changes", () => {
		expect(inbound.parse(statusChanged("resolved"))).toEqual({
			ok: true,
			event: null,
		});
		expect(inbound.parse(statusChanged("snoozed"))).toEqual({
			ok: true,
			event: null,
		});
	});
});

describe("other requests", () => {
	it("ignores events the bot does not handle", () => {
		const result = inbound.parse(
			signed({ event: "conversation_opened", id: 42 }),
		);
		expect(result).toEqual({ ok: true, event: null });
	});

	it("reports a signed body that is not JSON as invalid", () => {
		const result = inbound.parse(signedRaw("not json"));
		expect(result.ok).toBe(false);
		expect(!result.ok && result.reason).toBe("invalid");
	});
});
