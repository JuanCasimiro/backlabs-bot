import type { Message } from "@backlabs/core";
import {
	AIMessage,
	type BaseMessage,
	HumanMessage,
} from "@langchain/core/messages";

/**
 * A customer message is a user turn. A human-authored one (an operator's
 * reply the customer received from the bot's account) is an assistant turn:
 * to the conversation it is what the business said. Briefs never come
 * through here: they are the result of the handoff (RT-15).
 */
export function toModelMessage(message: Message): BaseMessage {
	const content = contentOf(message);
	return message.author === "human"
		? new AIMessage({ id: message.id, content })
		: new HumanMessage({ id: message.id, content });
}

/** Text plus a marker per attachment, never empty. */
export function contentOf(message: Message): string {
	const attachments = message.attachments.map((a) => `[attachment: ${a.kind}]`);
	const content = [message.text, ...attachments].filter(Boolean).join("\n");
	// Providers reject empty turns; a shared contact, for one, has no text.
	return content || "(no text)";
}

/** Text of a model message, whether content is a string or content blocks. */
export function textOf(message: BaseMessage | undefined): string {
	if (!message) return "";
	if (typeof message.content === "string") return message.content.trim();
	return message.content
		.map((block) =>
			block.type === "text" && "text" in block ? String(block.text) : "",
		)
		.join("")
		.trim();
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
