import type { Contact, Event, Message } from "@backlabs/core";
import type { ConversationMode, ConversationRecord } from "./conversations.ts";
import { mergeContact } from "./identity.ts";

export type FoldedEvents = {
	mode: ConversationMode;
	contact: Contact | null;
	/** Messages the bot should answer (customer turns and briefs), oldest first. */
	messages: Message[];
	/**
	 * What happened while a human owned the conversation, oldest first:
	 * customer messages and human replies. Direct channels show these to the
	 * operators (ADR 0007); channels with an inbox already do.
	 */
	humanTurn: Message[];
	/** The conversation was resolved: the next run starts a new memory. */
	resetMemory: boolean;
};

/**
 * Applies a batch of pending events to a conversation, in order (ADR 0007).
 * A human reply or a resolution drops the messages before it: they belong
 * to a turn the bot no longer owns. A brief hands the turn back to the bot.
 */
export function foldEvents(
	conversation: ConversationRecord,
	events: Event[],
): FoldedEvents {
	const folded: FoldedEvents = {
		mode: conversation.mode,
		contact: conversation.contact,
		messages: [],
		humanTurn: [],
		resetMemory: false,
	};

	for (const event of events) {
		switch (event.type) {
			case "human.replied":
				folded.mode = "human";
				folded.messages = [];
				folded.humanTurn.push(event.message);
				break;
			// The bot takes over again with its memory; the brief is its next turn.
			// The contact is untouched: a brief never verifies anyone (ADR 0006).
			case "human.briefed":
				folded.mode = "bot";
				folded.messages.push(event.message);
				break;
			case "conversation.resolved":
				folded.mode = "bot";
				folded.messages = [];
				folded.resetMemory = true;
				break;
			case "message.received":
				folded.contact = mergeContact(folded.contact, event.contact);
				if (folded.mode === "bot") folded.messages.push(event.message);
				else folded.humanTurn.push(event.message);
				break;
		}
	}
	return folded;
}
