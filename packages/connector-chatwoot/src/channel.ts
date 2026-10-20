import type {
	Action,
	ActionResult,
	ChannelPort,
	Message,
} from "@backlabs/core";
import { z } from "zod";
import {
	CreatedMessage,
	LabelList,
	MessageList,
	outgoingAuthor,
	toMessage,
} from "./payloads.ts";

export type ChatwootChannelOptions = {
	/** e.g. https://chat.example.com */
	baseUrl: string;
	accountId: number;
	/** Agent Bot access token. Everything the bot writes is sent as the bot. */
	botToken: string;
	/**
	 * A user access token, used only to read history: Chatwoot does not let bot
	 * tokens list messages (AccessTokenAuthHelper::BOT_ACCESSIBLE_ENDPOINTS).
	 * Writes never use it, or the bot's replies would look like a human's.
	 */
	readToken: string;
	/** Team names used in handoff actions, mapped to Chatwoot team ids. */
	teams?: Readonly<Record<string, number>>;
	fetch?: typeof fetch;
};

export class ChatwootApiError extends Error {
	readonly status: number;
	readonly path: string;

	constructor(status: number, path: string, body: string) {
		super(`Chatwoot answered ${status} on ${path}: ${body.slice(0, 200)}`);
		this.name = "ChatwootApiError";
		this.status = status;
		this.path = path;
	}

	/** Rate limits and server errors may pass; anything else will fail again. */
	get retryable(): boolean {
		return this.status === 429 || this.status >= 500;
	}
}

/** Message types of the REST API, from Message.message_type. */
const INCOMING = 0;
const OUTGOING = 1;
const TEMPLATE = 3;

export function chatwootChannel(options: ChatwootChannelOptions): ChannelPort {
	const fetch = options.fetch ?? globalThis.fetch;
	const root = `${options.baseUrl.replace(/\/+$/, "")}/api/v1/accounts/${options.accountId}`;

	async function call<S extends z.ZodType>(
		token: string,
		method: "GET" | "POST",
		path: string,
		body: unknown,
		schema: S,
	): Promise<z.infer<S>> {
		const response = await fetch(`${root}${path}`, {
			method,
			headers: {
				api_access_token: token,
				accept: "application/json",
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		const text = await response.text();
		if (!response.ok) throw new ChatwootApiError(response.status, path, text);

		return schema.parse(text ? JSON.parse(text) : null);
	}

	const conversation = (id: string) =>
		`/conversations/${encodeURIComponent(id)}`;
	/** For responses we do not read. */
	const ignored = z.unknown();
	const write = <S extends z.ZodType>(path: string, body: unknown, schema: S) =>
		call(options.botToken, "POST", path, body, schema);

	return {
		async history(conversationId): Promise<Message[]> {
			// The latest page Chatwoot returns (20 messages), which is the context
			// a reply needs. Activity messages ("Ana joined") are not conversation.
			const { payload } = await call(
				options.readToken,
				"GET",
				`${conversation(conversationId)}/messages`,
				undefined,
				MessageList,
			);

			return payload
				.filter((m) => [INCOMING, OUTGOING, TEMPLATE].includes(m.message_type))
				.sort((a, b) => a.created_at.localeCompare(b.created_at))
				.map((m) =>
					toMessage(
						m,
						m.message_type === INCOMING ? "customer" : outgoingAuthor(m.sender),
					),
				);
		},

		async perform(action: Action): Promise<ActionResult> {
			const path = conversation(action.conversationId);

			switch (action.type) {
				// Chatwoot has no "share your number" button; on WhatsApp the number
				// is already verified, elsewhere the text is all we can send.
				case "request_phone":
				case "reply":
				case "note": {
					const created = await write(
						`${path}/messages`,
						{
							content: action.text,
							message_type: "outgoing",
							private: action.type === "note",
						},
						CreatedMessage,
					);
					return { externalId: String(created.id) };
				}

				case "handoff": {
					if (action.team !== undefined) {
						const teamId = options.teams?.[action.team];
						if (teamId === undefined) {
							throw new Error(
								`Unknown team "${action.team}". Known teams: ${Object.keys(options.teams ?? {}).join(", ") || "none"}.`,
							);
						}
						await write(`${path}/assignments`, { team_id: teamId }, ignored);
					}
					// pending → open is how an Agent Bot hands a conversation to humans.
					await write(`${path}/toggle_status`, { status: "open" }, ignored);
					return {};
				}

				case "add_labels": {
					// Chatwoot replaces the whole list, so read it first.
					const current = await call(
						options.botToken,
						"GET",
						`${path}/labels`,
						undefined,
						LabelList,
					);
					const labels = [...new Set([...current.payload, ...action.labels])];
					await write(`${path}/labels`, { labels }, ignored);
					return {};
				}

				case "set_attributes":
					await write(
						`${path}/custom_attributes`,
						{
							custom_attributes: action.attributes,
							merge: true,
						},
						ignored,
					);
					return {};

				case "resolve":
					await write(`${path}/toggle_status`, { status: "resolved" }, ignored);
					return {};
			}
		},
	};
}
