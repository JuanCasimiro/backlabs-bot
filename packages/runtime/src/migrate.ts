import type { Queryable } from "./db.ts";

// Tables live in the connection's search_path, so a deployment (or a test)
// picks its schema with the connection string.
const SCHEMA = `
create table if not exists conversations (
	id text primary key,
	mode text not null default 'bot' check (mode in ('bot', 'human')),
	contact jsonb,
	thread_id text,
	checkpoint_id text,
	lease_until timestamptz,
	created_at timestamptz not null default now()
);

create table if not exists inbox (
	seq bigserial primary key,
	event_id text not null unique,
	conversation_id text not null references conversations (id),
	event jsonb not null,
	received_at timestamptz not null default now(),
	processed_at timestamptz,
	run_id uuid
);
create index if not exists inbox_pending
	on inbox (conversation_id, seq) where processed_at is null;

create table if not exists runs (
	id uuid primary key,
	conversation_id text not null references conversations (id),
	status text not null check (status in ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
	agent text,
	model text,
	input_tokens integer,
	output_tokens integer,
	error text,
	started_at timestamptz not null default clock_timestamp(),
	finished_at timestamptz
);

create table if not exists outbox (
	seq bigserial primary key,
	idempotency_key text not null unique,
	run_id uuid not null references runs (id),
	conversation_id text not null references conversations (id),
	action jsonb not null,
	status text not null default 'PLANNED' check (status in ('PLANNED', 'SUCCEEDED', 'FAILED')),
	attempts integer not null default 0,
	next_attempt_at timestamptz not null default now(),
	external_id text,
	error text,
	created_at timestamptz not null default now(),
	performed_at timestamptz
);
create index if not exists outbox_planned
	on outbox (conversation_id, seq) where status = 'PLANNED';
`;

/** Creates the runtime's tables if they do not exist. Safe to run at every boot. */
export async function migrate(db: Queryable): Promise<void> {
	await db.query(SCHEMA);
}
