import type { Contact, Event, Message } from "@backlabs/core";
import type { ConversationMode, ConversationRecord } from "./conversations.ts";
import { mergeContact } from "./identity.ts";

export type FoldedEvents = {
	mode: ConversationMode;
	contact: Contact | null;
	/** Customer messages the bot should answer, oldest first. */
	messages: Message[];
	/**
	 * What happened while a human owned the conversation, oldest first:
	 * customer messages and human replies. Direct channels show these to the
	 * operators (ADR 0007); the paused thread records them (RT-17).
	 */
	humanTurn: Message[];
	/**
	 * The team's answer to the pending handoff (RT-15). When set, every
	 * message in `humanTurn` came before it and every one in `messages` after.
	 */
	brief: Message | null;
	/** Briefs with no pending handoff to answer: the operators are told (RT-16). */
	unusedBriefs: Message[];
	/** The conversation was resolved: the next run starts a new memory. */
	resetMemory: boolean;
};

/**
 * Applies a batch of pending events to a conversation, in order (ADR 0007).
 * A human reply or a resolution drops the messages before it: they belong
 * to a turn the bot no longer owns. A brief hands the turn back to the bot
 * only if the thread is waiting for the team; one brief answers one handoff.
 */
export function foldEvents(
	conversation: ConversationRecord,
	events: Event[],
	thread: { waitingForTeam: boolean },
): FoldedEvents {
	let waitingForTeam = thread.waitingForTeam;
	const folded: FoldedEvents = {
		mode: conversation.mode,
		contact: conversation.contact,
		messages: [],
		humanTurn: [],
		brief: null,
		unusedBriefs: [],
		resetMemory: false,
	};

	for (const event of events) {
		switch (event.type) {
			// A human reply after a brief means the operator took over after all:
			// the brief is dropped and the thread keeps waiting.
			case "human.replied":
				folded.mode = "human";
				folded.messages = [];
				if (folded.brief) {
					folded.brief = null;
					waitingForTeam = true;
				}
				folded.humanTurn.push(event.message);
				break;
			// The contact is untouched: a brief never verifies anyone (ADR 0006).
			case "human.briefed":
				if (waitingForTeam) {
					folded.mode = "bot";
					folded.brief = event.message;
					waitingForTeam = false;
				} else {
					folded.unusedBriefs.push(event.message);
				}
				break;
			// The pending handoff goes with the old memory (ADR 0007).
			case "conversation.resolved":
				folded.mode = "bot";
				folded.messages = [];
				folded.brief = null;
				waitingForTeam = false;
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
