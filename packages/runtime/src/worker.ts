import type { Action, BotConfig, Message } from "@backlabs/core";
import type pg from "pg";
import {
	type ConversationRecord,
	claimConversation,
	releaseConversation,
	saveConversation,
} from "./conversations.ts";
import { inTransaction } from "./db.ts";
import { foldEvents } from "./fold.ts";
import type { AgentGraph, Intent, ThreadPoint } from "./graph.ts";
import { decideAccess, verifiedPhone } from "./identity.ts";
import { hasEventsAfter, markProcessed, pendingEvents } from "./inbox.ts";
import { contentOf, errorMessage } from "./messages.ts";
import { planActions } from "./outbox.ts";
import { finishRun, type RunOutcome, startRun } from "./runs.ts";

export type WorkerOptions = {
	pool: pg.Pool;
	config: BotConfig;
	graph: AgentGraph;
	/** Recorded in the run ledger. */
	modelName: string;
	/** Quiet time after the last message before answering. */
	debounceMs: number;
	/** Longest a pending message waits for the quiet time (RT-12). */
	maxWaitMs: number;
	/** How long a worker owns a conversation before another may take it. */
	leaseMs: number;
	/** The channel has no inbox behind it (`ChannelPort.direct`, ADR 0007). */
	direct: boolean;
};

type Commit = {
	conversation: ConversationRecord;
	upToSeq: number;
	runId: string | null;
	intents: Intent[];
	outcome?: RunOutcome;
};

/**
 * Processes conversations one at a time (ADR 0004): claim a conversation,
 * fold its pending events, run the agent graph if the bot owns it, and commit
 * the actions to the outbox together with marking the events processed.
 */
