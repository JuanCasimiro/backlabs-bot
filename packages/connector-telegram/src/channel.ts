import type {
	Action,
	ActionResult,
	Author,
	ChannelPort,
	Message,
} from "@backlabs/core";
import { z } from "zod";
import { botApi, TelegramApiError } from "./api.ts";
import { escapeHtml, operatorHeader } from "./operator-chat.ts";

/**
 * What operators read, as Telegram HTML. `{name}` placeholders are filled with
 * escaped values. The first line of every operator message (the conversation
 * id, which replies are routed by) is fixed and not part of these texts.
 */
export type OperatorTexts = {
	/** Placeholders: `{id}`, `{team}` (" (name)" or empty), `{brief}`, `{resume}`. */
	handoff: string;
	/** Placeholder: `{text}`, the note itself. */
	note: string;
	/** Placeholder: `{error}`, what Telegram answered. */
	deliveryFailed: string;
};

export const defaultOperatorTexts: OperatorTexts = {
	handoff:
		"Needs a human{team}. Reply to this message to answer the customer, or reply with <code>/{brief} …</code> to tell the bot what to answer. Send <code>/{resume} {id}</code> to give the conversation back to the bot.",
	note: "{text}",
	deliveryFailed: "Your reply did not reach the customer: {error}",
};

export type TelegramChannelOptions = {
	token: string;
	/** Chat (usually a group) where notes and handoffs go (ADR 0007). */
	operatorChatId: number;
	/** Label of the share-contact button. */
	shareButtonText: string;
	/** Must match the inbound option. Default "resume". */
	resumeCommand?: string;
	/** Must match the inbound option. Default "bot". */
	briefCommand?: string;
	/** Operator chats are usually in the client's language. Defaults in English. */
	texts?: Partial<OperatorTexts>;
	fetch?: typeof fetch;
	baseUrl?: string;
};

const SentMessage = z.object({ message_id: z.number(), date: z.number() });

/**
 * Telegram as a direct channel: there is no inbox behind it, so what humans
 * must see goes to an operator chat, and what they answer there is relayed
 * through the bot. `history` returns what this process sent; the runtime
 * keeps the conversation itself in its checkpoints.
 */
export function telegramChannel(options: TelegramChannelOptions): ChannelPort {
	const call = botApi(options);
	const texts = { ...defaultOperatorTexts, ...options.texts };
	const commands = {
		resume: options.resumeCommand ?? "resume",
		brief: options.briefCommand ?? "bot",
	};
	const sent = new Map<string, Message[]>();

	async function send(
		conversationId: string,
		chatId: string | number,
		body: Record<string, unknown>,
		record: { text: string; author: Author; isPrivate: boolean },
	): Promise<ActionResult> {
		const message = await call(
			"sendMessage",
			{ chat_id: chatId, ...body },
			SentMessage,
		);
		const id = String(message.message_id);
		const transcript = sent.get(conversationId) ?? [];
		transcript.push({
			id,
			author: record.author,
			text: record.text,
			attachments: [],
			private: record.isPrivate,
			sentAt: new Date().toISOString(),
		});
		sent.set(conversationId, transcript);
		return { externalId: id };
	}

	const toCustomer = (
		conversationId: string,
		body: Record<string, unknown> & { text: string },
		author: Author = "bot",
	) =>
		send(conversationId, conversationId, body, {
			text: body.text,
			author,
			isPrivate: false,
		});

	const toOperators = (
		conversationId: string,
		html: string,
		text: string,
		extra: Record<string, unknown> = {},
	) =>
		send(
			conversationId,
			options.operatorChatId,
			{ text: html, parse_mode: "HTML", ...extra },
			{ text, author: "bot", isPrivate: true },
		);

	return {
		direct: true,

		async history(conversationId) {
			return [...(sent.get(conversationId) ?? [])];
		},

		async perform(action: Action): Promise<ActionResult> {
			const id = action.conversationId;
			switch (action.type) {
				case "reply":
					return toCustomer(id, {
						text: action.text,
						reply_markup: { remove_keyboard: true },
					});

				case "request_phone":
					return toCustomer(id, {
						text: action.text,
						reply_markup: {
							keyboard: [
								[{ text: options.shareButtonText, request_contact: true }],
							],
							one_time_keyboard: true,
							resize_keyboard: true,
						},
					});

				case "relay":
					try {
						return await toCustomer(id, { text: action.text }, "human");
					} catch (error) {
						// A retry may still deliver it: report only what will not.
						if (error instanceof TelegramApiError && error.retryable) {
							throw error;
						}
						await toOperators(
							id,
							operatorHeader("failed", id) +
								fill(texts.deliveryFailed, { error: errorText(error) }),
							"delivery failed",
							{
								reply_parameters: {
									message_id: Number(action.sourceMessageId),
									allow_sending_without_reply: true,
								},
							},
						);
						throw error;
					}

				case "note":
					return toOperators(
						id,
						operatorHeader("note", id) +
							fill(texts.note, { text: action.text }),
						action.text,
					);

				case "handoff": {
					const team = action.team ? ` (${action.team})` : "";
					return toOperators(
						id,
						operatorHeader("handoff", id) +
							fill(texts.handoff, { id, team, ...commands }),
						`handoff${team}`,
					);
				}

				// No inbox: labels, attributes and resolution have nothing to show.
				// The runtime tracks who owns the conversation (ADR 0007).
				case "add_labels":
				case "set_attributes":
				case "resolve":
					return {};
			}
		},
	};
}

/** Replaces `{name}` with the escaped value; unknown placeholders stay. */
function fill(template: string, values: Record<string, string>): string {
	return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
		const value = values[name];
		return value === undefined ? placeholder : escapeHtml(value);
	});
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
