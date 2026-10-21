import type { Attachment, Event, Message } from "@backlabs/core";
import { z } from "zod";
import { conversationIdOf } from "./operator-chat.ts";

// Only the fields we read from https://core.telegram.org/bots/api#update.

const User = z.object({
	id: z.number(),
	is_bot: z.boolean(),
	first_name: z.string(),
	last_name: z.string().optional(),
});

const File = z.object({ file_id: z.string() });

const TelegramMessage = z.object({
	message_id: z.number(),
	date: z.number(),
	chat: z.object({ id: z.number(), type: z.string() }),
	from: User.optional(),
	text: z.string().optional(),
	caption: z.string().optional(),
	contact: z
		.object({ phone_number: z.string(), user_id: z.number().optional() })
		.optional(),
	photo: z.array(File).optional(),
	voice: File.optional(),
	audio: File.optional(),
	video: File.optional(),
	document: File.optional(),
	location: z
		.object({ latitude: z.number(), longitude: z.number() })
		.optional(),
	/** In the operator chat: the bot's message an operator is answering. */
	reply_to_message: z
		.object({
			message_id: z.number(),
			from: User.optional(),
			text: z.string().optional(),
		})
		.optional(),
});
type TelegramMessage = z.infer<typeof TelegramMessage>;

export const Update = z.object({
	update_id: z.number(),
	message: TelegramMessage.optional(),
});
export type Update = z.infer<typeof Update>;

export type UpdateOptions = {
	/**
	 * This bot's user id: the number before the colon in the token
	 * (`botIdFromToken`). A reply in the operator chat is routed only when it
	 * answers a message this bot posted; another bot in the group could
	 * otherwise forge a header and have replies sent to any Telegram user.
	 */
	botId: number;
	/** Chat where operators receive notes and handoffs (ADR 0007). */
	operatorChatId: number;
	/** Command an operator sends to give a conversation back. Default "resume". */
	resumeCommand?: string;
	/** Command an operator replies with to brief the bot. Default "bot". */
	briefCommand?: string;
};

/**
 * Turns an update into a domain event, or null when it is not for the bot:
 * group chats other than the operator chat, other bots, edits, callbacks.
 */
export function toEvent(update: Update, options: UpdateOptions): Event | null {
	const message = update.message;
	if (!message?.from || message.from.is_bot) return null;
	// The update id is stable for a bot: a redelivered update deduplicates.
	const eventId = `telegram:update:${update.update_id}`;

	if (message.chat.id === options.operatorChatId) {
		return fromOperators(message, eventId, options);
	}
	if (message.chat.type !== "private") return null;

	const from = message.from;
	// Telegram proves a number only when users share their own contact.
	const ownPhone =
		message.contact && message.contact.user_id === from.id
			? normalizePhone(message.contact.phone_number)
			: undefined;

	return {
		type: "message.received",
		eventId,
		conversationId: String(message.chat.id),
		contact: {
			id: String(from.id),
			name: [from.first_name, from.last_name].filter(Boolean).join(" "),
			...(ownPhone ? { phone: ownPhone, phoneVerified: true } : {}),
		},
		message: {
			id: String(message.message_id),
			author: "customer",
			text: message.text ?? message.caption ?? "",
			attachments: attachmentsOf(message),
			private: false,
			sentAt: new Date(message.date * 1000).toISOString(),
		},
	};
}

/**
 * The operator chat (ADR 0007): `/resume <id>` gives a conversation back to
 * the bot. A reply to one of the bot's notes or handoffs is routed to the
 * conversation named in that message's first line: plain text is relayed to
 * the customer, `/bot <facts>` briefs the bot. Anything else is chatter.
 */
function fromOperators(
	message: TelegramMessage,
	eventId: string,
	options: UpdateOptions,
): Event | null {
	const text = message.text ?? "";

	const resume = argumentOf(text, options.resumeCommand ?? "resume");
	if (resume !== null) {
		const conversationId = resume.split(/\s/, 1)[0];
		return conversationId
			? { type: "conversation.resolved", eventId, conversationId }
			: null;
	}

	const replied = message.reply_to_message;
	if (!replied?.from?.is_bot || replied.from.id !== options.botId) return null;
	const conversationId = conversationIdOf(replied.text);
	if (!conversationId) return null;

	const brief = argumentOf(text, options.briefCommand ?? "bot");
	if (brief !== null) {
		if (!brief) return null;
		return {
			type: "human.briefed",
			eventId,
			conversationId,
			// The customer never sees a brief.
			message: humanMessage(message, brief, true),
		};
	}

	// Other commands and non-text messages are not meant for the customer.
	if (!text.trim() || text.startsWith("/")) return null;
	return {
		type: "human.replied",
		eventId,
		conversationId,
		message: humanMessage(message, text, false),
	};
}

/** Text after `/command` or `/command@bot`, trimmed; null for other messages. */
function argumentOf(text: string, command: string): string | null {
	const match = new RegExp(`^/${command}(?:@\\w+)?(?:\\s+([\\s\\S]*))?$`).exec(
		text,
	);
	return match ? (match[1] ?? "").trim() : null;
}

function humanMessage(
	message: TelegramMessage,
	text: string,
	isPrivate: boolean,
): Message {
	return {
		// The operator's own message: a failed relay is reported as a reply to it.
		id: String(message.message_id),
		author: "human",
		text,
		attachments: [],
		private: isPrivate,
		sentAt: new Date(message.date * 1000).toISOString(),
	};
}

function attachmentsOf(message: TelegramMessage): Attachment[] {
	const file = (
		kind: Attachment["kind"],
		f: { file_id: string } | undefined,
	) => (f ? [{ kind, url: `telegram:file:${f.file_id}` }] : []);

	return [
		// Telegram sends every size of a photo; the last one is the largest.
		...file("image", message.photo?.at(-1)),
		...file("audio", message.voice ?? message.audio),
		...file("video", message.video),
		...file("file", message.document),
		...(message.location
			? [
					{
						kind: "location" as const,
						url: `geo:${message.location.latitude},${message.location.longitude}`,
					},
				]
			: []),
	];
}

/** Telegram omits the plus sign on some clients; E.164 keeps comparisons exact. */
function normalizePhone(phone: string): string {
	return `+${phone.replace(/\D/g, "")}`;
}
