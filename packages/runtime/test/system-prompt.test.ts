import { describe, expect, it } from "vitest";
import { systemPrompt } from "../src/agent-tools.ts";

const agent = {
	name: "reception",
	instructions: "Be brief.",
	tools: [],
	handoffs: [],
	mode: "autonomous" as const,
};
const context = { conversationId: "c1", contact: { id: "u1", name: "Ana" } };

describe("system prompt", () => {
	it("tells the agent that an ask_team result is the team's confirmed answer", () => {
		const prompt = systemPrompt(agent, context);

		expect(prompt.indexOf("Be brief.")).toBe(0);
		expect(prompt).toContain("`ask_team`");
		expect(prompt).toMatch(/confirmed by the business/);
		expect(prompt).toMatch(
			/even if your instructions tell you to leave that topic to a person/,
		);
	});

	it("tells the agent that no person follows the conversation while it answers", () => {
		const prompt = systemPrompt(agent, context);

		expect(prompt).toMatch(/no person of your team is following/);
		expect(prompt).toMatch(
			/Never say a person will contact the customer unless you call `handoff_to_human` in this turn/,
		);
	});
});
