import type pg from "pg";

/** A pool or a client inside a transaction: both can run queries. */
export type Queryable = Pick<pg.Pool, "query">;

export async function inTransaction<T>(
	pool: pg.Pool,
	work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		const result = await work(client);
		await client.query("commit");
		return result;
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}
