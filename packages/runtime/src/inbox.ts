import type { Event } from "@backlabs/core";
import type { Queryable } from "./db.ts";

/**
 * Stores an inbound event for the worker. Delivering the same `eventId` twice
 * is a no-op, which is what makes webhook retries harmless. Never runs an agent.
 */
export async function enqueue(
	db: Queryable,
	event: Event,
): Promise<{ stored: boolean }> {
	await db.query(
		"insert into conversations (id) values ($1) on conflict do nothing",
		[event.conversationId],
	);
	const result = await db.query(
		`insert into inbox (event_id, conversation_id, event) values ($1, $2, $3)
		 on conflict (event_id) do nothing`,
		[event.eventId, event.conversationId, event],
	);
	return { stored: result.rowCount === 1 };
}

export type PendingEvent = { seq: number; event: Event };

/** Unprocessed events of a conversation, in arrival order. */
export async function pendingEvents(
	db: Queryable,
	conversationId: string,
): Promise<PendingEvent[]> {
	const { rows } = await db.query<{ seq: string; event: Event }>(
		`select seq, event from inbox
		 where conversation_id = $1 and processed_at is null
		 order by seq`,
		[conversationId],
	);
	return rows.map((row) => ({ seq: Number(row.seq), event: row.event }));
}

/** True when an event arrived after `seq`: a run based on `seq` is stale. */
export async function hasEventsAfter(
	db: Queryable,
	conversationId: string,
	seq: number,
): Promise<boolean> {
	const { rows } = await db.query(
		`select 1 from inbox
		 where conversation_id = $1 and processed_at is null and seq > $2
		 limit 1`,
		[conversationId, seq],
	);
	return rows.length > 0;
}

export async function markProcessed(
	db: Queryable,
	conversationId: string,
	upToSeq: number,
	runId: string | null,
): Promise<void> {
	await db.query(
		`update inbox set processed_at = now(), run_id = $3
		 where conversation_id = $1 and processed_at is null and seq <= $2`,
		[conversationId, upToSeq, runId],
	);
}
