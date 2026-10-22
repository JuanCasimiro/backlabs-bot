# Architecture (draft)

Design notes. Decisions with lasting consequences are recorded as ADRs in [`docs/adr/`](adr/).

## 0. Goals

Backlabs Bot is the base we install for each client that needs a conversational agent: a car workshop answering on WhatsApp, a recruiting firm screening candidates against its ATS, and so on. That sets the bar:

- **A new client is configuration and tools, never a fork.** The core does not change per client.
- **Nothing is sent twice, nothing is lost.** Webhooks retry, customers send three messages in a row, processes die mid-run. The customer must still get exactly one coherent answer.
- **Humans stay in control where it matters.** Any action can require approval, and some agents only ever advise.
- **Testable without infrastructure.** The whole agent graph runs in CI against in-memory adapters.

## 1. Shape: hexagonal at the edges, LangGraph in the middle

```
          ┌──────────────── inbound adapters ────────────────┐
          │  Chatwoot webhook · ATS webhook · scheduler · CLI │
          └────────────────────────┬─────────────────────────┘
                                   │ normalized events → inbox table
                                   ▼
 ┌───────────────────── application (LangGraph) ─────────────────────┐
 │  agent graph · handoffs · interrupt() for approvals · checkpoints │
 │                          calls ▼ ports                             │
 │  ┌────────────────────────── domain ──────────────────────────┐   │
 │  │ Event, Action, Conversation, AgentConfig, ApprovalPolicy,  │   │
 │  │ Capability — plain TypeScript + zod, no framework imports  │   │
 │  └────────────────────────────────────────────────────────────┘   │
 └────────────────────────────────────────────────────────────────────┘
                                   │ planned actions → outbox table
                                   ▼
          ┌──────────────── outbound adapters ───────────────┐
          │ ChannelPort      → Chatwoot, Telegram (later: web)│
          │ ToolPort         → HTTP, MCP (Motor Stock, ATS)  │
          │ ActionLedger     → Postgres                      │
          │ TaskQueue        → Postgres                      │
          │ Checkpointer     → LangGraph PostgresSaver       │
          └──────────────────────────────────────────────────┘
```

Three rules, enforced by import boundaries in CI (see §9):

1. **The domain imports nothing** from LangGraph, adapters or the database.
2. **Adapters do not know LangGraph exists.** They implement ports and nothing else.
3. **LangGraph is not hidden behind a port.** Its checkpoints, `interrupt()` and resume are the reason we use it; wrapping it in a generic "runtime" interface would throw that away. It lives in the application layer and talks to the outside only through ports. See [ADR 0002](adr/0002-langgraph-for-orchestration.md) and [ADR 0003](adr/0003-hexagonal-at-the-edges.md).

The model provider is not a port of ours either: `@langchain/core` chat models already abstract Claude, OpenAI and local models.

## 2. Domain: events and actions

The core is channel- and CRM-agnostic. A **channel connector** translates between a specific inbox/CRM and these types.

**Events in:**
- a customer message arrived (text, attachments);
- a conversation was resolved;
- a human took over / handed back;
- a scheduled task is due (§6);
- a system-of-record event (e.g. the ATS moved a candidate) — optional, per client.

**Actions out:**
- reply to the customer;
- add a private note for humans;
- hand off to a human team;
- add a label;
- set conversation attributes;
- ask the customer to verify their phone number (ADR 0006);
- resolve the conversation;
- schedule a follow-up (§6).

Every action carries an **idempotency key** derived from the run and the step that produced it (§4).

## 3. Agents

```
Agent "reception" ──handoff──► Agent "sales"     tools: search_catalog, ...   → team Sales
                  ├─handoff──► Agent "support"   tools: order_status, ...     → team Support
                  └─handoff──► human team
```

An agent is defined by:
- **instructions** (system prompt), plus optional **skills**: markdown files with behavioural rules, versioned with the code (e.g. what data may leave the system);
- **tools**: HTTP, MCP or code, grouped in **tool packs**;
- **handoffs**: which agents it can route to;
- **human team**: who receives its human handoffs;
- **mode**:
  - `autonomous`: replies to the customer;
  - `copilot`: writes private notes and suggestions for humans and never replies to the customer.

Agents compile to a LangGraph `StateGraph`: one node per agent, handoffs as edges, built-in tools mapped to actions. Client configuration is a typed object validated with zod at startup; an invalid configuration refuses to boot.

### Approval policy

Approval is decided per tool, not only per agent. Each tool declares one of:

- `auto`: runs freely;
- `approval`: the graph calls `interrupt()`, the request appears as a private note, and the run resumes when a human approves or rejects;
- `denied-unattended`: allowed when a human is driving the session, refused when the agent runs on its own (scheduled tasks).

Decisions about people — advancing or rejecting a candidate, granting a discount — default to `approval`.

### Capabilities preamble

Each session starts by telling the agent which tool packs and integrations are enabled in this installation, and the same list is printed at boot:

```
[backlabs] on   stock (STOCK_API_URL)
[backlabs] off  ats (ATS_MCP_URL)
```

The agent plans around what it has instead of discovering gaps one failed call at a time.

## 4. Runtime: inbox, worker, outbox

Two processes and one Postgres. See [ADR 0004](adr/0004-transactional-inbox-outbox.md).

```
webhook ──► api ──INSERT (dedup)──► inbox ──► worker ──► LangGraph run ──► outbox ──► dispatcher ──► channel
            200 OK                            lock per conversation          PLANNED → SUCCEEDED
```

