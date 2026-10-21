import type {
	Action,
	ActionResult,
	ChannelPort,
	Message,
} from "@backlabs/core";

export type ConversationState = {
	messages: Message[];
	status: "pending" | "open" | "resolved";
	team?: string;
	labels: string[];
	attributes: Record<string, string | number | boolean | null>;
};

/**
 * A channel that lives in memory, for tests and evals. It behaves like a real
 * inbox — replies show up in history, handoffs open the conversation — and
 * records every action performed, in order.
 */
export class InMemoryChannel implements ChannelPort {
	readonly performed: Action[] = [];
	readonly direct: boolean;
	readonly #conversations = new Map<string, ConversationState>();
	readonly #now: () => Date;
	#nextId = 1;

	/** `direct`: behave like a channel with no inbox behind it (ADR 0007). */
	constructor(options: { now?: () => Date; direct?: boolean } = {}) {
		this.#now = options.now ?? (() => new Date());
		this.direct = options.direct ?? false;
	}

	/** Adds messages to a conversation, creating it if needed. */
	seed(conversationId: string, messages: Message[] = []): this {
		this.conversation(conversationId).messages.push(...messages);
		return this;
	}

	conversation(conversationId: string): ConversationState {
		let state = this.#conversations.get(conversationId);
		if (!state) {
			state = { messages: [], status: "pending", labels: [], attributes: {} };
			this.#conversations.set(conversationId, state);
		}
		return state;
	}

	async history(conversationId: string): Promise<Message[]> {
		return [...this.conversation(conversationId).messages].sort((a, b) =>
			a.sentAt.localeCompare(b.sentAt),
		);
	}

	async perform(action: Action): Promise<ActionResult> {
		this.performed.push(action);
		const state = this.conversation(action.conversationId);

		switch (action.type) {
			case "request_phone":
			case "reply":
			case "relay":
			case "note": {
				const id = `mem-${this.#nextId++}`;
				state.messages.push({
					id,
					author: action.type === "relay" ? "human" : "bot",
					text: action.text,
					attachments: [],
					private: action.type === "note",
					sentAt: this.#now().toISOString(),
				});
				return { externalId: id };
			}
			case "handoff":
				state.status = "open";
				if (action.team !== undefined) state.team = action.team;
				return {};
			case "add_labels":
				state.labels = [...new Set([...state.labels, ...action.labels])];
				return {};
			case "set_attributes":
				Object.assign(state.attributes, action.attributes);
				return {};
			case "resolve":
				state.status = "resolved";
				return {};
		}
	}
}