export function createWorker(options: WorkerOptions) {
	const { pool, config, graph } = options;

	async function processNext(): Promise<boolean> {
		const conversation = await claimConversation(pool, options);
		if (!conversation) return false;

		try {
			await processConversation(conversation);
		} catch (error) {
			// The lease is released so the events are retried, not stuck.
			await releaseConversation(pool, conversation.id);
			throw error;
		}
		return true;
	}

	async function processConversation(conversation: ConversationRecord) {
		const pending = await pendingEvents(pool, conversation.id);
		const upToSeq = pending.at(-1)?.seq ?? 0;
		const paused = await waitingForTeam(conversation);
		const folded = foldEvents(
			conversation,
			pending.map((p) => p.event),
			{ waitingForTeam: paused !== null },
		);
		const next: ConversationRecord = {
			...conversation,
			mode: folded.mode,
			contact: folded.contact,
			...(folded.resetMemory ? { threadId: null, checkpointId: null } : {}),
		};

		// Planned first: they happened before anything the agent answers now.
		const forOperators: Intent[] = [
			...(options.direct ? folded.humanTurn.flatMap(toOperators) : []),
			...folded.unusedBriefs.map(
				(): Intent => ({
					type: "note",
					text: config.texts.briefWithoutHandoff,
				}),
			),
		];

		const answering =
			folded.mode === "bot" &&
			(folded.brief !== null || folded.messages.length > 0);
		if (!answering || !folded.contact) {
			// RT-17: the paused thread records what happened while a human owned
			// the conversation, so the agent sees it when the team answers.
			if (paused && !folded.resetMemory && folded.humanTurn.length > 0) {
				next.checkpointId = await graph.append(paused, folded.humanTurn);
			}
			if (forOperators.length === 0) {
				return commit({
					conversation: next,
					upToSeq,
					runId: null,
					intents: [],
				});
			}
			const runId = await startRun(pool, {
				conversationId: conversation.id,
				agent: null,
				model: null,
			});
			return commit({
				conversation: next,
				upToSeq,
				runId,
				intents: forOperators,
				outcome: { status: "SUCCEEDED" },
			});
		}

		const access = decideAccess(config.access, folded.contact);
		if (access !== "allowed" && config.access) {
			const runId = await startRun(pool, {
				conversationId: conversation.id,
				agent: null,
				model: null,
			});
			const intent: Intent =
				access === "verify"
					? { type: "request_phone", text: config.access.verifyText }
					: { type: "reply", text: config.access.deniedText };
			return commit({
				conversation: next,
				upToSeq,
				runId,
				intents: [...forOperators, intent],
				outcome: { status: "SUCCEEDED" },
			});
		}

		const runId = await startRun(pool, {
			conversationId: conversation.id,
			agent: null,
			model: options.modelName,
		});
		const threadId = next.threadId ?? runId;
		const phone = verifiedPhone(folded.contact);
		const context = {
			conversationId: conversation.id,
			contact: folded.contact,
			...(phone ? { verifiedPhone: phone } : {}),
		};

		let result: Awaited<ReturnType<AgentGraph["run"]>>;
		try {
			result =
				folded.brief && paused
					? await graph.resumeWithTeamAnswer({
							...paused,
							between: folded.humanTurn,
							brief: folded.brief,
							messages: folded.messages,
							context,
						})
					: await graph.run({
							threadId,
							checkpointId: next.checkpointId,
							messages: folded.messages,
							context,
						});
		} catch (error) {
			return commit({
				conversation: { ...next, mode: "human" },
				upToSeq,
				runId,
				intents: [...forOperators, ...fallbackIntents(config, error)],
				outcome: { status: "FAILED", error: errorMessage(error) },
			});
		}

		// The customer wrote again while the model was thinking: this answer is
		// based on an incomplete conversation. Drop it; the next run starts again
		// from the last committed checkpoint (a paused thread: from the pause)
		// and sees everything.
		if (await hasEventsAfter(pool, conversation.id, upToSeq)) {
			await finishRun(pool, runId, { status: "CANCELLED" });
			await releaseConversation(pool, conversation.id);
			return;
		}

		const handedOff = result.intents.some((i) => i.type === "handoff");
		return commit({
			conversation: {
				...next,
				mode: handedOff ? "human" : next.mode,
				threadId,
				checkpointId: result.checkpointId,
			},
			upToSeq,
			runId,
			intents: [...forOperators, ...result.intents],
			outcome: {
				status: "SUCCEEDED",
				...(result.agent ? { agent: result.agent } : {}),
				inputTokens: result.inputTokens,
				outputTokens: result.outputTokens,
			},
		});
	}

	/**
	 * The committed point of the conversation's thread if it waits for the
	 * team. Asks the graph, so the pause has one source of truth. Only a
	 * committed handoff pauses a thread, and it leaves the conversation in
	 * `human` mode: other conversations skip the lookup.
	 */
	async function waitingForTeam(
		conversation: ConversationRecord,
	): Promise<ThreadPoint | null> {
		const { mode, threadId, checkpointId } = conversation;
		if (mode !== "human" || !threadId || !checkpointId) return null;
		const point = { threadId, checkpointId };
		return (await graph.waitingFor(point)) === "team" ? point : null;
	}

	/** Everything a run decided becomes durable together, or not at all. */
	async function commit(change: Commit) {
		await inTransaction(pool, async (tx) => {
			if (change.runId) {
				await planActions(tx, change.runId, toActions(change));
				if (change.outcome) await finishRun(tx, change.runId, change.outcome);
			}
			await markProcessed(
				tx,
				change.conversation.id,
				change.upToSeq,
				change.runId,
			);
			await saveConversation(tx, change.conversation);
		});
	}

	return { processNext };
}

function toActions({ conversation, runId, intents }: Commit): Action[] {
	return intents.map(
		(intent, n) =>
			({
				...intent,
				conversationId: conversation.id,
				idempotencyKey: `${runId}:${n}`,
			}) as Action,
	);
}

/**
 * On a direct channel operators see the conversation only through the bot:
 * customer messages reach them as notes they can reply to, and their own
 * replies reach the customer as relays.
 */
function toOperators(message: Message): Intent[] {
	if (message.author !== "human") {
		return [{ type: "note", text: `💬 ${contentOf(message)}` }];
	}
	// Text only: an empty human message has nothing to relay.
	if (!message.text) return [];
	return [{ type: "relay", text: message.text, sourceMessageId: message.id }];
}

function fallbackIntents(config: BotConfig, error: unknown): Intent[] {
	return [
		{
			type: "note",
			text: `The bot could not answer (${errorMessage(error)}). A human needs to take over.`,
		},
		...(config.fallbackText
			? [{ type: "reply" as const, text: config.fallbackText }]
			: []),
		{ type: "handoff" },
	];
}
