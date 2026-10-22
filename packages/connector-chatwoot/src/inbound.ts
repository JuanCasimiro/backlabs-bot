import {
	type Event,
	EventSchema,
	type InboundChannel,
	type InboundResult,
} from "@backlabs/core";
import type { z } from "zod";
import {
	ConversationResolvedPayload,
	ConversationStatusChangedPayload,
	MessageCreatedPayload,
	outgoingAuthor,
	toMessage,
} from "./payloads.ts";
import { verifySignature } from "./signature.ts";

export type ChatwootInboundOptions = {
	/** Secret of the Agent Bot in Chatwoot (Settings → Bots). */
	secret: string;
	/** How old a signed request may be, in seconds. Default 300. */
	toleranceSeconds?: number;
	now?: () => Date;
};

/**
 * Verifies and parses the webhooks Chatwoot sends to an Agent Bot.
 *
 * Handled: customer messages, public replies by human agents, resolved
 * conversations, and status changes, which say who answers: `pending` is the
 * bot's, `open` a person's (RT-23, CW-05; it is how Chatwoot's own Captain
 * decides too). Everything else is acknowledged and ignored, including the
 * bot's own messages, which Chatwoot echoes back.
 */
export function chatwootInbound(
	options: ChatwootInboundOptions,
): InboundChannel {
	const toleranceSeconds = options.toleranceSeconds ?? 300;
	const now = options.now ?? (() => new Date());

	return {
		parse(request): InboundResult {
			const authentic = verifySignature({
				secret: options.secret,
				body: request.body,
				timestamp: request.headers["x-chatwoot-timestamp"],
				signature: request.headers["x-chatwoot-signature"],
				nowSeconds: Math.floor(now().getTime() / 1000),
				toleranceSeconds,
			});
			if (!authentic) return { ok: false, reason: "unauthorized" };

			let json: unknown;
			try {
				json = JSON.parse(request.body);
			} catch {
				return { ok: false, reason: "invalid", detail: "body is not JSON" };
			}

			const kind =
				typeof json === "object" && json !== null && "event" in json
					? json.event
					: undefined;

			switch (kind) {
				case "message_created":
					return read(MessageCreatedPayload, json, fromMessageCreated);
				case "conversation_resolved":
					return read(ConversationResolvedPayload, json, (p) => ({
						type: "conversation.resolved",
						eventId: `chatwoot:conversation_resolved:${p.id}:${
							p.updated_at ?? request.headers["x-chatwoot-delivery"] ?? ""
						}`,
						conversationId: String(p.id),
					}));
				case "conversation_status_changed":
					return read(ConversationStatusChangedPayload, json, (p) => {
						const type = OWNER_BY_STATUS[p.status];
						if (!type) return null;
						return {
							type,
							eventId: `chatwoot:conversation_status_changed:${p.id}:${p.status}:${
								p.updated_at ?? request.headers["x-chatwoot-delivery"] ?? ""
							}`,
							conversationId: String(p.id),
						};
					});
				default:
					return { ok: true, event: null };
			}
		},
	};
}

/**
 * A person gives a conversation back from the "Assigned agent" dropdown, which
 * sets it to `pending`; the bot's own handoff, a person opening it, or a failed
 * webhook set it to `open`. `resolved` arrives as `conversation_resolved`.
 */
const OWNER_BY_STATUS: Record<
	string,
	"conversation.handed_back" | "conversation.taken_over" | undefined
> = {
	pending: "conversation.handed_back",
	open: "conversation.taken_over",
};

function read<S extends z.ZodType>(
	schema: S,
	json: unknown,
	toEvent: (payload: z.infer<S>) => Event | null,
): InboundResult {
	const parsed = schema.safeParse(json);
	if (!parsed.success) {
		return { ok: false, reason: "invalid", detail: parsed.error.message };
	}

	const event = toEvent(parsed.data);
	return { ok: true, event: event && EventSchema.parse(event) };
}

/**
 * Inboxes where the sender's number is the address the message came from, so
 * the network has already proven it (ADR 0006). On every other inbox a phone
 * on the contact may have been typed by anyone.
 */
const PHONE_PROVING_CHANNELS = new Set([
	"Channel::Whatsapp",
	"Channel::TwilioSms",
	"Channel::Sms",
]);

function fromMessageCreated(p: MessageCreatedPayload): Event | null {
	if (p.private) return null;

	const base = {
		// The message id, not the delivery id: retries and re-enqueues of the
		// same message must deduplicate.
		eventId: `chatwoot:message:${p.id}`,
		conversationId: String(p.conversation.id),
	};

	if (p.message_type === "incoming" && p.sender) {
		return {
			type: "message.received",
			...base,
			contact: {
				id: String(p.sender.id),
				...(p.sender.name ? { name: p.sender.name } : {}),
				...(p.sender.phone_number ? { phone: p.sender.phone_number } : {}),
				...(p.sender.phone_number &&
				PHONE_PROVING_CHANNELS.has(p.conversation.channel ?? "")
					? { phoneVerified: true }
					: {}),
				...(p.sender.email ? { email: p.sender.email } : {}),
			},
			message: toMessage(p, "customer"),
		};
	}

	if (p.message_type === "outgoing" && outgoingAuthor(p.sender) === "human") {
		return { type: "human.replied", ...base, message: toMessage(p, "human") };
	}

	return null;
}
