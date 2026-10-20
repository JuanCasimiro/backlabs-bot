import type { Contact, Event, Message } from "@backlabs/core";
import type { ConversationMode, ConversationRecord } from "./conversations.ts";
import { mergeContact } from "./identity.ts";

export type FoldedEvents = {
	mode: ConversationMode;
	contact: Contact | null;
	/** Customer messages the bot should answer, oldest first. */
	messages: Message[];
	/** The conversation was resolved: the next run starts a new memory. */
	resetMemory: boolean;
};

/**
 * Applies a batch of pending events to a conversation, in order (ADR 0007).
 * A human reply or a resolution drops the messages before it: they belong
 * to a turn the bot no longer owns.
 */
export function foldEvents(
	conversation: ConversationRecord,
	events: Event[],
): FoldedEvents {
	const folded: FoldedEvents = {
		mode: conversation.mode,
		contact: conversation.contact,
		messages: [],
		resetMemory: false,
	};

	for (const event of events) {
		switch (event.type) {
			case "human.replied":
				folded.mode = "human";
				folded.messages = [];
				break;
			case "conversation.resolved":
				folded.mode = "bot";
				folded.messages = [];
				folded.resetMemory = true;
				break;
			case "message.received":
				folded.contact = mergeContact(folded.contact, event.contact);
				if (folded.mode === "bot") folded.messages.push(event.message);
				break;
		}
	}
	return folded;
}
