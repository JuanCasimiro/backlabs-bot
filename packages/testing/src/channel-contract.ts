import { randomUUID } from "node:crypto";
import type { ChannelPort } from "@backlabs/core";
import { describe, expect, it } from "vitest";

export type ChannelFixture = {
	channel: ChannelPort;
	/** An existing conversation the suite may write to. */
	conversationId: string;
};

/**
 * The behaviour every ChannelPort must have. Run it against your adapter and
 * against InMemoryChannel: if both pass, tests written against the in-memory
 * channel say something true about the real one.
 */
export function channelContract(
	name: string,
	setup: () => Promise<ChannelFixture>,
	options: { skip?: boolean } = {},
): void {
	describe.skipIf(options.skip ?? false)(
		`ChannelPort contract: ${name}`,
		() => {
			it("a reply shows up in history as a public message from the bot", async () => {
				const { channel, conversationId } = await setup();
				const text = `contract reply ${randomUUID()}`;

				const result = await channel.perform({
					type: "reply",
					idempotencyKey: randomUUID(),
					conversationId,
					text,
				});

				const message = (await channel.history(conversationId)).find(
					(m) => m.text === text,
				);
				expect(message).toMatchObject({ author: "bot", private: false });
				expect(result.externalId).toBe(message?.id);
			});

			it("a note shows up in history as a private message from the bot", async () => {
				const { channel, conversationId } = await setup();
				const text = `contract note ${randomUUID()}`;

				await channel.perform({
					type: "note",
					idempotencyKey: randomUUID(),
					conversationId,
					text,
				});

				const message = (await channel.history(conversationId)).find(
					(m) => m.text === text,
				);
				expect(message).toMatchObject({ author: "bot", private: true });
			});

			it("a phone request reaches the customer as a public message from the bot", async () => {
				const { channel, conversationId } = await setup();
				const text = `contract phone request ${randomUUID()}`;

				await channel.perform({
					type: "request_phone",
					idempotencyKey: randomUUID(),
					conversationId,
					text,
				});

				const message = (await channel.history(conversationId)).find(
					(m) => m.text === text,
				);
				expect(message).toMatchObject({ author: "bot", private: false });
			});

			it("history is oldest first", async () => {
				const { channel, conversationId } = await setup();
				for (const n of [1, 2]) {
					await channel.perform({
						type: "reply",
						idempotencyKey: randomUUID(),
						conversationId,
						text: `contract order ${n} ${randomUUID()}`,
					});
				}

				const sentAt = (await channel.history(conversationId)).map(
					(m) => m.sentAt,
				);
				expect(sentAt).toEqual([...sentAt].sort());
			});

			it("adding labels twice is harmless", async () => {
				const { channel, conversationId } = await setup();
				const add = () =>
					channel.perform({
						type: "add_labels",
						idempotencyKey: randomUUID(),
						conversationId,
						labels: ["contract"],
					});

				await add();
				await expect(add()).resolves.toBeDefined();
			});
		},
	);
}
