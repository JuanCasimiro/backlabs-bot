import {
	type BotConfig,
	type BotConfigInput,
	BotConfigSchema,
	type Tool,
} from "@backlabs/core";
import { z } from "zod";

export class ConfigError extends Error {
	override name = "ConfigError";
}

export const HANDOFF_TO_HUMAN = "handoff_to_human";
export const REQUEST_PHONE = "request_phone_verification";
export const TRANSFER_PREFIX = "transfer_to_";

/**
 * Validates the client configuration against the tools it provides. Called at
 * boot: an invalid configuration must refuse to start, not fail mid-chat.
 */
export function loadConfig(input: BotConfigInput, tools: Tool[]): BotConfig {
	const parsed = BotConfigSchema.safeParse(input);
	if (!parsed.success) throw new ConfigError(z.prettifyError(parsed.error));
	const config = parsed.data;

	const problems: string[] = [];
	const provided = new Set<string>();
	for (const tool of tools) {
		if (isBuiltIn(tool.name))
			problems.push(`tool name "${tool.name}" is reserved`);
		if (provided.has(tool.name))
			problems.push(`tool "${tool.name}" is provided twice`);
		provided.add(tool.name);
	}
	for (const agent of config.agents) {
		for (const name of agent.tools) {
			if (!provided.has(name)) {
				problems.push(`agent "${agent.name}" uses unknown tool "${name}"`);
			}
		}
	}

	if (problems.length > 0) throw new ConfigError(problems.join("\n"));
	return config;
}

function isBuiltIn(name: string): boolean {
	return (
		name === HANDOFF_TO_HUMAN ||
		name === REQUEST_PHONE ||
		name.startsWith(TRANSFER_PREFIX)
	);
}
