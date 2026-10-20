import type { Attachment, Event } from "@backlabs/core";
import { z } from "zod";

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
});
type TelegramMessage = z.infer<typeof TelegramMessage>;

export const Update = z.object({
	update_id: z.number(),
	message: TelegramMessage.optional(),
});
export type Update = z.infer<typeof Update>;

export type UpdateOptions = {
	/** Chat where operators receive notes and handoffs (ADR 0007). */
	operatorChatId: number;
	/** Command an operator sends to give a conversation back. Default "resume". */
	resumeCommand?: string;
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
		return operatorCommand(message, eventId, options.resumeCommand ?? "resume");
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

function operatorCommand(
	message: TelegramMessage,
	eventId: string,
	command: string,
): Event | null {
	const match = message.text?.match(
		new RegExp(`^/${command}(?:@\\w+)?\\s+(\\S+)`),
	);
	if (!match?.[1]) return null;
	return { type: "conversation.resolved", eventId, conversationId: match[1] };
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
