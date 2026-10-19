import { describe, expect, it } from "vitest";
import { channelContract, InMemoryChannel } from "../src/index.ts";

channelContract("InMemoryChannel", async () => ({
	channel: new InMemoryChannel(),
	conversationId: "1",
}));

describe("InMemoryChannel", () => {
	const key = { idempotencyKey: "k", conversationId: "1" };

	it("records every action in order", async () => {
		const channel = new InMemoryChannel();
		await channel.perform({ ...key, type: "reply", text: "hola" });
		await channel.perform({ ...key, type: "resolve" });

		expect(channel.performed.map((a) => a.type)).toEqual(["reply", "resolve"]);
	});

	it("tracks handoffs, labels and attributes", async () => {
		const channel = new InMemoryChannel();
		await channel.perform({ ...key, type: "handoff", team: "sales" });
		await channel.perform({ ...key, type: "add_labels", labels: ["a", "b"] });
		await channel.perform({ ...key, type: "add_labels", labels: ["b", "c"] });
		await channel.perform({
			...key,
			type: "set_attributes",
			attributes: { patente: "AB123CD" },
		});

		expect(channel.conversation("1")).toMatchObject({
			status: "open",
			team: "sales",
			labels: ["a", "b", "c"],
			attributes: { patente: "AB123CD" },
		});
	});
});
