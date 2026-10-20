import { z } from "zod";
import type { Contact } from "./conversation.ts";

/** What a tool can rely on besides its arguments. Never filled by the model. */
export type ToolContext = {
	conversationId: string;
	contact: Contact;
	/** Set only when the channel proved the number (ADR 0006). */
	verifiedPhone?: string;
};

/**
 * A capability an agent can call. `input` is what the model fills in; data
 * about who is asking comes from `context`, so a customer cannot talk a tool
 * into reading someone else's records.
 */
export type Tool<Input extends z.ZodType = z.ZodType> = {
	name: string;
	description: string;
	input: Input;
	/** The runtime refuses to call the tool until the phone is verified. */
	requires?: "verified_phone";
	/**
	 * Returns an observation for the model: plain JSON with what was found and
	 * where it came from. Throw only for outages and bugs.
	 */
	run(input: z.infer<Input>, context: ToolContext): Promise<unknown>;
};

/** Infers the input type from the schema, so `run` is typed without casts. */
export function defineTool<Input extends z.ZodType>(
	tool: Tool<Input>,
): Tool<Input> {
	return tool;
}

const Name = z.string().regex(/^[a-z][a-z0-9_]*$/, "lower_snake_case");

export const AgentConfigSchema = z.object({
	name: Name,
	/** System prompt. */
	instructions: z.string().min(1),
	/** Names of tools this agent may call. */
	tools: z.array(Name).default([]),
	/** Agents this one can transfer the conversation to. */
	handoffs: z.array(Name).default([]),
	/** Human team that receives this agent's handoffs. */
	team: z.string().min(1).optional(),
	/**
	 * `autonomous` answers the customer. `copilot` never does: its answers
	 * become private notes for humans, e.g. a brief and candidate products for
	 * a salesperson.
	 */
	mode: z.enum(["autonomous", "copilot"]).default("autonomous"),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const AccessPolicySchema = z.object({
	/**
	 * Only these verified numbers (E.164, e.g. +5491122334455) get an agent.
	 * Omitted: everyone does.
	 */
	allowedPhones: z.array(z.string().regex(/^\+\d{8,15}$/)).optional(),
	/** Sent with `request_phone` when the number is not verified yet. */
	verifyText: z.string().min(1),
	/** Sent to a verified number that is not allowed. */
	deniedText: z.string().min(1),
});
export type AccessPolicy = z.infer<typeof AccessPolicySchema>;

export const BotConfigSchema = z
	.object({
		agents: z.array(AgentConfigSchema).min(1),
		entryAgent: Name,
		access: AccessPolicySchema.optional(),
		/**
		 * Sent to the customer when a run fails and the bot hands off, so the
		 * silence is explained. Omitted: the customer gets nothing.
		 */
		fallbackText: z.string().min(1).optional(),
	})
	.superRefine((config, ctx) => {
		const names = new Set(config.agents.map((a) => a.name));
		if (names.size !== config.agents.length) {
			ctx.addIssue({ code: "custom", message: "agent names must be unique" });
		}
		if (!names.has(config.entryAgent)) {
			ctx.addIssue({
				code: "custom",
				path: ["entryAgent"],
				message: `unknown agent "${config.entryAgent}"`,
			});
		}
		for (const agent of config.agents) {
			for (const target of agent.handoffs) {
				if (!names.has(target)) {
					ctx.addIssue({
						code: "custom",
						path: ["agents", agent.name, "handoffs"],
						message: `unknown agent "${target}"`,
					});
				}
			}
		}
	});
export type BotConfig = z.infer<typeof BotConfigSchema>;
export type BotConfigInput = z.input<typeof BotConfigSchema>;
