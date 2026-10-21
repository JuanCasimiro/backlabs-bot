import {
	BaseChatModel,
	type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { textOf } from "./messages.ts";

/** One model turn of a script. Async steps can act while "the model thinks". */
export type ScriptStep = (input?: {
	messages: BaseMessage[];
}) => AIMessage | Promise<AIMessage>;

/** What the model was given on one call, for assertions. */
export type ScriptedCall = {
	/** Customer and assistant texts, oldest first; no system or tool messages. */
	texts: string[];
	/** Texts of user turns only: what the model reads as said by the customer. */
	userTexts: string[];
	/** Names of the tools offered on this call. */
	tools: string[];
	/** The latest tool result, parsed from JSON. */
	lastToolResult: unknown;
};

/**
 * A chat model that plays back a script instead of calling a provider, so the
 * runtime and agent wiring can be tested deterministically. Runs out loudly.
 */
export class ScriptedChatModel extends BaseChatModel {
	readonly calls: ScriptedCall[] = [];
	readonly #steps: ScriptStep[];
	#tools: string[] = [];

	constructor(steps: ScriptStep[]) {
		super({});
		this.#steps = [...steps];
	}

	_llmType(): string {
		return "scripted";
	}

	override bindTools(tools: BindToolsInput[]): this {
		this.#tools = tools.map(toolName);
		return this;
	}

	async _generate(messages: BaseMessage[]): Promise<ChatResult> {
		const toolResults = messages.filter((m) => m.type === "tool");
		this.calls.push({
			texts: messages
				.filter((m) => m.type === "human" || m.type === "ai")
				.map(textOf)
				.filter(Boolean),
			userTexts: messages
				.filter((m) => m.type === "human")
				.map(textOf)
				.filter(Boolean),
			tools: this.#tools,
			lastToolResult: parse(toolResults.at(-1)?.content),
		});

		const step = this.#steps.shift();
		if (!step) throw new Error(`script exhausted at call ${this.calls.length}`);
		const message = await step({ messages });
		return { generations: [{ text: textOf(message), message }] };
	}
}

let callId = 0;

/** A turn where the model answers with text. */
export function say(
	text: string,
	usage?: { inputTokens: number; outputTokens: number },
): ScriptStep {
	return () =>
		new AIMessage({
			content: text,
			...(usage
				? {
						usage_metadata: {
							input_tokens: usage.inputTokens,
							output_tokens: usage.outputTokens,
							total_tokens: usage.inputTokens + usage.outputTokens,
						},
					}
				: {}),
		});
}

/** A turn where the model calls a tool. */
export function call(name: string, args: Record<string, unknown>): ScriptStep {
	return () => {
		callId += 1;
		return new AIMessage({
			content: "",
			tool_calls: [{ id: `call_${callId}`, name, args, type: "tool_call" }],
		});
	};
}

function toolName(tool: BindToolsInput): string {
	const t = tool as { name?: string; function?: { name?: string } };
	return t.function?.name ?? t.name ?? "unnamed";
}

function parse(content: unknown): unknown {
	if (typeof content !== "string") return undefined;
	try {
		return JSON.parse(content);
	} catch {
		return content;
	}
}
