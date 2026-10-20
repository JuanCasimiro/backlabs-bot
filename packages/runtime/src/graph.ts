import type {
	Action,
	AgentConfig,
	BotConfig,
	Message,
	Tool,
	ToolContext,
} from "@backlabs/core";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
	type AIMessage,
	type BaseMessage,
	SystemMessage,
	ToolMessage,
} from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
	Annotation,
	type BaseCheckpointSaver,
	END,
	MessagesAnnotation,
	START,
	StateGraph,
} from "@langchain/langgraph";
import { runClientTool, systemPrompt, toolDefinitions } from "./agent-tools.ts";
import { HANDOFF_TO_HUMAN, REQUEST_PHONE, TRANSFER_PREFIX } from "./config.ts";
import { textOf, toModelMessage } from "./messages.ts";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
	? Omit<T, K>
	: never;

/** An action the graph wants; the worker gives it its conversation and key. */
export type Intent = DistributiveOmit<
	Action,
	"idempotencyKey" | "conversationId"
>;

/** What one run produced. Reset at the start of every run. */
type Turn = {
	intents: Intent[];
	agent?: string;
	inputTokens: number;
	outputTokens: number;
	/** A built-in ended the run (e.g. the phone request is the answer). */
	stopped: boolean;
};
type TurnUpdate = Partial<Turn> | { reset: true };

const emptyTurn = (): Turn => ({
	intents: [],
	inputTokens: 0,
	outputTokens: 0,
	stopped: false,
});

function mergeTurn(turn: Turn, update: TurnUpdate): Turn {
	if ("reset" in update) return emptyTurn();
	return {
		intents: [...turn.intents, ...(update.intents ?? [])],
		agent: update.agent ?? turn.agent,
		inputTokens: turn.inputTokens + (update.inputTokens ?? 0),
		outputTokens: turn.outputTokens + (update.outputTokens ?? 0),
		stopped: turn.stopped || (update.stopped ?? false),
	};
}

export type AgentRun = {
	threadId: string;
	/** Fork from here; omitted on a fresh thread. */
	checkpointId: string | null;
	messages: Message[];
	context: ToolContext;
};

export type AgentRunResult = Omit<Turn, "stopped"> & { checkpointId: string };

export type AgentGraph = { run(run: AgentRun): Promise<AgentRunResult> };

/** Tool-call rounds a single run may take before it is stopped as a loop. */
const RECURSION_LIMIT = 24;

/**
 * Compiles the client configuration into a LangGraph graph (ADR 0002): an
 * agent node that calls the model with the active agent's prompt and tools,
 * and a tools node that runs client tools and the built-ins (transfers,
 * handoff, phone request). The graph never touches a channel: it returns
 * intents, which the worker writes to the outbox.
 */
