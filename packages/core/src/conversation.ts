import { z } from "zod";

export const AttachmentSchema = z.object({
	kind: z.enum(["image", "audio", "video", "file", "location", "other"]),
	url: z.string(),
	name: z.string().optional(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const ContactSchema = z.object({
	id: z.string().min(1),
	name: z.string().optional(),
	phone: z.string().optional(),
	/**
	 * True only when the channel itself proves the number belongs to the
	 * customer (WhatsApp sender, a Telegram contact shared by its owner). A
	 * number typed in a message is never verified. See ADR 0006.
	 */
	phoneVerified: z.boolean().optional(),
	email: z.string().optional(),
});
export type Contact = z.infer<typeof ContactSchema>;

/**
 * Who wrote a message, from the bot's point of view: the customer, the bot
 * itself, or a human agent of the business.
 */
export const AuthorSchema = z.enum(["customer", "bot", "human"]);
export type Author = z.infer<typeof AuthorSchema>;

export const MessageSchema = z.object({
	id: z.string().min(1),
	author: AuthorSchema,
	text: z.string(),
	attachments: z.array(AttachmentSchema),
	/** Internal notes are private: humans see them, the customer never does. */
	private: z.boolean(),
	sentAt: z.iso.datetime(),
});
export type Message = z.infer<typeof MessageSchema>;
