import { randomUUID } from "node:crypto";
import type { Contact, Event, Message } from "@backlabs/core";
import pg from "pg";
import { migrate } from "../src/index.ts";

/** Tests that need Postgres are skipped, not faked, without this variable. */
export const DATABASE_URL = process.env.TEST_DATABASE_URL;

export type TestDatabase = {
	pool: pg.Pool;
	schema: string;
	url: string;
	close(): Promise<void>;
};

/** A fresh schema per call, so test files never see each other's rows. */
export async function testDatabase(): Promise<TestDatabase> {
	if (!DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
	const schema = `t_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

	const admin = new pg.Client({ connectionString: DATABASE_URL });
	await admin.connect();
	await admin.query(`create schema ${schema}`);
	await admin.end();

	const pool = new pg.Pool({
		connectionString: DATABASE_URL,
		options: `-c search_path=${schema}`,
	});
	await migrate(pool);

	return {
		pool,
		schema,
		url: DATABASE_URL,
		async close() {
			await pool.query(`drop schema ${schema} cascade`);
			await pool.end();
		},
	};
}

let sequence = 0;

export function customerMessage(
	text: string,
	overrides: Partial<Message> = {},
): Message {
	sequence += 1;
	return {
		id: `m${sequence}`,
		author: "customer",
		text,
		attachments: [],
		private: false,
		sentAt: new Date(Date.UTC(2026, 9, 20, 12, 0, sequence)).toISOString(),
		...overrides,
	};
}

export const unverifiedContact: Contact = { id: "c1", name: "Ana" };
export const verifiedContact: Contact = {
	id: "c1",
	name: "Ana",
	phone: "+5491100000001",
	phoneVerified: true,
};

export function received(
	text: string,
	options: {
		conversationId?: string;
		contact?: Contact;
		eventId?: string;
	} = {},
): Event {
	const message = customerMessage(text);
	return {
		type: "message.received",
		eventId: options.eventId ?? `evt-${message.id}`,
		conversationId: options.conversationId ?? "conv-1",
		contact: options.contact ?? unverifiedContact,
		message,
	};
}

export function resolved(conversationId = "conv-1"): Event {
	return {
		type: "conversation.resolved",
		eventId: `resolved-${randomUUID()}`,
		conversationId,
	};
}

export function takenOver(conversationId = "conv-1"): Event {
	return {
		type: "conversation.taken_over",
		eventId: `taken-over-${randomUUID()}`,
		conversationId,
	};
}

export function handedBack(conversationId = "conv-1"): Event {
	return {
		type: "conversation.handed_back",
		eventId: `handed-back-${randomUUID()}`,
		conversationId,
	};
}

export function humanReplied(text: string, conversationId = "conv-1"): Event {
	return {
		type: "human.replied",
		eventId: `human-${randomUUID()}`,
		conversationId,
		message: customerMessage(text, { author: "human" }),
	};
}

export function humanBriefed(text: string, conversationId = "conv-1"): Event {
	return {
		type: "human.briefed",
		eventId: `brief-${randomUUID()}`,
		conversationId,
		message: customerMessage(text, { author: "human", private: true }),
	};
}
