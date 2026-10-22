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
	/**
	 * A person gave the conversation back to the bot (RT-23). What happened
	 * meanwhile (`humanTurn`) goes into the memory, and a pending handoff is
	 * closed as answered by the team.
	 */
	handedBack: boolean;
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
		handedBack: false,
	};

	// A person owns the conversation from here: whatever the bot was about to
	// answer is theirs now. After a brief, the brief is dropped and the thread
	// keeps waiting.
	const takeOver = () => {
		folded.mode = "human";
		folded.messages = [];
		folded.handedBack = false;
		if (folded.brief) {
			folded.brief = null;
			waitingForTeam = true;
		}
	};

	for (const event of events) {
		switch (event.type) {
			case "human.replied":
				takeOver();
				folded.humanTurn.push(event.message);
				break;
			// RT-23: the channel says who answers. Both are no-ops when it
			// already agrees with the runtime.
			case "conversation.taken_over":
				if (folded.mode === "bot") takeOver();
				break;
			// The pending handoff, if any, is closed as answered by the team.
			case "conversation.handed_back":
				if (folded.mode === "human") {
					folded.mode = "bot";
					folded.handedBack = true;
					waitingForTeam = false;
				}
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
				folded.handedBack = false;
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