export function buildAgentGraph(options: {
	config: BotConfig;
	tools: Tool[];
	model: BaseChatModel;
	checkpointer: BaseCheckpointSaver;
}): AgentGraph {
	const { config, model } = options;
	const agents = new Map(config.agents.map((a) => [a.name, a]));
	const tools = new Map(options.tools.map((t) => [t.name, t]));
	const agentNamed = (name: string): AgentConfig => {
		const agent = agents.get(name);
		if (!agent) throw new Error(`unknown agent "${name}"`);
		return agent;
	};

	const State = Annotation.Root({
		...MessagesAnnotation.spec,
		activeAgent: Annotation<string>({
			reducer: (_, next) => next,
			default: () => config.entryAgent,
		}),
		turn: Annotation<Turn, TurnUpdate>({
			reducer: mergeTurn,
			default: emptyTurn,
		}),
	});
	type State = typeof State.State;

	async function callAgent(state: State, runConfig: RunnableConfig) {
		const agent = agentNamed(state.activeAgent);
		const context = contextOf(runConfig);
		const response = await bindTools(
			model,
			toolDefinitions(agent, tools),
		).invoke(
			[new SystemMessage(systemPrompt(agent, context)), ...state.messages],
			runConfig,
		);
		return {
			messages: [response],
			turn: {
				agent: agent.name,
				inputTokens: response.usage_metadata?.input_tokens ?? 0,
				outputTokens: response.usage_metadata?.output_tokens ?? 0,
			},
		};
	}

	async function runTools(state: State, runConfig: RunnableConfig) {
		const agent = agentNamed(state.activeAgent);
		const context = contextOf(runConfig);
		const calls = (state.messages.at(-1) as AIMessage).tool_calls ?? [];
		const messages: ToolMessage[] = [];
		const intents: Intent[] = [];
		let activeAgent = state.activeAgent;
		let stopped = false;

		for (const call of calls) {
			const respond = (observation: unknown) =>
				messages.push(
					new ToolMessage({
						tool_call_id: call.id ?? call.name,
						content: JSON.stringify(observation),
					}),
				);

			const target = call.name.startsWith(TRANSFER_PREFIX)
				? call.name.slice(TRANSFER_PREFIX.length)
				: undefined;

			if (target !== undefined) {
				// Models can call tools they were not offered; only listed handoffs count.
				if (agent.handoffs.includes(target)) {
					activeAgent = target;
					respond({ ok: true, now_answering: target });
				} else {
					respond({ error: "unknown_tool" });
				}
			} else if (call.name === HANDOFF_TO_HUMAN) {
				const summary =
					String(call.args.summary ?? "").trim() || "Handoff requested.";
				intents.push({ type: "note", text: summary });
				intents.push({
					type: "handoff",
					...(agent.team ? { team: agent.team } : {}),
				});
				respond({
					ok: true,
					detail: "A human will take over. Tell the customer briefly.",
				});
			} else if (call.name === REQUEST_PHONE && agent.mode === "autonomous") {
				intents.push({
					type: "request_phone",
					text: String(call.args.message ?? ""),
				});
				stopped = true;
				respond({ ok: true });
			} else {
				respond(
					await runClientTool(tools.get(call.name), agent, call.args, context),
				);
			}
		}

		return {
			messages,
			activeAgent,
			turn: { intents, stopped },
		};
	}

	function finish(state: State) {
		const agent = agentNamed(state.activeAgent);
		const text = textOf(state.messages.at(-1));
		if (!text) return {};
		const intent: Intent =
			agent.mode === "copilot"
				? { type: "note", text }
				: { type: "reply", text };
		return { turn: { intents: [intent] } };
	}

	const graph = new StateGraph(State)
		.addNode("agent", callAgent)
		.addNode("tools", runTools)
		.addNode("finish", finish)
		.addEdge(START, "agent")
		.addConditionalEdges("agent", (state) =>
			hasToolCalls(state.messages.at(-1)) ? "tools" : "finish",
		)
		.addConditionalEdges("tools", (state) =>
			state.turn.stopped ? END : "agent",
		)
		.addEdge("finish", END)
		.compile({ checkpointer: options.checkpointer });

	return {
		async run(run) {
			const thread = { thread_id: run.threadId };
			const state = await graph.invoke(
				{ messages: run.messages.map(toModelMessage), turn: { reset: true } },
				{
					configurable: {
						...thread,
						...(run.checkpointId ? { checkpoint_id: run.checkpointId } : {}),
						toolContext: run.context,
					},
					recursionLimit: RECURSION_LIMIT,
				},
			);
			const saved = await graph.getState({ configurable: thread });
			const { stopped: _, ...turn } = state.turn;
			return {
				...turn,
				checkpointId: String(saved.config.configurable?.checkpoint_id),
			};
		},
	};
}

function bindTools(
	model: BaseChatModel,
	tools: ReturnType<typeof toolDefinitions>,
) {
	if (!model.bindTools)
		throw new Error("the chat model does not support tools");
	return model.bindTools(tools);
}

function contextOf(runConfig: RunnableConfig): ToolContext {
	const context = runConfig.configurable?.toolContext as
		| ToolContext
		| undefined;
	if (!context) throw new Error("run started without a tool context");
	return context;
}

function hasToolCalls(message: BaseMessage | undefined): boolean {
	return Boolean((message as AIMessage | undefined)?.tool_calls?.length);
}
