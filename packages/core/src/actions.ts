import { z } from "zod";

const base = {
	/**
	 * Unique per intended side effect, derived from the run and the step that
	 * planned it. Re-planning the same step yields the same key, so the outbox
	 * performs the action once.
	 */
	idempotencyKey: z.string().min(1),
	conversationId: z.string().min(1),
};

export const ReplySchema = z.object({
	type: z.literal("reply"),
	...base,
	text: z.string().min(1),
});

export const NoteSchema = z.object({
	type: z.literal("note"),
	...base,
	text: z.string().min(1),
});

export const HandoffSchema = z.object({
	type: z.literal("handoff"),
	...base,
	/** Name of a human team from the client configuration. Omitted: any human. */
	team: z.string().min(1).optional(),
});

export const AddLabelsSchema = z.object({
	type: z.literal("add_labels"),
	...base,
	labels: z.array(z.string().min(1)).min(1),
});

export const SetAttributesSchema = z.object({
	type: z.literal("set_attributes"),
	...base,
	attributes: z.record(
		z.string(),
		z.union([z.string(), z.number(), z.boolean(), z.null()]),
	),
});

export const ResolveSchema = z.object({
	type: z.literal("resolve"),
	...base,
});

export const ActionSchema = z.discriminatedUnion("type", [
	ReplySchema,
	NoteSchema,
	HandoffSchema,
	AddLabelsSchema,
	SetAttributesSchema,
	ResolveSchema,
]);
export type Action = z.infer<typeof ActionSchema>;
export type ActionType = Action["type"];
