import type { Action } from "@backlabs/core";
import type { Queryable } from "./db.ts";

/**
 * Writes actions as PLANNED. An idempotency key already in the outbox is
 * skipped, so re-planning the same step never performs it twice.
 */
export async function planActions(
	db: Queryable,
	runId: string,
	actions: Action[],
): Promise<void> {
	if (actions.length === 0) return;
	await db.query(
		`insert into outbox (idempotency_key, run_id, conversation_id, action)
		 select key, $1, conversation_id, action
		 from jsonb_to_recordset($2::jsonb) as a(key text, conversation_id text, action jsonb)
		 on conflict (idempotency_key) do nothing`,
		[
			runId,
			JSON.stringify(
				actions.map((action) => ({
					key: action.idempotencyKey,
					conversation_id: action.conversationId,
					action,
				})),
			),
		],
	);
}
