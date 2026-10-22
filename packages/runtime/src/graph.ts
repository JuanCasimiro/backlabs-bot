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
	AIMessage,
	type BaseMessage,
	SystemMessage,
	ToolMessage,
} from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
	Annotation,
	type BaseCheckpointSaver,
	Command,
	END,
	interrupt,
	MessagesAnnotation,
	START,
	StateGraph,
} from "@langchain/langgraph";
import { runClientTool, systemPrompt, toolDefinitions } from "./agent-tools.ts";
import {
	ASK_TEAM,
	HANDOFF_TO_HUMAN,
	REQUEST_PHONE,
	TRANSFER_PREFIX,
} from "./config.ts";
import { contentOf, textOf, toModelMessage } from "./messages.ts";

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
	/** The agent handed off: the run pauses, waiting for the team (RT-15). */
	handedOff: boolean;
};
type TurnUpdate = Partial<Turn> | { reset: true };

const emptyTurn = (): Turn => ({
	intents: [],
	inputTokens: 0,
	outputTokens: 0,
	stopped: false,
	handedOff: false,
});

function mergeTurn(turn: Turn, update: TurnUpdate): Turn {
	if ("reset" in update) return emptyTurn();
	return {
		intents: [...turn.intents, ...(update.intents ?? [])],
		agent: update.agent ?? turn.agent,
		inputTokens: turn.inputTokens + (update.inputTokens ?? 0),
		outputTokens: turn.outputTokens + (update.outputTokens ?? 0),
		stopped: turn.stopped || (update.stopped ?? false),
		handedOff: turn.handedOff || (update.handedOff ?? false),
	};
}

/** A committed point of a conversation's thread. */
export type ThreadPoint = { threadId: string; checkpointId: string };

export type AgentRun = {
	threadId: string;
	/** Fork from here; omitted on a fresh thread. */
	checkpointId: string | null;
	messages: Message[];
	context: ToolContext;
};

/**
 * Resumes a thread waiting for the team. `between` happened while a human
 * owned the conversation; `brief` is the team's answer; `messages` came
 * after it.
 */
export type TeamAnswerRun = Omit<AgentRun, "checkpointId"> & {
	checkpointId: string;
	between: Message[];
	brief: Message;
};

/** What a paused thread waits for. Approvals (RT-05) will add theirs. */
export type WaitingFor = "team";

export type AgentRunResult = Omit<Turn, "stopped" | "handedOff"> & {
	checkpointId: string;
};

export type AgentGraph = {
	run(run: AgentRun): Promise<AgentRunResult>;
	resumeWithTeamAnswer(run: TeamAnswerRun): Promise<AgentRunResult>;
	/** What the thread waits for at this point, if it is paused. */
	waitingFor(point: ThreadPoint): Promise<WaitingFor | null>;
	/**
	 * Appends messages to a paused thread without running anything, keeping
	 * the pause. Returns the new checkpoint.
	 */
	append(point: ThreadPoint, messages: Message[]): Promise<string>;
};

/** Passed to `interrupt` and back through `Command({ resume })`. */
type TeamAnswer = { brief: Message; messages: Message[] };

