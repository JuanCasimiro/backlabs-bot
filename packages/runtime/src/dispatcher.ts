import type { Action, ChannelPort } from "@backlabs/core";
import type pg from "pg";
import { inTransaction } from "./db.ts";
import { errorMessage } from "./messages.ts";

export type DispatcherOptions = {
	pool: pg.Pool;
	channel: ChannelPort;
	/** First retry delay; doubles on every attempt. Default 5 s. */
	retryDelayMs?: number;
	/** Attempts before an action is marked FAILED. Default 5. */
	maxAttempts?: number;
};

type Row = { seq: string; action: Action; attempts: number };

/**
 * Performs planned actions through the channel (ADR 0004), one at a time and
 * in order within each conversation: an action never overtakes an earlier one
 * that is still waiting for a retry.
 */
export function createDispatcher(options: DispatcherOptions) {
	const retryDelayMs = options.retryDelayMs ?? 5_000;
	const maxAttempts = options.maxAttempts ?? 5;

	async function dispatchNext(): Promise<boolean> {
		return inTransaction(options.pool, async (tx) => {
			const { rows } = await tx.query<Row>(
				`select seq, action, attempts from outbox o
				 where status = 'PLANNED' and next_attempt_at <= now()
					and not exists (
						select 1 from outbox earlier
						where earlier.conversation_id = o.conversation_id
							and earlier.status = 'PLANNED' and earlier.seq < o.seq
					)
				 order by seq
				 limit 1
				 for update skip locked`,
			);
			const row = rows[0];
			if (!row) return false;

			const attempts = row.attempts + 1;
			try {
				const result = await options.channel.perform(row.action);
				await tx.query(
					`update outbox set status = 'SUCCEEDED', attempts = $2, external_id = $3,
						performed_at = now(), error = null
					 where seq = $1`,
					[row.seq, attempts, result.externalId ?? null],
				);
			} catch (error) {
				const retry = isRetryable(error) && attempts < maxAttempts;
				await tx.query(
					`update outbox set
						status = $2,
						attempts = $3,
						error = $4,
						next_attempt_at = now() + $5 * interval '1 millisecond'
					 where seq = $1`,
					[
						row.seq,
						retry ? "PLANNED" : "FAILED",
						attempts,
						errorMessage(error),
						retryDelayMs * 2 ** (attempts - 1),
					],
				);
			}
			return true;
		});
	}

	return { dispatchNext };
}

/** Connector errors say whether trying again can help (`retryable`). */
function isRetryable(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"retryable" in error &&
		error.retryable === true
	);
}
