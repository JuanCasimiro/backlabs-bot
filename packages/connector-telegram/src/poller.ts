import { setTimeout as sleep } from "node:timers/promises";
import type { Event } from "@backlabs/core";
import { z } from "zod";
import { botApi } from "./api.ts";
import { toEvent, Update, type UpdateOptions } from "./updates.ts";

export type PollOptions = UpdateOptions & {
	token: string;
	signal: AbortSignal;
	/** Store the event (the runtime's `enqueue`). Must be idempotent. */
	onEvent: (event: Event) => Promise<unknown>;
	onError?: (error: unknown) => void;
	/** Called when a poll returned nothing. Mostly for tests. */
	onIdle?: () => void;
	/** Long-poll wait, in seconds. Default 30. */
	timeoutSeconds?: number;
	/** Pause after an error. Default 2 s. */
	retryDelayMs?: number;
	fetch?: typeof fetch;
	baseUrl?: string;
};

/**
 * Receives updates with getUpdates, so a bot runs without a public URL.
 * Telegram drops updates below `offset`, so the offset only moves past an
 * update once the inbox has stored it: a crash redelivers, the inbox dedups.
 * Telegram refuses getUpdates while a webhook is set (deleteWebhook first).
 */
export async function pollTelegram(options: PollOptions): Promise<void> {
	const call = botApi(options);
	const onError =
		options.onError ?? ((error) => console.error("[telegram]", error));
	let offset: number | undefined;

	while (!options.signal.aborted) {
		try {
			const updates = await call(
				"getUpdates",
				{
					timeout: options.timeoutSeconds ?? 30,
					allowed_updates: ["message"],
					...(offset === undefined ? {} : { offset }),
				},
				z.array(z.unknown()),
			);
			if (updates.length === 0) options.onIdle?.();

			for (const raw of updates) {
				const update = Update.safeParse(raw);
				// An update we cannot read is skipped, or it would block the queue.
				if (update.success) {
					const event = toEvent(update.data, options);
					if (event) await options.onEvent(event);
				}
				offset = updateId(raw) + 1;
			}
		} catch (error) {
			onError(error);
			await sleep(options.retryDelayMs ?? 2_000, undefined, {
				signal: options.signal,
			}).catch(() => {});
		}
	}
}

function updateId(raw: unknown): number {
	return z.object({ update_id: z.number() }).parse(raw).update_id;
}
