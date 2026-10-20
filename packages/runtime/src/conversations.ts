import type { Contact } from "@backlabs/core";
import type { Queryable } from "./db.ts";

/** Who answers the conversation now (ADR 0007). */
export type ConversationMode = "bot" | "human";

export type ConversationRecord = {
	id: string;
	mode: ConversationMode;
	contact: Contact | null;
	/** LangGraph thread and the last checkpoint a committed run left. */
	threadId: string | null;
	checkpointId: string | null;
};

type Row = {
	id: string;
	mode: ConversationMode;
	contact: Contact | null;
	thread_id: string | null;
	checkpoint_id: string | null;
};

/**
 * Leases the conversation that has waited longest, if its newest pending
 * event is older than the debounce window. A leased conversation is invisible
 * to other workers until it is released or the lease expires (a crashed
 * worker), so one conversation never has two runs at once.
 */
export async function claimConversation(
	db: Queryable,
	options: { debounceMs: number; leaseMs: number },
): Promise<ConversationRecord | null> {
	const { rows } = await db.query<Row>(
		`update conversations c
		 set lease_until = now() + $2 * interval '1 millisecond'
		 where c.id = (
			select candidate.id from conversations candidate
			join lateral (
				select min(seq) as first_seq, max(received_at) as last_received
				from inbox
				where conversation_id = candidate.id and processed_at is null
			) pending on pending.first_seq is not null
			where (candidate.lease_until is null or candidate.lease_until < now())
				and pending.last_received <= clock_timestamp() - $1 * interval '1 millisecond'
			order by pending.first_seq
			limit 1
			for update of candidate skip locked
		 )
		 returning c.id, c.mode, c.contact, c.thread_id, c.checkpoint_id`,
		[options.debounceMs, options.leaseMs],
	);
	const row = rows[0];
	return row ? fromRow(row) : null;
}

/** Saves the conversation and gives up the lease. */
export async function saveConversation(
	db: Queryable,
	record: ConversationRecord,
): Promise<void> {
	await db.query(
		`update conversations
		 set mode = $2, contact = $3, thread_id = $4, checkpoint_id = $5, lease_until = null
		 where id = $1`,
		[
			record.id,
			record.mode,
			record.contact,
			record.threadId,
			record.checkpointId,
		],
	);
}

export async function releaseConversation(
	db: Queryable,
	id: string,
): Promise<void> {
	await db.query("update conversations set lease_until = null where id = $1", [
		id,
	]);
}

function fromRow(row: Row): ConversationRecord {
	return {
		id: row.id,
		mode: row.mode,
		contact: row.contact,
		threadId: row.thread_id,
		checkpointId: row.checkpoint_id,
	};
}
