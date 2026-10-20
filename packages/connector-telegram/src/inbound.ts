import { timingSafeEqual } from "node:crypto";
import type { InboundChannel, InboundResult } from "@backlabs/core";
import { toEvent, Update, type UpdateOptions } from "./updates.ts";

export type TelegramInboundOptions = UpdateOptions & {
	/** The `secret_token` given to setWebhook. */
	secretToken: string;
};

/** Verifies and parses webhook requests from the Bot API. */
export function telegramInbound(
	options: TelegramInboundOptions,
): InboundChannel {
	return {
		parse(request): InboundResult {
			const token = request.headers["x-telegram-bot-api-secret-token"];
			if (!token || !sameSecret(token, options.secretToken)) {
				return { ok: false, reason: "unauthorized" };
			}

			let json: unknown;
			try {
				json = JSON.parse(request.body);
			} catch {
				return { ok: false, reason: "invalid", detail: "body is not JSON" };
			}
			const update = Update.safeParse(json);
			if (!update.success) {
				return { ok: false, reason: "invalid", detail: update.error.message };
			}
			return { ok: true, event: toEvent(update.data, options) };
		},
	};
}

function sameSecret(given: string, expected: string): boolean {
	const a = Buffer.from(given);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}
