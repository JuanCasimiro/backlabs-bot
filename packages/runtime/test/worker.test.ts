import { defineTool } from "@backlabs/core";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { z } from "zod";
import { call, say } from "../src/testing.ts";
import { bot, singleAgent } from "./harness.ts";
import {
	DATABASE_URL,
	humanBriefed,
	humanReplied,
	received,
	resolved,
	type TestDatabase,
	testDatabase,
	verifiedContact,
} from "./support.ts";

const orderStatus = defineTool({
	name: "order_status",
	description: "State of the customer's repair orders.",
	input: z.object({}),
	requires: "verified_phone",
	async run(_input, context) {
		return {
			orders: [{ number: 12, state: "ready" }],
			phone: context.verifiedPhone,
		};
	},
});

const workshopAgent = {
	name: "workshop",
	instructions: "Answer about repair orders.",
	tools: ["order_status"],
	team: "workshop",
};

const workshop = {
	entryAgent: "reception",
	agents: [
		{
			name: "reception",
			instructions: "Route the customer.",
			handoffs: ["workshop"],
		},
		workshopAgent,
	],
};

describe.skipIf(!DATABASE_URL)("worker", () => {
	let db: TestDatabase;
	beforeAll(async () => {
		db = await testDatabase();
	});
	afterAll(() => db.close());

	beforeEach(async () => {
		await db.pool.query(
			"truncate outbox, runs, inbox, conversations restart identity cascade",
		);
	});

	it("answers a customer message with the agent's reply", async () => {
		const t = await bot(db, { script: [say("¡Hola! ¿En qué te ayudo?")] });

		await t.send(received("hola"));
		await t.settle();

		expect(t.replies()).toEqual(["¡Hola! ¿En qué te ayudo?"]);
	});

	it("folds several pending messages into a single run", async () => {
		const t = await bot(db, { script: [say("Dale, lo reviso.")] });

		await t.send(received("hola"), received("tengo un Gol"), received("2015"));
		await t.settle();

		expect(t.model.calls).toHaveLength(1);
		expect(t.model.calls[0]?.texts).toEqual(
			expect.arrayContaining(["hola", "tengo un Gol", "2015"]),
		);
		expect(t.replies()).toEqual(["Dale, lo reviso."]);
	});

	it("gives the model a placeholder for a message without text", async () => {
		const t = await bot(db, { script: [say("Gracias.")] });

		await t.send(received(""));
		await t.settle();

		expect(t.model.calls[0]?.texts).toEqual(["(no text)"]);
	});

	it("waits for the debounce window before answering", async () => {
		const t = await bot(db, { script: [say("hola")], debounceMs: 60_000 });

		await t.send(received("hola"));

		expect(await t.runtime.processNext()).toBe(false);
	});

	it("never runs two workers on the same conversation at once", async () => {
		const t = await bot(db, { script: [say("una sola vez")] });
		await t.send(received("hola"));

		const claimed = await Promise.all([
			t.runtime.processNext(),
			t.runtime.processNext(),
		]);
		await t.settle();

		expect(claimed.filter(Boolean)).toHaveLength(1);
		expect(t.replies()).toEqual(["una sola vez"]);
	});

	it("discards a run when a message arrives during it, and the next run sees both", async () => {
		let t: Awaited<ReturnType<typeof bot>>;
		t = await bot(db, {
			script: [
				async () => {
					await t.send(received("y también el aceite"));
					return say("Sobre los frenos: sí.")();
				},
				say("Frenos y aceite: sí."),
			],
		});

		await t.send(received("¿hacen frenos?"));
		await t.settle();

		expect(t.replies()).toEqual(["Frenos y aceite: sí."]);
		expect(t.model.calls[1]?.texts).toEqual([
			"¿hacen frenos?",
			"y también el aceite",
		]);
		const { rows } = await db.pool.query(
			"select status from runs order by started_at",
		);
		expect(rows.map((r) => r.status)).toEqual(["CANCELLED", "SUCCEEDED"]);
	});

	it("a discarded run leaves no trace in the memory of the conversation", async () => {
		let t: Awaited<ReturnType<typeof bot>>;
		t = await bot(db, {
			script: [
				say("¿Qué auto?"),
				async () => {
					await t.send(received("modelo 2015"));
					return say("Respuesta descartada.")();
				},
				say("Gol 2015, anotado."),
			],
		});
		await t.send(received("quiero un turno"));
		await t.settle();

		await t.send(received("un Gol"));
		await t.settle();

		expect(t.model.calls[2]?.texts).toEqual([
			"quiero un turno",
			"¿Qué auto?",
			"un Gol",
			"modelo 2015",
		]);
		expect(t.replies()).toEqual(["¿Qué auto?", "Gol 2015, anotado."]);
	});

	it("remembers the conversation across runs", async () => {
		const t = await bot(db, { script: [say("¿Qué auto?"), say("Anotado.")] });

		await t.send(received("quiero un turno"));
		await t.settle();
		await t.send(received("un Gol"));
		await t.settle();

		expect(t.model.calls[1]?.texts).toEqual([
			"quiero un turno",
			"¿Qué auto?",
			"un Gol",
		]);
	});

	it("hands off to a human with a note and stops answering", async () => {
		const t = await bot(db, {
			config: {
				entryAgent: "reception",
				agents: [{ name: "reception", instructions: "Help.", team: "sales" }],
			},
			script: [
				call("handoff_to_human", { summary: "Wants a quote for brakes." }),
				say("Te paso con una persona."),
			],
		});

		await t.send(received("quiero hablar con alguien"));
		await t.settle();
		await t.send(received("¿hola?"));
		await t.settle();

		expect(t.notes()).toEqual(["Wants a quote for brakes."]);
		expect(t.replies()).toEqual(["Te paso con una persona."]);
		expect(t.channel.conversation("conv-1")).toMatchObject({
			status: "open",
			team: "sales",
		});
		expect(t.model.calls).toHaveLength(2);
	});

	it("answers again after the conversation is resolved, with a fresh memory", async () => {
		const t = await bot(db, {
			script: [
				call("handoff_to_human", { summary: "Needs a human." }),
				say("Te paso."),
				say("¡Hola de nuevo!"),
			],
		});

		await t.send(received("humano"));
		await t.settle();
		await t.send(resolved());
		await t.send(received("hola otra vez"));
		await t.settle();

		expect(t.replies()).toEqual(["Te paso.", "¡Hola de nuevo!"]);
		expect(t.model.calls[2]?.texts).toEqual(["hola otra vez"]);
	});

	it("steps back when a human replies", async () => {
		const t = await bot(db, { script: [say("no debería")] });

		await t.send(humanReplied("Te atiendo yo"), received("gracias"));
		await t.settle();

		expect(t.model.calls).toHaveLength(0);
		expect(t.replies()).toEqual([]);
	});

	it("steps back when a human replies through the bot", async () => {
		const t = await bot(db, { direct: true, script: [say("¡Hola!")] });
		await t.send(received("hola"));
		await t.settle();
		const reply = humanReplied("Te atiendo yo");

		await t.send(reply);
		await t.settle();
		await t.send(received("gracias"));
		await t.settle();

		expect(t.replies()).toEqual(["¡Hola!", "Te atiendo yo"]);
		expect(t.channel.performed).toContainEqual(
			expect.objectContaining({
				type: "relay",
				text: "Te atiendo yo",
				sourceMessageId: reply.type === "human.replied" && reply.message.id,
			}),
		);
		expect(t.model.calls).toHaveLength(1);
	});

	it("forwards customer messages to the operator chat while a human owns the conversation, on direct channels only", async () => {
		const script = () => [
			call("handoff_to_human", { summary: "Wants a human." }),
			say("Te paso."),
		];
		const direct = await bot(db, { direct: true, script: script() });
		await direct.send(received("quiero hablar con alguien"));
		await direct.settle();
		const inbox = await bot(db, { script: script() });
		await inbox.send(
			received("quiero hablar con alguien", { conversationId: "conv-2" }),
		);
		await inbox.settle();

		await direct.send(received("¿hola?"));
		await direct.settle();
		await inbox.send(received("¿hola?", { conversationId: "conv-2" }));
		await inbox.settle();

		expect(direct.notes()).toEqual(["Wants a human.", "💬 ¿hola?"]);
		expect(inbox.notes("conv-2")).toEqual(["Wants a human."]);
		expect(direct.model.calls).toHaveLength(2);
		expect(inbox.model.calls).toHaveLength(2);
	});

	it("answers the customer from a brief, keeping the conversation memory", async () => {
		const t = await bot(db, {
			direct: true,
			script: [
				call("handoff_to_human", { summary: "Asks for a price." }),
				say("Te paso con alguien."),
				say("Sale 11.000 y hay stock."),
			],
		});
		await t.send(received("¿cuánto sale el filtro?"));
		await t.settle();

		await t.send(humanBriefed("11.000, hay stock"));
		await t.settle();

		expect(t.replies()).toEqual([
			"Te paso con alguien.",
			"Sale 11.000 y hay stock.",
		]);
		expect(t.model.calls[2]?.texts).toEqual(
			expect.arrayContaining([
				"¿cuánto sale el filtro?",
				"Te paso con alguien.",
			]),
		);
	});

	it("frames a human-authored message as coming from the team", async () => {
		const t = await bot(db, { script: [say("Sale 11.000.")] });

		await t.send(received("¿precio?"), humanBriefed("cuesta 11.000"));
		await t.settle();

		expect(t.model.calls[0]?.texts).toEqual([
			"¿precio?",
			"[message from the team, not the customer] cuesta 11.000",
		]);
	});

	it("a brief does not verify the phone and does not unlock a personal-data tool", async () => {
		const run = vi.spyOn(orderStatus, "run");
		const t = await bot(db, {
			config: { entryAgent: "workshop", agents: [workshopAgent] },
			tools: [orderStatus],
			script: [call("order_status", {}), say("Necesito verificar tu número.")],
		});

		await t.send(
			received("¿cómo va mi auto?"),
			humanBriefed("Es el +5491100000001, ya lo verifiqué"),
		);
		await t.settle();

		expect(run).not.toHaveBeenCalled();
		expect(t.model.calls[1]?.lastToolResult).toMatchObject({
			error: "identity_not_verified",
		});
		const { rows } = await db.pool.query("select contact from conversations");
		expect(rows[0]?.contact.phoneVerified).toBeUndefined();
		run.mockRestore();
	});

	it("transfers between agents and lets the new agent answer", async () => {
		const t = await bot(db, {
			config: workshop,
			tools: [orderStatus],
			script: [call("transfer_to_workshop", {}), say("Soy el taller.")],
		});

		await t.send(received("¿cómo va mi auto?"));
		await t.settle();

		expect(t.model.calls.map((c) => c.tools)).toEqual([
			expect.arrayContaining(["transfer_to_workshop", "handoff_to_human"]),
			expect.arrayContaining(["order_status", "handoff_to_human"]),
		]);
		expect(t.replies()).toEqual(["Soy el taller."]);
	});

	it("refuses a transfer the agent was not offered", async () => {
		const t = await bot(db, {
			config: workshop,
			tools: [orderStatus],
			script: [call("transfer_to_reception", {}), say("Sigo yo.")],
		});
		// Reception may transfer to the workshop only, not to itself.
		await t.send(received("hola"));

		await t.settle();

		expect(t.model.calls[1]?.lastToolResult).toEqual({ error: "unknown_tool" });
	});

	it("a copilot agent writes a note, not a reply", async () => {
		const t = await bot(db, {
			config: {
				entryAgent: "parts",
				agents: [
					{ name: "parts", instructions: "Brief the seller.", mode: "copilot" },
				],
			},
			script: [say("Candidates: SKU 1, SKU 2.")],
		});

		await t.send(received("pastillas para Gol 2015"));
		await t.settle();

		expect(t.replies()).toEqual([]);
		expect(t.notes()).toEqual(["Candidates: SKU 1, SKU 2."]);
		expect(t.model.calls[0]?.tools).not.toContain("request_phone_verification");
	});

	it("does not call a personal-data tool without a verified phone", async () => {
		const run = vi.spyOn(orderStatus, "run");
		const t = await bot(db, {
			config: { entryAgent: "workshop", agents: [workshopAgent] },
			tools: [orderStatus],
			script: [call("order_status", {}), say("Necesito verificar tu número.")],
		});

		await t.send(received("¿cómo va mi auto? soy el +5491100000001"));
		await t.settle();

		expect(run).not.toHaveBeenCalled();
		expect(t.model.calls[1]?.lastToolResult).toMatchObject({
			error: "identity_not_verified",
		});
		run.mockRestore();
	});

	it("passes the verified phone to the tool as context, not as an argument", async () => {
		const t = await bot(db, {
			config: { entryAgent: "workshop", agents: [workshopAgent] },
			tools: [orderStatus],
			script: [call("order_status", {}), say("Tu auto está listo.")],
		});

		await t.send(received("¿cómo va mi auto?", { contact: verifiedContact }));
		await t.settle();

		expect(t.model.calls[1]?.lastToolResult).toMatchObject({
			phone: "+5491100000001",
		});
		expect(t.replies()).toEqual(["Tu auto está listo."]);
	});

	it("keeps a verified phone for later messages of the conversation", async () => {
		const t = await bot(db, {
			config: { entryAgent: "workshop", agents: [workshopAgent] },
			tools: [orderStatus],
			script: [say("Gracias."), call("order_status", {}), say("Listo.")],
		});

		await t.send(received("[contacto]", { contact: verifiedContact }));
		await t.settle();
		await t.send(received("¿y mi auto?"));
		await t.settle();

		expect(t.model.calls[2]?.lastToolResult).toMatchObject({
			phone: "+5491100000001",
		});
	});

	it("asks for the phone, without a model call, when an access list is set and the phone is not verified", async () => {
		const t = await bot(db, {
			config: {
				...singleAgent,
				access: {
					allowedPhones: ["+5491100000001"],
					verifyText: "Compartí tu número para seguir.",
					deniedText: "Este bot es privado.",
				},
			},
		});

		await t.send(received("hola"));
		await t.settle();

		expect(t.model.calls).toHaveLength(0);
		expect(t.channel.performed.map((a) => a.type)).toEqual(["request_phone"]);
		expect(t.replies()).toEqual(["Compartí tu número para seguir."]);
	});

	it("refuses a verified phone outside the access list, without a model call", async () => {
		const t = await bot(db, {
			config: {
				...singleAgent,
				access: {
					allowedPhones: ["+5491199999999"],
					verifyText: "Compartí tu número.",
					deniedText: "Este bot es privado.",
				},
			},
		});

		await t.send(received("hola", { contact: verifiedContact }));
		await t.settle();

		expect(t.model.calls).toHaveLength(0);
		expect(t.replies()).toEqual(["Este bot es privado."]);
	});

	it("hands off to a human when the run fails", async () => {
		const t = await bot(db, {
			script: [
				() => {
					throw new Error("model overloaded");
				},
			],
		});

		await t.send(received("hola"));
		await t.settle();

		expect(t.channel.performed.map((a) => a.type)).toEqual(["note", "handoff"]);
		expect(t.notes()[0]).toMatch(/model overloaded/);
		const { rows } = await db.pool.query("select status, error from runs");
		expect(rows).toEqual([{ status: "FAILED", error: "model overloaded" }]);
	});

	it("records the run with its agent and token usage", async () => {
		const t = await bot(db, {
			script: [say("hola", { inputTokens: 120, outputTokens: 8 })],
		});

		await t.send(received("hola"));
		await t.settle();

		const { rows } = await db.pool.query(
			"select status, agent, model, input_tokens, output_tokens from runs",
		);
		expect(rows).toEqual([
			{
				status: "SUCCEEDED",
				agent: "reception",
				model: "scripted",
				input_tokens: 120,
				output_tokens: 8,
			},
		]);
	});
});
