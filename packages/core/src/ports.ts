import type { Action } from "./actions.ts";
import type { Message } from "./conversation.ts";
import type { Event } from "./events.ts";

export type ActionResult = {
	/** Id the channel gave to what was created, e.g. the message id of a reply. */
	externalId?: string;
};

/** Outbound side of a channel: what the bot reads from and does to a conversation. */
export interface ChannelPort {
	/**
	 * True when no human inbox sits behind the channel (ADR 0007): operators
	 * see the conversation and answer it only through the bot. The runtime then
	 * relays human replies and forwards customer messages to the operators.
	 */
	readonly direct?: boolean;
	/** Recent messages of a conversation, oldest first. */
	history(conversationId: string): Promise<Message[]>;
	perform(action: Action): Promise<ActionResult>;
}

export type InboundRequest = {
	/** Header names in lower case, as Node's HTTP server gives them. */
	headers: Readonly<Record<string, string | undefined>>;
	/** The raw body. Signatures are computed over these exact bytes. */
	body: string;
};

export type InboundResult =
	/** `event` is null when the request is genuine but nothing for the bot. */
	| { ok: true; event: Event | null }
	| { ok: false; reason: "unauthorized" | "invalid"; detail?: string };

/** Inbound side of a channel: turns a webhook request into a domain event. */
export interface InboundChannel {
	parse(request: InboundRequest): InboundResult;
}
