/** Shapes from https://core.telegram.org/bots/api#update, anonymised. */
export const CUSTOMER = {
	id: 1001,
	is_bot: false,
	first_name: "Ana",
	last_name: "Gómez",
};
export const OPERATOR_CHAT_ID = -5001;

export function textUpdate(
	text: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		update_id: 700,
		message: {
			message_id: 12,
			date: 1_760_961_600,
			chat: { id: CUSTOMER.id, type: "private", first_name: "Ana" },
			from: CUSTOMER,
			text,
			...overrides,
		},
	};
}

export function contactUpdate(contact: Record<string, unknown>) {
	const update = textUpdate("");
	const { text: _, ...message } = update.message;
	return { ...update, message: { ...message, contact } };
}

export function operatorUpdate(text: string) {
	return {
		update_id: 701,
		message: {
			message_id: 40,
			date: 1_760_961_700,
			chat: { id: OPERATOR_CHAT_ID, type: "group", title: "Operators" },
			from: { id: 2002, is_bot: false, first_name: "Op" },
			text,
		},
	};
}

type Call = { method: string; body: Record<string, unknown> };

/** A fake Bot API that records calls and answers each method from a table. */
export function fakeTelegram(answers: Record<string, unknown[]> = {}) {
	const calls: Call[] = [];
	let messageId = 100;

	const fetch: typeof globalThis.fetch = async (url, init) => {
		const method = String(url).split("/").at(-1) ?? "";
		const body = JSON.parse(String(init?.body ?? "{}"));
		calls.push({ method, body });

		const queued = answers[method]?.shift();
		const payload = queued ?? {
			ok: true,
			result: { message_id: ++messageId, date: 1_760_961_600 },
		};
		const status =
			typeof payload === "object" && payload && "error_code" in payload
				? Number(payload.error_code)
				: 200;
		return new Response(JSON.stringify(payload), { status });
	};

	return { fetch, calls };
}
