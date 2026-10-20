import type { AgentConfig, Tool, ToolContext } from "@backlabs/core";
import { z } from "zod";
import { HANDOFF_TO_HUMAN, REQUEST_PHONE, TRANSFER_PREFIX } from "./config.ts";
import { errorMessage } from "./messages.ts";

// What an agent sees: its prompt with system facts, and its tool list.

export function toolDefinitions(agent: AgentConfig, tools: Map<string, Tool>) {
	const definition = (name: string, description: string, input: z.ZodType) => ({
		type: "function" as const,
		function: { name, description, parameters: z.toJSONSchema(input) },
	});

	const own = agent.tools.map((name) => {
		const tool = tools.get(name) as Tool;
		return definition(tool.name, tool.description, tool.input);
	});
	const transfers = agent.handoffs.map((target) =>
		definition(
			`${TRANSFER_PREFIX}${target}`,
			`Transfer the conversation to the "${target}" agent, which answers from now on.`,
			z.object({}),
		),
	);
	const handoff = definition(
		HANDOFF_TO_HUMAN,
		`Hand the conversation to a human${agent.team ? ` of the ${agent.team} team` : ""}. Use it when the customer asks for a person or you cannot help.`,
		z.object({
			summary: z
				.string()
				.describe(
					"For the human: what the customer wants and what you found out.",
				),
		}),
	);
	const requestPhone = definition(
		REQUEST_PHONE,
		"Ask the customer to verify their phone number, needed before looking up their own records. Ends your turn.",
		z.object({
			message: z
				.string()
				.describe("What the customer reads next to the share button."),
		}),
	);

	return [
		...own,
		...transfers,
		handoff,
		...(agent.mode === "autonomous" ? [requestPhone] : []),
	];
}

export function systemPrompt(agent: AgentConfig, context: ToolContext): string {
	// Facts from the system, not from the customer: the model must not have to
	// guess identity from what the customer typed (ADR 0006).
	const facts = [
		`- Customer name: ${context.contact.name ?? "unknown"}`,
		`- Phone verified by the channel: ${context.verifiedPhone ? "yes" : "no"}`,
	];
	return `${agent.instructions}\n\n## Conversation context (from the system)\n${facts.join("\n")}`;
}

/** Runs a client tool, enforcing what the agent may call and identity (ADR 0006). */
export async function runClientTool(
	tool: Tool | undefined,
	agent: AgentConfig,
	args: unknown,
	context: ToolContext,
): Promise<unknown> {
	if (!tool || !agent.tools.includes(tool.name)) {
		return { error: "unknown_tool" };
	}
	if (tool.requires === "verified_phone" && !context.verifiedPhone) {
		return {
			error: "identity_not_verified",
			detail:
				"This needs the customer's verified phone number. Ask them to verify it.",
		};
	}
	const input = tool.input.safeParse(args);
	if (!input.success) {
		return { error: "invalid_arguments", detail: z.prettifyError(input.error) };
	}
	try {
		return await tool.run(input.data, context);
	} catch (error) {
		// An outage of a system of record: the agent can apologise or hand off.
		return { error: "tool_failed", detail: errorMessage(error) };
	}
}
