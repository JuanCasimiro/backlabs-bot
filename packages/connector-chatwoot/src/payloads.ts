import type { Attachment, Author, Message } from "@backlabs/core";
import { z } from "zod";

// Only the fields we read. Chatwoot sends many more; zod drops them.

/** Webhooks send ISO strings, the REST API sends Unix seconds. */
const Timestamp = z.union([z.string(), z.number()]).transform((value, ctx) => {
	const date =
		typeof value === "number" ? new Date(value * 1000) : new Date(value);
	if (Number.isNaN(date.getTime())) {
		ctx.issues.push({ code: "custom", message: "invalid date", input: value });
		return z.NEVER;
	}
	return date.toISOString();
});

export const SenderPayload = z.object({
	id: z.number(),
	name: z.string().nullish(),
	email: z.string().nullish(),
	phone_number: z.string().nullish(),
	/** "user" or "agent_bot". Contacts carry no type in webhooks. */
	type: z.string().nullish(),
});

const AttachmentPayload = z.object({
	file_type: z.string(),
	data_url: z.string().nullish(),
});

const MessageFields = {
	id: z.number(),
	content: z.string().nullish(),
	private: z.boolean().nullish(),
	created_at: Timestamp,
	sender: SenderPayload.nullish(),
	attachments: z.array(AttachmentPayload).nullish(),
};

/** Message#webhook_data, `message_type` as a name. */
export const MessageCreatedPayload = z.object({
	event: z.literal("message_created"),
	...MessageFields,
	message_type: z.enum(["incoming", "outgoing", "activity", "template"]),
	conversation: z.object({
		id: z.number(),
		/** Inbox channel type, e.g. "Channel::Whatsapp". */
		channel: z.string().nullish(),
	}),
});
export type MessageCreatedPayload = z.infer<typeof MessageCreatedPayload>;

/** Conversation#webhook_data. `id` is the display id the API uses. */
export const ConversationResolvedPayload = z.object({
	event: z.literal("conversation_resolved"),
	id: z.number(),
	updated_at: z.number().nullish(),
});

/** Conversation#webhook_data with the status it changed to. */
export const ConversationStatusChangedPayload = z.object({
	event: z.literal("conversation_status_changed"),
	id: z.number(),
	status: z.string(),
	updated_at: z.number().nullish(),
});

/** api/v1/models/_message.json.jbuilder, `message_type` as a number. */
export const ApiMessage = z.object({
	...MessageFields,
	message_type: z.number(),
});
export type ApiMessage = z.infer<typeof ApiMessage>;

export const MessageList = z.object({ payload: z.array(ApiMessage) });
export const LabelList = z.object({ payload: z.array(z.string()) });
export const CreatedMessage = z.object({ id: z.number() });

const ATTACHMENT_KINDS = new Set<string>([
	"image",
	"audio",
	"video",
	"file",
	"location",
]);

export function toAttachments(
	attachments: z.infer<typeof AttachmentPayload>[] | null | undefined,
): Attachment[] {
	return (attachments ?? []).map((a) => ({
		kind: ATTACHMENT_KINDS.has(a.file_type)
			? (a.file_type as Attachment["kind"])
			: "other",
		url: a.data_url ?? "",
	}));
}

export function toMessage(
	payload: {
		id: number;
		content?: string | null;
		private?: boolean | null;
		created_at: string;
		attachments?: z.infer<typeof AttachmentPayload>[] | null;
	},
	author: Author,
): Message {
	return {
		id: String(payload.id),
		author,
		text: payload.content ?? "",
		attachments: toAttachments(payload.attachments),
		private: payload.private ?? false,
		sentAt: payload.created_at,
	};
}

/** Outgoing messages are the bot's unless a human user sent them. */
export function outgoingAuthor(
	sender: z.infer<typeof SenderPayload> | null | undefined,
): Author {
	return sender?.type === "user" ? "human" : "bot";
}
