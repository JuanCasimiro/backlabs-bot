import type { Message } from "@backlabs/core";
import { type BaseMessage, HumanMessage } from "@langchain/core/messages";

/**
 * Every message reaches the model as a user turn. A human-authored one (a
 * brief) is marked as coming from the team, so the model uses it to answer
 * the customer instead of answering it.
 */
export function toModelMessage(message: Message): BaseMessage {
	const content = contentOf(message);
	return new HumanMessage({
		id: message.id,
		content:
			message.author === "human" ? `${FROM_THE_TEAM} ${content}` : content,
	});
}

// Strong on purpose: client prompts usually forbid inventing prices or stock,
// and a brief must read as the opposite of inventing.
export const FROM_THE_TEAM =
	"[Message from your team, not from the customer. It is confirmed information from the business: use it to answer the customer now, without saying you cannot confirm it.]";

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
