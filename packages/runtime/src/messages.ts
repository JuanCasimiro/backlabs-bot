import type { Message } from "@backlabs/core";
import { type BaseMessage, HumanMessage } from "@langchain/core/messages";

export function toModelMessage(message: Message): BaseMessage {
	const attachments = message.attachments.map((a) => `[attachment: ${a.kind}]`);
	const content = [message.text, ...attachments].filter(Boolean).join("\n");
	// Providers reject empty turns; a shared contact, for one, has no text.
	return new HumanMessage({ id: message.id, content: content || "(no text)" });
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