const WAIT_FOR_TEAM = "wait_for_team";

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
		let handedOff = false;

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
				handedOff = true;
				respond({
					ok: true,
					// Models otherwise offer to keep collecting ("send me a photo and
					// I'll add it"), but the bot stays silent until the team answers.
					detail:
						"A person of your team takes over from here; you will not answer again until they hand the conversation back. Tell the customer briefly, and do not offer to receive or do anything else yourself.",
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
			turn: { intents, stopped, handedOff },
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

	/**
	 * After a handoff the thread pauses here until the team answers. The
	 * answer reaches the model as the result of a call to `ask_team` made on
	 * the bot's behalf: models treat tool results as facts, and user turns as
	 * the customer (RT-15). Writes nothing before the interrupt, since the
	 * node runs again from the top on resume.
	 */
	function waitForTeam(state: State) {
		const answer = interrupt<WaitingFor, TeamAnswer>("team");
		const question = lastHandoffSummary(state.messages);
		const id = teamToolCallId(answer.brief.id);
		return {
			messages: [
				new AIMessage({
					content: "",
					tool_calls: [
						{ id, name: ASK_TEAM, args: { question }, type: "tool_call" },
					],
				}),
				new ToolMessage({
					tool_call_id: id,
					content: `Answer from the team: ${contentOf(answer.brief)}`,
				}),
				...answer.messages.map(toModelMessage),
			],
			turn: { reset: true } as TurnUpdate,
		};
	}

	const graph = new StateGraph(State)
		.addNode("agent", callAgent)
		.addNode("tools", runTools)
		.addNode("finish", finish)
		.addNode(WAIT_FOR_TEAM, waitForTeam)
		.addEdge(START, "agent")
		.addConditionalEdges("agent", (state) =>
			hasToolCalls(state.messages.at(-1)) ? "tools" : "finish",
		)
		.addConditionalEdges("tools", (state) =>
			state.turn.stopped ? END : "agent",
		)
		.addConditionalEdges("finish", (state) =>
			state.turn.handedOff ? WAIT_FOR_TEAM : END,
		)
		.addEdge(WAIT_FOR_TEAM, "agent")
		.compile({ checkpointer: options.checkpointer });

	const at = (point: ThreadPoint) => ({
		configurable: {
			thread_id: point.threadId,
			checkpoint_ns: "",
			checkpoint_id: point.checkpointId,
		},
	});

	async function append(point: ThreadPoint, messages: Message[]) {
		// As if written by `finish`: the edge after it leads back to the pause.
		const saved = await graph.updateState(
			at(point),
			{ messages: messages.map(toModelMessage) },
			"finish",
		);
		return String(saved.configurable?.checkpoint_id);
	}

	async function invoke(
		input: Parameters<typeof graph.invoke>[0],
		run: Omit<AgentRun, "messages">,
	): Promise<AgentRunResult> {
		const thread = { thread_id: run.threadId };
		const state = await graph.invoke(input, {
			configurable: {
				...thread,
				...(run.checkpointId ? { checkpoint_id: run.checkpointId } : {}),
				toolContext: run.context,
			},
			recursionLimit: RECURSION_LIMIT,
		});
		const saved = await graph.getState({ configurable: thread });
		const { stopped: _, handedOff: __, ...turn } = state.turn;
		return {
			...turn,
			checkpointId: String(saved.config.configurable?.checkpoint_id),
		};
	}

	return {
		run: (run) =>
			invoke(
				{ messages: run.messages.map(toModelMessage), turn: { reset: true } },
				run,
			),

		async resumeWithTeamAnswer(run) {
			// Always from a fresh checkpoint: LangGraph keeps the writes of a run
			// on the checkpoint it resumed from and would replay them, so a
			// discarded attempt (RT-02) must not resume from the same one.
			const checkpointId = await append(run, run.between);
			const answer: TeamAnswer = { brief: run.brief, messages: run.messages };
			return invoke(new Command({ resume: answer }), { ...run, checkpointId });
		},

		async waitingFor(point) {
			const state = await graph.getState(at(point));
			return state.next.includes(WAIT_FOR_TEAM) ? "team" : null;
		},

		append,
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

/**
 * Providers only accept `[a-zA-Z0-9_-]` in a tool call id (Anthropic returns
 * 400 otherwise). Message ids come from the channel and can carry anything.
 */
export function teamToolCallId(briefId: string): string {
	return `team_${briefId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/** What the bot asked the team: the summary of its last handoff, for the synthetic call. */
function lastHandoffSummary(messages: BaseMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const call = (messages[i] as AIMessage).tool_calls?.find(
			(c) => c.name === HANDOFF_TO_HUMAN,
		);
		if (call) return String(call.args.summary ?? "").trim();
	}
	return "";
}
