import type {
	Action,
	ActionResult,
	ChannelPort,
	Message,
} from "@backlabs/core";
import { z } from "zod";
import { botApi } from "./api.ts";

export type TelegramChannelOptions = {
	token: string;
	/** Chat (usually a group) where notes and handoffs go (ADR 0007). */
	operatorChatId: number;
	/** Label of the share-contact button. */
	shareButtonText: string;
	/** Must match the inbound option. Default "resume". */
	resumeCommand?: string;
	fetch?: typeof fetch;
	baseUrl?: string;
};

const SentMessage = z.object({ message_id: z.number(), date: z.number() });

/**
 * Telegram as a direct channel: there is no inbox behind it, so what humans
 * must see goes to an operator chat. `history` returns what this process sent;
 * the runtime keeps the conversation itself in its checkpoints.
 */
export function telegramChannel(options: TelegramChannelOptions): ChannelPort {
	const call = botApi(options);
	const resume = options.resumeCommand ?? "resume";
	const sent = new Map<string, Message[]>();

	async function send(
		conversationId: string,
		chatId: string | number,
		body: Record<string, unknown>,
		text: string,
		isPrivate: boolean,
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
			author: "bot",
			text,
			attachments: [],
			private: isPrivate,
			sentAt: new Date().toISOString(),
		});
		sent.set(conversationId, transcript);
		return { externalId: id };
	}

	const toOperators = (conversationId: string, html: string, text: string) =>
		send(
			conversationId,
			options.operatorChatId,
			{ text: html, parse_mode: "HTML" },
			text,
			true,
		);

	return {
		async history(conversationId) {
			return [...(sent.get(conversationId) ?? [])];
		},

		async perform(action: Action): Promise<ActionResult> {
			const id = action.conversationId;
			switch (action.type) {
				case "reply":
					return send(
						id,
						id,
						{ text: action.text, reply_markup: { remove_keyboard: true } },
						action.text,
						false,
					);

				case "request_phone":
					return send(
						id,
						id,
						{
							text: action.text,
							reply_markup: {
								keyboard: [
									[{ text: options.shareButtonText, request_contact: true }],
								],
								one_time_keyboard: true,
								resize_keyboard: true,
							},
						},
						action.text,
						false,
					);

				case "note":
					return toOperators(
						id,
						`📝 <b>${escapeHtml(id)}</b>\n${escapeHtml(action.text)}`,
						action.text,
					);

				case "handoff": {
					const team = action.team ? ` (${escapeHtml(action.team)})` : "";
					return toOperators(
						id,
						`🙋 <a href="tg://user?id=${escapeHtml(id)}">Conversation ${escapeHtml(id)}</a> needs a human${team}.\nAnswer from Telegram, then send <code>/${resume} ${escapeHtml(id)}</code> to give it back to the bot.`,
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

function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
