import { setTimeout as sleep } from "node:timers/promises";
import type { BotConfigInput, ChannelPort, Event, Tool } from "@backlabs/core";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type pg from "pg";
import { loadConfig } from "./config.ts";
import { createDispatcher } from "./dispatcher.ts";
import { buildAgentGraph } from "./graph.ts";
import { enqueue } from "./inbox.ts";
import { createWorker } from "./worker.ts";

export type RuntimeOptions = {
	pool: pg.Pool;
	channel: ChannelPort;
	model: BaseChatModel;
	checkpointer: BaseCheckpointSaver;
	config: BotConfigInput;
	tools: Tool[];
	/** Default 2 s: customers often send several short messages in a row. */
	debounceMs?: number;
	/** Default 2 min: longer than any run is expected to take. */
	leaseMs?: number;
	retryDelayMs?: number;
	maxAttempts?: number;
};

export type Runtime = ReturnType<typeof createRuntime>;

/** Wires config, graph, worker and dispatcher. Validates the config first. */
export function createRuntime(options: RuntimeOptions) {
	const config = loadConfig(options.config, options.tools);
	const graph = buildAgentGraph({
		config,
		tools: options.tools,
		model: options.model,
		checkpointer: options.checkpointer,
	});
	const worker = createWorker({
		pool: options.pool,
		config,
		graph,
		modelName: modelName(options.model),
		debounceMs: options.debounceMs ?? 2_000,
		leaseMs: options.leaseMs ?? 120_000,
		direct: options.channel.direct ?? false,
	});
	const dispatcher = createDispatcher({
		pool: options.pool,
		channel: options.channel,
		...(options.retryDelayMs === undefined
			? {}
			: { retryDelayMs: options.retryDelayMs }),
		...(options.maxAttempts === undefined
			? {}
			: { maxAttempts: options.maxAttempts }),
	});

	return {
		config,
		enqueue: (event: Event) => enqueue(options.pool, event),
		processNext: worker.processNext,
		dispatchNext: dispatcher.dispatchNext,
		/** Runs the worker and dispatcher loops until the signal aborts. */
		async start(loop: {
			signal: AbortSignal;
			idleMs?: number;
			onError?: (error: unknown) => void;
		}) {
			const idleMs = loop.idleMs ?? 250;
			const onError =
				loop.onError ?? ((error) => console.error("[backlabs]", error));
			const forever = async (step: () => Promise<boolean>) => {
				while (!loop.signal.aborted) {
					const worked = await step().catch((error) => {
						onError(error);
						return false;
					});
					if (!worked)
						await sleep(idleMs, undefined, { signal: loop.signal }).catch(
							() => {},
						);
				}
			};
			await Promise.all([
				forever(worker.processNext),
				forever(dispatcher.dispatchNext),
			]);
		},
	};
}

function modelName(model: BaseChatModel): string {
	const named = model as BaseChatModel & { model?: unknown };
	return typeof named.model === "string" ? named.model : model._llmType();
}
