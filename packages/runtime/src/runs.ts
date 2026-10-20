import { randomUUID } from "node:crypto";
import type { Queryable } from "./db.ts";

export type RunOutcome =
	| {
			status: "SUCCEEDED";
			agent?: string;
			inputTokens?: number;
			outputTokens?: number;
	  }
	| { status: "CANCELLED" }
	| { status: "FAILED"; error: string };

/** Opens a run in the ledger. `agent` and `model` are null when no model runs. */
export async function startRun(
	db: Queryable,
	run: { conversationId: string; agent: string | null; model: string | null },
): Promise<string> {
	const id = randomUUID();
	await db.query(
		`insert into runs (id, conversation_id, status, agent, model)
		 values ($1, $2, 'RUNNING', $3, $4)`,
		[id, run.conversationId, run.agent, run.model],
	);
	return id;
}

export async function finishRun(
	db: Queryable,
	id: string,
	outcome: RunOutcome,
): Promise<void> {
	await db.query(
		`update runs set
			status = $2,
			agent = coalesce($3, agent),
			input_tokens = $4,
			output_tokens = $5,
			error = $6,
			finished_at = clock_timestamp()
		 where id = $1`,
		[
			id,
			outcome.status,
			outcome.status === "SUCCEEDED" ? (outcome.agent ?? null) : null,
			outcome.status === "SUCCEEDED" ? (outcome.inputTokens ?? null) : null,
			outcome.status === "SUCCEEDED" ? (outcome.outputTokens ?? null) : null,
			outcome.status === "FAILED" ? outcome.error : null,
		],
	);
}
