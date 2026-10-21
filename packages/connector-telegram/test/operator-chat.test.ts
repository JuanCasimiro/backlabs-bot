import { describe, expect, it } from "vitest";
import {
	conversationIdOf,
	type OperatorMessageKind,
	operatorHeader,
} from "../src/operator-chat.ts";

/** Roughly what Telegram gives back for HTML it rendered: the text, no tags. */
const plain = (html: string) => html.replace(/<[^>]+>/g, "");

describe("operator chat header", () => {
	it.each<OperatorMessageKind>(["note", "handoff", "failed"])(
		"reads back the conversation id of a %s",
		(kind) => {
			const text = `${plain(operatorHeader(kind, "1001"))}Anything below.`;

			expect(conversationIdOf(text)).toBe("1001");
		},
	);

	it("finds no id in other messages of the bot", () => {
		expect(conversationIdOf("Bot started.\n📝 1001")).toBeNull();
		expect(conversationIdOf(undefined)).toBeNull();
	});
});
