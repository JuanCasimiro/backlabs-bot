import type { Action, BotConfig } from "@backlabs/core";
import type pg from "pg";
import {
	type ConversationRecord,
	claimConversation,
	releaseConversation,
	saveConversation,
} from "./conversations.ts";
import { inTransaction } from "./db.ts";
import { foldEvents } from "./fold.ts";
import type { AgentGraph, Intent } from "./graph.ts";
import { decideAccess, verifiedPhone } from "./identity.ts";
import { hasEventsAfter, markProcessed, pendingEvents } from "./inbox.ts";
import { errorMessage } from "./messages.ts";
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
	/** How long a worker owns a conversation before another may take it. */
	leaseMs: number;
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
		const folded = foldEvents(
			conversation,
			pending.map((p) => p.event),
		);
		const next: ConversationRecord = {
			...conversation,
			mode: folded.mode,
			contact: folded.contact,
			...(folded.resetMemory ? { threadId: null, checkpointId: null } : {}),
		};

		if (
			folded.mode === "human" ||
			folded.messages.length === 0 ||
			!folded.contact
		) {
			return commit({ conversation: next, upToSeq, runId: null, intents: [] });
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
				intents: [intent],
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

		let result: Awaited<ReturnType<AgentGraph["run"]>>;
		try {
			result = await graph.run({
				threadId,
				checkpointId: next.checkpointId,
				messages: folded.messages,
				context: {
					conversationId: conversation.id,
					contact: folded.contact,
					...(phone ? { verifiedPhone: phone } : {}),
				},
			});
		} catch (error) {
			return commit({
				conversation: { ...next, mode: "human" },
				upToSeq,
				runId,
				intents: fallbackIntents(config, error),
				outcome: { status: "FAILED", error: errorMessage(error) },
			});
		}

		// The customer wrote again while the model was thinking: this answer is
		// based on an incomplete conversation. Drop it; the next run starts again
		// from the last committed checkpoint and sees everything.
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
			intents: result.intents,
			outcome: {
				status: "SUCCEEDED",
				...(result.agent ? { agent: result.agent } : {}),
				inputTokens: result.inputTokens,
				outputTokens: result.outputTokens,
			},
		});
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
