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

/**
 * A human agent gave the bot facts to answer with, instead of answering
 * themselves. The bot takes the conversation back keeping its memory; the
 * customer never sees the brief. It never verifies the customer's identity.
 */
export const HumanBriefedSchema = z.object({
	type: z.literal("human.briefed"),
	...base,
	message: MessageSchema,
});

export const ConversationResolvedSchema = z.object({
	type: z.literal("conversation.resolved"),
	...base,
});

/**
 * A person, or the channel itself, took the conversation: the bot stops
 * answering. Carries no message; a human reply says the same with one.
 */
export const ConversationTakenOverSchema = z.object({
	type: z.literal("conversation.taken_over"),
	...base,
});

/**
 * A person gave the conversation back to the bot, which keeps its memory and
 * answers the next customer message. Unlike a resolution, nothing is forgotten.
 */
export const ConversationHandedBackSchema = z.object({
	type: z.literal("conversation.handed_back"),
	...base,
});

export const EventSchema = z.discriminatedUnion("type", [
	MessageReceivedSchema,
	HumanRepliedSchema,
	HumanBriefedSchema,
	ConversationResolvedSchema,
	ConversationTakenOverSchema,
	ConversationHandedBackSchema,
]);
export type Event = z.infer<typeof EventSchema>;
export type EventType = Event["type"];
