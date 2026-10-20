import { createHmac } from "node:crypto";
import type { InboundRequest } from "@backlabs/core";

export const SECRET = "bot-secret";
export const NOW = new Date("2026-10-19T12:00:00Z");
export const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

/** Signs a payload the way Chatwoot does in lib/webhooks/trigger.rb. */
export function signed(
	payload: unknown,
	options: SignOptions = {},
): InboundRequest {
	return signedRaw(JSON.stringify(payload), options);
}

type SignOptions = { secret?: string; timestamp?: number; delivery?: string };

export function signedRaw(
	body: string,
	options: SignOptions = {},
): InboundRequest {
	const ts = String(options.timestamp ?? NOW_SECONDS);
	const hmac = createHmac("sha256", options.secret ?? SECRET)
		.update(`${ts}.${body}`)
		.digest("hex");

	return {
		headers: {
			"content-type": "application/json",
			"x-chatwoot-timestamp": ts,
			"x-chatwoot-signature": `sha256=${hmac}`,
			"x-chatwoot-delivery": options.delivery ?? "delivery-1",
		},
		body,
	};
}

const contact = {
	id: 77,
	name: "Juan Pérez",
	email: null,
	phone_number: "+5491100000000",
	identifier: null,
	custom_attributes: {},
	additional_attributes: {},
	blocked: false,
	contact_type: "lead",
};

/** Shape of Message#webhook_data merged with `event: "message_created"`. */
export function messageCreated(overrides: Record<string, unknown> = {}) {
	return {
		event: "message_created",
		id: 501,
		content: "Hola, ¿tienen pastillas de freno para un Gol 2015?",
		content_type: "text",
		content_attributes: {},
		additional_attributes: {},
		message_type: "incoming",
		private: false,
		created_at: "2026-10-19T11:59:58.000Z",
		source_id: null,
		account: { id: 1, name: "Acme" },
		inbox: { id: 3, name: "WhatsApp" },
		sender: contact,
		conversation: {
			id: 42,
			inbox_id: 3,
			channel: "Channel::Whatsapp",
			status: "pending",
			labels: [],
			meta: { sender: { ...contact, type: "contact" } },
		},
		...overrides,
	};
}

export function conversationResolved(overrides: Record<string, unknown> = {}) {
	return {
		event: "conversation_resolved",
		id: 42,
		inbox_id: 3,
		status: "resolved",
		labels: [],
		updated_at: 1_760_875_200.123,
		...overrides,
	};
}
