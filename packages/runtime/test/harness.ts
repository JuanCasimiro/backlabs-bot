import type { BotConfigInput, Event, Tool } from "@backlabs/core";
import { InMemoryChannel } from "@backlabs/testing";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { createRuntime, type Runtime } from "../src/index.ts";
import type { ScriptStep } from "../src/testing.ts";
import { ScriptedChatModel } from "../src/testing.ts";
import type { TestDatabase } from "./support.ts";

export const singleAgent: BotConfigInput = {
	entryAgent: "reception",
	agents: [{ name: "reception", instructions: "Help the customer." }],
};

/** A runtime wired to an in-memory channel and a scripted model. */
export async function bot(
	db: TestDatabase,
	options: {
		script?: ScriptStep[];
		config?: BotConfigInput;
		tools?: Tool[];
		debounceMs?: number;
	} = {},
) {
	const channel = new InMemoryChannel();
	const model = new ScriptedChatModel(options.script ?? []);
	const checkpointer = new PostgresSaver(db.pool, undefined, {
		schema: db.schema,
	});
	await checkpointer.setup();

	const runtime: Runtime = createRuntime({
		pool: db.pool,
		channel,
		model,
		checkpointer,
		config: options.config ?? singleAgent,
		tools: options.tools ?? [],
		debounceMs: options.debounceMs ?? 0,
		retryDelayMs: 0,
	});

	return {
		channel,
		model,
		runtime,
		async send(...events: Event[]) {
			for (const event of events) await runtime.enqueue(event);
		},
		/** Runs workers and the dispatcher until there is nothing left to do. */
		async settle() {
			while (await runtime.processNext()) {}
			while (await runtime.dispatchNext()) {}
		},
		/** What the customer would see, in order. */
		replies(conversationId = "conv-1") {
			return channel
				.conversation(conversationId)
				.messages.filter((m) => !m.private)
				.map((m) => m.text);
		},
		notes(conversationId = "conv-1") {
			return channel
				.conversation(conversationId)
				.messages.filter((m) => m.private)
				.map((m) => m.text);
		},
	};
}
