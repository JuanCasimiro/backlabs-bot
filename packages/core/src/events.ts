import { z } from "zod";
import { ContactSchema, MessageSchema } from "./conversation.ts";

const base = {
	/**
	 * Stable id assigned by the source. The same event delivered twice carries
	 * the same id, which is what the inbox deduplicates on.
	 */
	eventId: z.string().min(1),
	conversationId: z.string().min(1),
};

export const MessageReceivedSchema = z.object({
	type: z.literal("message.received"),
	...base,
	contact: ContactSchema,
	message: MessageSchema,
});

/** A human agent wrote to the customer: the bot should step back. */
export const HumanRepliedSchema = z.object({
	type: z.literal("human.replied"),
	...base,
	message: MessageSchema,
});

export const ConversationResolvedSchema = z.object({
	type: z.literal("conversation.resolved"),
	...base,
});

export const EventSchema = z.discriminatedUnion("type", [
	MessageReceivedSchema,
	HumanRepliedSchema,
	ConversationResolvedSchema,
]);
export type Event = z.infer<typeof EventSchema>;
export type EventType = Event["type"];