**Inbox.** The webhook handler never runs an agent. It normalizes the event, inserts it into `inbox` deduplicated by the source event id, and returns 200. Duplicate webhooks become no-ops.

**Worker.** Claims inbox rows with `FOR UPDATE SKIP LOCKED` and holds a **lock per conversation**, so one conversation never has two runs at once. Messages that arrive during the debounce window (or while a run is in flight) are folded into the next run; a response generated against a stale history is discarded, not sent. A conversation is claimed after a quiet time since its last pending event (`debounceMs`, default 2 s), or once its oldest pending event has waited `maxWaitMs` (default 15 s), so a customer who keeps typing still gets an answer. Both are set per client. A longer wait for attachments is planned (RT-22), not built.

**Per run:**
1. Load the conversation from the channel and the graph state from the checkpointer (`thread_id` = conversation id).
2. Run the active agent, up to N tool turns, possibly handing off or pausing on `interrupt()`.
3. Write the resulting actions to the outbox as `PLANNED`.

**Outbox.** A dispatcher executes planned actions through the ports and marks them `SUCCEEDED` or `FAILED`. The unique idempotency key means a retried graph step re-plans the same action instead of sending a second message.

**Conversation mode.** The runtime knows whether the bot or a human owns each conversation. A handoff or a human reply switches it to `human`, and the bot stops answering; a resolution switches it back to `bot` with a fresh memory. This works the same on channels with an inbox (Chatwoot) and on direct channels (Telegram), where notes and handoffs go to an operator chat. See [ADR 0007](adr/0007-direct-channels-and-conversation-mode.md).

**Identity.** Tools that read a customer's own records require a phone number the channel verified, and receive it from the runtime, never from the model. An optional access list limits a deployment to known numbers. See [ADR 0006](adr/0006-verified-identity-from-the-channel.md).

**Run ledger.** Every run records status (`QUEUED → RUNNING → WAITING_FOR_APPROVAL → SUCCEEDED | FAILED | CANCELLED`), model, input/output tokens and cost.

## 5. Tools and systems of record

Systems of record (Motor Stock, an ATS, a calendar) are reached through tools, not through the channel. When we build the system ourselves, it exposes an **MCP server** next to its API, so the bot — or any other agent — uses it without bespoke integration code.

Rules every tool follows:
- **Report observations, not confidence.** A tool says what it saw and where ("the customer wrote the plate in message X"); facts about a person are recorded with their source and never guessed.
- **No customer text in third-party queries.** Derived questions only; message bodies do not leave the system.

## 6. Follow-ups: the task queue

Agents can schedule their own follow-ups ("write again when the part arrives", "remind the candidate about the interview") with a due date and a **reason that is shown to humans**. Tasks live in a Postgres table claimed with leases and `FOR UPDATE SKIP LOCKED`, with a maximum number of attempts. The scheduler decides nothing: it claims what is due and emits a "task due" event into the inbox, so follow-ups go through the same path as customer messages.

## 7. Knowledge capture

When a conversation is resolved, an extraction step reads the transcript and produces structured records (outcome, loss reason, entities) defined by the client's schema. The records go to a **review queue**: nothing is trusted automatically.

## 8. Packaging and deployment

```
backlabs-bot  (public)
├─ packages/core            domain types and ports: Event, Action, AgentConfig, ToolPack
├─ packages/runtime         LangGraph graph builder, worker, inbox/outbox, task queue, approvals
├─ packages/connector-*     channel adapters: Chatwoot, Telegram
├─ packages/tools-*         generic tool packs: scheduling, HTTP, MCP client
├─ packages/testing         in-memory channel, fake tools, eval harness, adapter contract suite
└─ examples/                a runnable bot with docker compose

<client>-bot  (private, one per client)
├─ agents, prompts, skills
├─ client tool packs (e.g. Motor Stock, the client's ATS)
└─ evals
```

**One deployment per client**, not multi-tenant: each client gets its own `api` + `worker` + Postgres. See [ADR 0005](adr/0005-one-deployment-per-client.md).

Language: TypeScript on Node. See [ADR 0001](adr/0001-typescript.md).

## 9. Quality

How we build, by layer:

| Layer | Method |
|---|---|
| Domain and runtime mechanics (inbox dedup, per-conversation lock, outbox idempotency, task leases, approval policy, config validation) | **Test first.** Deterministic code where a bug means a duplicate or lost message. |
| Adapters | **Contract tests.** One suite, run against the in-memory adapter and against the real one, so anyone can write a connector and prove it behaves. |
| Agent behaviour (prompts, skills, handoffs) | **Eval first.** Before changing a prompt, add the recorded conversation that shows the problem; the change is done when the eval passes and the others still do. |
| Design decisions | **Short specs:** this document plus an ADR per decision, written before the code. |

- **Evals in CI.** Recorded conversations run against `InMemoryChannel` and fake tools; assertions are on the emitted actions ("handed off to sales", "did not confirm stock that does not exist"). Each client repo has its own suite.
- **Import boundaries** checked in CI (`dependency-cruiser`): the domain cannot import the runtime, adapters or LangGraph.
- **Observability.** OpenTelemetry traces following the GenAI semantic conventions, exportable to Langfuse or LangSmith; structured logs per run with prompt, tool calls, results and cost.

## 10. Open questions

- Debounce defaults per channel (today one default for all, overridable per client) and the attachment wait (RT-22).

## Acknowledgements

The task queue, run/action ledger, per-tool approval and capabilities preamble are adapted from patterns in [trycompai/crm](https://github.com/trycompai/crm) (MIT).
