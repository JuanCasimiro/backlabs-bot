import {
	type Event,
	EventSchema,
	type InboundChannel,
	type InboundResult,
} from "@backlabs/core";
import type { z } from "zod";
import {
	ConversationResolvedPayload,
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
 * Handled: customer messages, public replies by human agents, and resolved
 * conversations. Everything else is acknowledged and ignored, including the
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
				default:
					return { ok: true, event: null };
			}
		},
	};
}

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
