import { z } from "zod";

/** The bot's user id is the number before the colon in its token. */
export function botIdFromToken(token: string): number {
	const id = Number(/^(\d+):/.exec(token)?.[1]);
	if (!Number.isInteger(id) || id <= 0) {
		throw new Error("Telegram token must look like <bot id>:<secret>");
	}
	return id;
}

export class TelegramApiError extends Error {
	override name = "TelegramApiError";
	readonly status: number;
	readonly method: string;

	constructor(status: number, method: string, description: string) {
		super(`Telegram answered ${status} on ${method}: ${description}`);
		this.status = status;
		this.method = method;
	}

	/** Flood limits and server errors may pass; anything else will fail again. */
	get retryable(): boolean {
		return this.status === 429 || this.status >= 500;
	}
}

const Envelope = z.union([
	z.object({ ok: z.literal(true), result: z.unknown() }),
	z.object({
		ok: z.literal(false),
		error_code: z.number(),
		description: z.string().default(""),
	}),
]);

export type BotApi = <S extends z.ZodType>(
	method: string,
	body: Record<string, unknown>,
	result: S,
) => Promise<z.infer<S>>;

/** Calls Bot API methods with JSON bodies and unwraps `{ ok, result }`. */
export function botApi(options: {
	token: string;
	fetch?: typeof fetch;
	/** Default https://api.telegram.org */
	baseUrl?: string;
}): BotApi {
	const fetch = options.fetch ?? globalThis.fetch;
	const root = `${options.baseUrl ?? "https://api.telegram.org"}/bot${options.token}`;

	return async (method, body, result) => {
		const response = await fetch(`${root}/${method}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		const envelope = Envelope.safeParse(
			await response.json().catch(() => null),
		);
		if (!envelope.success) {
			throw new TelegramApiError(
				response.status,
				method,
				"unreadable response",
			);
		}
		if (!envelope.data.ok) {
			throw new TelegramApiError(
				envelope.data.error_code,
				method,
				envelope.data.description,
			);
		}
		return result.parse(envelope.data.result);
	};
}
