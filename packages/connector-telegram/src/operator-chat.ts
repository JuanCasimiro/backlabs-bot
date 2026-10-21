/**
 * The first line of every message the bot posts to the operator chat: a mark
 * and the conversation id. An operator's reply to that message is routed to
 * the conversation by reading this line back, so nothing is stored. It is
 * fixed on purpose: the configurable texts go below it.
 */
const MARKS = { note: "📝", handoff: "🙋", failed: "⚠️" } as const;

export type OperatorMessageKind = keyof typeof MARKS;

/** Telegram HTML, ending with a line break. */
export function operatorHeader(
	kind: OperatorMessageKind,
	conversationId: string,
): string {
	const id = escapeHtml(conversationId);
	// tg://user lets the operator open the customer's profile.
	const label =
		kind === "handoff"
			? `<a href="tg://user?id=${id}">${id}</a>`
			: `<b>${id}</b>`;
	return `${MARKS[kind]} ${label}\n`;
}

const HEADER = /^(?:📝|🙋|⚠️?) (\S+)$/u;

/**
 * The conversation id in the plain text Telegram gives back for a message the
 * bot posted to the operator chat, or null when it is not one of those.
 */
export function conversationIdOf(text: string | undefined): string | null {
	const firstLine = text?.split("\n", 1)[0] ?? "";
	return HEADER.exec(firstLine)?.[1] ?? null;
}

export function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
