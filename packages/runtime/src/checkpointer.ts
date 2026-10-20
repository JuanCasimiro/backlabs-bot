import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type pg from "pg";

/**
 * The agents' memory in the same Postgres as the inbox and outbox. Creates its
 * tables if needed. `schema` defaults to "public".
 */
export async function createPostgresCheckpointer(
	pool: pg.Pool,
	options: { schema?: string } = {},
): Promise<PostgresSaver> {
	const checkpointer = new PostgresSaver(pool, undefined, options);
	await checkpointer.setup();
	return checkpointer;
}
