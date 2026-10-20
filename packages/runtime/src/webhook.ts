import type { IncomingMessage, ServerResponse } from "node:http";
import type { InboundChannel } from "@backlabs/core";
import type { Queryable } from "./db.ts";
import { enqueue } from "./inbox.ts";

/**
 * A Node HTTP handler for a channel's webhooks. It verifies and parses the
 * request, stores the event and answers: it never waits for an agent.
 */
export function webhookHandler(options: {
	inbound: InboundChannel;
	db: Queryable;
	/** Called when an event could not be stored. */
	onError?: (error: unknown) => void;
}) {
	return async (request: IncomingMessage, response: ServerResponse) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk as Buffer);

		const result = options.inbound.parse({
			headers: request.headers as Record<string, string | undefined>,
			body: Buffer.concat(chunks).toString("utf8"),
		});
		if (!result.ok) {
			response.writeHead(result.reason === "unauthorized" ? 401 : 400).end();
			return;
		}
		try {
			if (result.event) await enqueue(options.db, result.event);
			response.writeHead(200).end();
		} catch (error) {
			// Not stored: a 5xx makes the channel deliver it again.
			options.onError?.(error);
			response.writeHead(500).end();
		}
	};
}
