import { defineTool } from "@backlabs/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfigError, loadConfig } from "../src/index.ts";

const ping = defineTool({
	name: "ping",
	description: "ping",
	input: z.object({}),
	async run() {
		return "pong";
	},
});

describe("config", () => {
	it("accepts a valid config and fills defaults", () => {
		const config = loadConfig(
			{
				entryAgent: "a",
				agents: [{ name: "a", instructions: "x", tools: ["ping"] }],
			},
			[ping],
		);

		expect(config.agents[0]).toMatchObject({
			mode: "autonomous",
			handoffs: [],
		});
	});

	it("refuses an unknown entry agent", () => {
		expect(() =>
			loadConfig(
				{ entryAgent: "b", agents: [{ name: "a", instructions: "x" }] },
				[],
			),
		).toThrow(ConfigError);
	});

	it("refuses an unknown handoff target", () => {
		expect(() =>
			loadConfig(
				{
					entryAgent: "a",
					agents: [{ name: "a", instructions: "x", handoffs: ["b"] }],
				},
				[],
			),
		).toThrow(/unknown agent "b"/);
	});

	it("refuses an agent that uses a tool nobody provides", () => {
		expect(() =>
			loadConfig(
				{
					entryAgent: "a",
					agents: [{ name: "a", instructions: "x", tools: ["pong"] }],
				},
				[ping],
			),
		).toThrow(/unknown tool "pong"/);
	});

	it("refuses a tool named like a built-in", () => {
		const clash = { ...ping, name: "handoff_to_human" };
		expect(() =>
			loadConfig(
				{ entryAgent: "a", agents: [{ name: "a", instructions: "x" }] },
				[clash],
			),
		).toThrow(/reserved/);
	});
});
