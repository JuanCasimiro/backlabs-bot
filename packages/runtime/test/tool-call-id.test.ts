import { describe, expect, it } from "vitest";
import { teamToolCallId } from "../src/graph.ts";

describe("team tool call id", () => {
	it("only has characters providers accept, whatever the channel put in the message id", () => {
		for (const id of ["40", "eval-2:1", "chatwoot:message:77", "a b/c.d"]) {
			expect(teamToolCallId(id)).toMatch(/^[a-zA-Z0-9_-]+$/);
		}
		expect(teamToolCallId("eval-2:1")).toBe("team_eval-2_1");
	});
});
