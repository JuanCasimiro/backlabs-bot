import { describe, expect, it } from "vitest";
import { ChatwootApiError, chatwootChannel } from "../src/index.ts";

type Call = {
	method: string;
	path: string;
	token: string | null;
	body: unknown;
};

/** A fetch that records calls and answers from a table keyed by "METHOD path". */
function fakeChatwoot(
	routes: Record<string, { status?: number; json: unknown }> = {},
) {
	const calls: Call[] = [];
	const fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input));
		const path = url.pathname.replace("/api/v1/accounts/1", "");
		const method = init?.method ?? "GET";
		const headers = new Headers(init?.headers);
		calls.push({
			method,
			path,
			token: headers.get("api_access_token"),
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
		});
		const route = routes[`${method} ${path}`] ?? { json: {} };
		return new Response(JSON.stringify(route.json), {
			status: route.status ?? 200,
			headers: { "content-type": "application/json" },
		});
	};

	const channel = chatwootChannel({
		baseUrl: "https://chat.example.com/",
		accountId: 1,
		botToken: "bot-token",
		readToken: "user-token",
		teams: { sales: 7 },
		fetch,
	});

	return { channel, calls };
}

const key = { idempotencyKey: "run-1:step-1", conversationId: "42" };

describe("history", () => {
	it("reads with the user token and maps messages oldest first", async () => {
		const { channel, calls } = fakeChatwoot({
			"GET /conversations/42/messages": {
				json: {
					payload: [
						{
							id: 3,
							content: "Te paso con ventas",
							message_type: 1,
							private: false,
							created_at: 1_760_875_260,
							sender: { id: 1, type: "agent_bot" },
						},
						{
							id: 1,
							content: "Hola",
							message_type: 0,
							private: false,
							created_at: 1_760_875_200,
							sender: { id: 77, type: "contact" },
						},
						{
							id: 2,
							content: "Ana se unió a la conversación",
							message_type: 2,
							private: false,
							created_at: 1_760_875_230,
						},
						{
							id: 4,
							content: "Cliente frecuente",
							message_type: 1,
							private: true,
							created_at: 1_760_875_300,
							sender: { id: 5, type: "user" },
							attachments: [
								{ file_type: "file", data_url: "https://cw/f.pdf" },
							],
						},
					],
				},
			},
		});

		const history = await channel.history("42");

		expect(calls).toEqual([
			{
				method: "GET",
				path: "/conversations/42/messages",
				token: "user-token",
				body: undefined,
			},
		]);
		expect(history).toEqual([
			{
				id: "1",
				author: "customer",
				text: "Hola",
				attachments: [],
				private: false,
				sentAt: "2025-10-19T12:00:00.000Z",
			},
			{
				id: "3",
				author: "bot",
				text: "Te paso con ventas",
				attachments: [],
				private: false,
				sentAt: "2025-10-19T12:01:00.000Z",
			},
			{
				id: "4",
				author: "human",
				text: "Cliente frecuente",
				attachments: [{ kind: "file", url: "https://cw/f.pdf" }],
				private: true,
				sentAt: "2025-10-19T12:01:40.000Z",
			},
		]);
	});
});

describe("perform", () => {
	it("replies as the bot and returns the message id", async () => {
		const { channel, calls } = fakeChatwoot({
			"POST /conversations/42/messages": { json: { id: 900 } },
		});

		const result = await channel.perform({
			...key,
			type: "reply",
			text: "¡Hola!",
		});

		expect(result).toEqual({ externalId: "900" });
		expect(calls).toEqual([
			{
				method: "POST",
				path: "/conversations/42/messages",
				token: "bot-token",
				body: { content: "¡Hola!", message_type: "outgoing", private: false },
			},
		]);
	});

	it("asks for the phone with a public message: Chatwoot has no share button", async () => {
		const { channel, calls } = fakeChatwoot({
			"POST /conversations/42/messages": { json: { id: 902 } },
		});

		await channel.perform({
			...key,
			type: "request_phone",
			text: "¿Me pasás tu número?",
		});

		expect(calls[0]?.body).toEqual({
			content: "¿Me pasás tu número?",
			message_type: "outgoing",
			private: false,
		});
	});

	it("writes a note as a private message", async () => {
		const { channel, calls } = fakeChatwoot({
			"POST /conversations/42/messages": { json: { id: 901 } },
		});

		await channel.perform({ ...key, type: "note", text: "Pide presupuesto" });

		expect(calls[0]?.body).toEqual({
			content: "Pide presupuesto",
			message_type: "outgoing",
			private: true,
		});
	});

	it("hands off to a team: assigns it and opens the conversation", async () => {
		const { channel, calls } = fakeChatwoot();

		await channel.perform({ ...key, type: "handoff", team: "sales" });

		expect(
			calls.map(({ method, path, body }) => ({ method, path, body })),
		).toEqual([
			{
				method: "POST",
				path: "/conversations/42/assignments",
				body: { team_id: 7 },
			},
			{
				method: "POST",
				path: "/conversations/42/toggle_status",
				body: { status: "open" },
			},
		]);
	});

	it("hands off to any human by only opening the conversation", async () => {
		const { channel, calls } = fakeChatwoot();

		await channel.perform({ ...key, type: "handoff" });

		expect(calls.map((c) => c.path)).toEqual([
			"/conversations/42/toggle_status",
		]);
	});

	it("refuses a handoff to a team it does not know, before calling Chatwoot", async () => {
		const { channel, calls } = fakeChatwoot();

		await expect(
			channel.perform({ ...key, type: "handoff", team: "ventas" }),
		).rejects.toThrow(/ventas/);
		expect(calls).toEqual([]);
	});

	it("adds labels without dropping the ones already there", async () => {
		const { channel, calls } = fakeChatwoot({
			"GET /conversations/42/labels": {
				json: { payload: ["whatsapp", "sales"] },
			},
		});

		await channel.perform({
			...key,
			type: "add_labels",
			labels: ["sales", "presupuesto"],
		});

		expect(calls[1]).toMatchObject({
			method: "POST",
			path: "/conversations/42/labels",
			token: "bot-token",
			body: { labels: ["whatsapp", "sales", "presupuesto"] },
		});
	});

	it("merges custom attributes", async () => {
		const { channel, calls } = fakeChatwoot();

		await channel.perform({
			...key,
			type: "set_attributes",
			attributes: { patente: "AB123CD" },
		});

		expect(calls[0]).toMatchObject({
			method: "POST",
			path: "/conversations/42/custom_attributes",
			body: { custom_attributes: { patente: "AB123CD" }, merge: true },
		});
	});

	it("resolves the conversation", async () => {
		const { channel, calls } = fakeChatwoot();

		await channel.perform({ ...key, type: "resolve" });

		expect(calls[0]).toMatchObject({
			path: "/conversations/42/toggle_status",
			body: { status: "resolved" },
		});
	});

	it("throws a ChatwootApiError that says whether a retry can help", async () => {
		const { channel } = fakeChatwoot({
			"POST /conversations/42/messages": {
				status: 503,
				json: { error: "down" },
			},
		});

		const error = await channel
			.perform({ ...key, type: "reply", text: "hola" })
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ChatwootApiError);
		expect(error).toMatchObject({ status: 503, retryable: true });
	});

	it("does not mark a client error as retryable", async () => {
		const { channel } = fakeChatwoot({
			"POST /conversations/42/messages": {
				status: 401,
				json: { error: "nope" },
			},
		});

		const error = await channel
			.perform({ ...key, type: "reply", text: "hola" })
			.catch((e: unknown) => e);

		expect(error).toMatchObject({ status: 401, retryable: false });
	});
});
