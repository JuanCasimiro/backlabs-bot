# Roadmap — Backlabs Bot

Source of truth for scope, IDs and decisions. Update it in the same commit as the code it describes. IDs are prefixed by package / bounded context.

## ✅ Done

| ID | What | Where |
|---|---|---|
| CORE-01 | Domain events: `message.received`, `human.replied`, `human.briefed`, `conversation.resolved`, each with a stable `eventId` | `packages/core/src/events.ts` |
| CORE-02 | Domain actions: `reply`, `note`, `handoff`, `add_labels`, `set_attributes`, `request_phone`, `relay`, `resolve`, each with an `idempotencyKey` | `packages/core/src/actions.ts` |
| CORE-03 | Conversation model: `Message`, `Contact`, `Attachment`, author `customer | bot | human` | `packages/core/src/conversation.ts` |
| CORE-04 | Ports: `ChannelPort` (`history`, `perform`) and `InboundChannel` (`parse`) | `packages/core/src/ports.ts` |
| CW-01 | Chatwoot inbound: signature verification over the raw body, Agent Bot webhook → domain event, bot echo / private / activity ignored | `packages/connector-chatwoot/src/inbound.ts` |
| CW-02 | Chatwoot channel: all six actions through the REST API, handoff = assignment + `open`, `ChatwootApiError.retryable` on 429/5xx | `packages/connector-chatwoot/src/channel.ts` |
| TEST-01 | `InMemoryChannel` + `channelContract` suite, runnable against any adapter | `packages/testing` |
| DOC-01 | `docs/ARCHITECTURE.md` + ADR 0001–0005 | `docs/` |
| CORE-05 | Verified identity: `Contact.phoneVerified`, `request_phone` action, `Tool` / `defineTool` with `requires: "verified_phone"`, `BotConfig` (agents, access list, fallback text) validated with zod (ADR 0006) | `packages/core/src/agents.ts` |
| CW-03 | Chatwoot: phone verified only on WhatsApp / SMS inboxes; `request_phone` sent as a public message | `packages/connector-chatwoot` |
| RT-01 | Inbox: `enqueue` dedups by `eventId`, never runs an agent; `webhookHandler` for Node HTTP | `packages/runtime/src/inbox.ts`, `webhook.ts` |
| RT-02 | Worker: lease per conversation with `FOR UPDATE SKIP LOCKED`, debounce, folds pending events into one run, discards a run when a message arrives during it and forks from the last committed checkpoint | `packages/runtime/src/worker.ts`, `conversations.ts` |
| RT-03 | Graph: config → `StateGraph` (agent node + tools node), transfers, `handoff_to_human`, `request_phone_verification`, memory in `PostgresSaver` | `packages/runtime/src/graph.ts` |
| RT-04 | Outbox + dispatcher: actions committed with "events processed", idempotency keys `<run>:<n>`, ordered per conversation, retry with backoff for `retryable` errors | `packages/runtime/src/outbox.ts`, `dispatcher.ts` |
| RT-06 | Run ledger: `RUNNING → SUCCEEDED / FAILED / CANCELLED`, agent, model, tokens | `packages/runtime/src/runs.ts` |
| RT-09 | Copilot mode: the answer becomes a private note; no tool that writes to the customer | `packages/runtime/src/graph.ts` |
| ID-01 | Identity gate (personal-data tools need a verified phone, passed as context) + access list without model calls (ADR 0006); conversation mode bot/human (ADR 0007) | `packages/runtime/src/identity.ts`, `fold.ts` |
| TG-01 | Telegram connector: long polling and webhook, own-contact sharing verifies the phone, operator chat for notes and handoffs, `/resume` (ADR 0007) | `packages/connector-telegram` |
| TEST-02 | `ScriptedChatModel` + `say` / `call` for deterministic runtime tests | `packages/runtime/src/testing.ts` |
| DOC-02 | ADR 0006–0007, runtime spec, repo skills (`sdd`, `tdd`, `clean-code`, `new-connector`, `agent-eval`) | `docs/`, `.claude/skills/` |
| RT-13 | `human.briefed` event (core): back to `bot` mode keeping memory; a brief never verifies a phone. Its user-turn framing (`FROM_THE_TEAM`) was replaced by RT-15 | `packages/core/src/events.ts`, `packages/runtime/src/fold.ts` |
| RT-14 | On direct channels (`ChannelPort.direct`), customer messages while a human owns the conversation go to the operator chat as notes; human replies are relayed to the customer (`relay` action) | `packages/core/src/ports.ts`, `actions.ts`, `packages/runtime/src/worker.ts` |
| TG-02 | Telegram: a plain reply to a note or handoff in the operator chat becomes `human.replied` and is relayed verbatim; a delivery that will not succeed is reported as a reply to the operator's message | `packages/connector-telegram/src/updates.ts`, `channel.ts`, `operator-chat.ts` |
| TG-03 | Telegram: `/bot <facts>` as a reply becomes `human.briefed` (command configurable, `briefCommand`) | `packages/connector-telegram/src/updates.ts` |
| TG-04 | Telegram: handoff names both ways to answer and `/resume`; operator texts configurable (`texts`), fixed first line with the conversation id | `packages/connector-telegram/src/channel.ts` |
| RT-15 | A handoff pauses the graph (`interrupt()` in `wait_for_team`, after the agent tells the customer); `human.briefed` resumes it and the brief reaches the model as a tool result (`Answer from the team: …`), not a user turn. The worker asks the graph whether a thread is paused | `packages/runtime/src/graph.ts`, `worker.ts`, `fold.ts` |
| RT-16 | A brief with no pending handoff runs no agent and leaves a note for the operators (`BotConfig.texts.briefWithoutHandoff`, English default) | `packages/core/src/agents.ts`, `packages/runtime/src/worker.ts` |
| RT-17 | Customer messages (user turns) and human replies (assistant turns) received while a human owns the conversation are appended to the paused thread on arrival, without a run | `packages/runtime/src/graph.ts`, `worker.ts`, `messages.ts` |

Verified 2026-10-21: `tsc` and Biome clean, 132 tests passing against Postgres (5 skipped: contract against a live Chatwoot, needs `CHATWOOT_CONTRACT_*`).

## 🔜 Backlog

### Runtime (`packages/runtime`) — next increment, test first

| ID | Feature | What it does | Status |
|---|---|---|---|
| RT-05 | Approval policy | Per tool: `auto` / `approval` (`interrupt()`, request as private note, resume on decision) / `denied-unattended`. Decisions about people default to `approval`. Reuse the pause plumbing of RT-15 (`waitingFor`, `append`, resume from a fresh checkpoint) | priorizado |
| RT-07 | Task queue (follow-ups) | Postgres table with leases and max attempts; scheduler emits "task due" into the inbox with a human-readable reason | idea |
| RT-08 | Capabilities preamble | Enabled tool packs and integrations printed at boot and injected at session start | idea |
| RT-11 | Memory trimming | Send the model only the last N turns (or a summary) of long conversations; today the whole thread goes | idea |
| RT-12 | Smarter debounce | Wait longer when the burst has attachments (1 s + 1 s per attachment, up to 5 s, as Chatwoot's Captain does) and cap the total wait (e.g. 15 s), so a customer who keeps typing still gets an answer. Today: a fixed 2 s window with no cap | priorizado |
| RT-18 | Images to the model | Attachments become image content blocks for multimodal models; connectors resolve a file to something the model can read (Telegram `getFile`, Chatwoot `data_url`). Today the model only sees `[attachment: image]` | idea |
| RT-19 | Voice notes | A `Transcriber` port: voice notes become text before the run. Self-hosted Whisper by default (customer audio must not go to a third party without the client's consent) | idea |
| RT-20 | Cost in the run ledger | Price per model → cost per run, next to tokens | idea |
| RT-10 | Import boundaries in CI | `dependency-cruiser`: domain cannot import runtime, adapters or LangGraph | idea |

### Developer experience

| ID | Feature | What it does | Status |
|---|---|---|---|
| PG-01 | Playground | Local web page (`npm run playground` in a client repo) to chat as the customer and see, next to each answer, the active agent, tool calls with arguments and results, transfers, notes and handoffs; verified or unverified customer; reloads prompts on "new conversation". Spec: [`docs/specs/playground.md`](docs/specs/playground.md) | priorizado |
| PG-02 | Save as eval | From the playground, save a conversation as an eval file for the client repo (needs EV-01) | idea |

### Connectors

| ID | Feature | Status |
|---|---|---|
| CW-04 | Chatwoot: a private note `/bot <facts>` briefs the bot, which answers the customer itself (`human.briefed`, already in core); other private notes stay ignored | idea — on Chatwoot humans answer from the inbox |
| WA-01 | WhatsApp Cloud API direct connector (today WhatsApp arrives through Chatwoot) | idea |

### Tools (`packages/tools-*`)

| ID | Feature | Status |
|---|---|---|
| TL-01 | HTTP tool pack (declarative endpoints, auth, schema) | idea |
| TL-02 | MCP client tool pack | idea |
| TL-03 | Scheduling tool (creates follow-up tasks, RT-07) | idea |
| TL-04 | Document knowledge tool (external RAG service) | idea |

**TL-04 notes.** For clients whose knowledge lives in documents (manuals, manufacturer catalogs, supplier price lists in PDF, regulations), not in a database. Run [LightRAG](https://github.com/HKUDS/LightRAG) / [RAG-Anything](https://github.com/HKUDS/RAG-Anything) (MIT, Python, Postgres backend) as a separate service and reach it through TL-01 (HTTP) or TL-02 (MCP); nothing enters the core (ADR 0001: heavy ML stays outside). Not for structured data: stock, prices, orders or appointments are queried exactly from the system of record, never retrieved by similarity. Before adopting: indexing cost (many LLM calls per document), parser models, and privacy (document content goes to the model provider; use a self-hosted model or index only non-sensitive documents).

### Knowledge capture

| ID | Feature | Status |
|---|---|---|
| KC-01 | On `conversation.resolved`, extract structured records per client schema into a review queue; nothing trusted automatically | idea |

### Observability and evals

| ID | Feature | Status |
|---|---|---|
| OB-01 | OpenTelemetry traces (GenAI semantic conventions), exportable to Langfuse / LangSmith; structured logs per run | idea |
| EV-01 | Eval harness: recorded conversations against `InMemoryChannel` + fake tools, assertions on emitted actions | idea |

### Examples and packaging

| ID | Feature | Status |
|---|---|---|
| EX-01 | `examples/` runnable bot with `docker compose up` (api + worker + Postgres + Chatwoot) | idea |
| PK-01 | Publish packages to npm with semver + changelog (Changesets) | idea |

### Open source (from `TODO.md`)

| ID | Feature | Status |
|---|---|---|
| OS-01 | GitHub Actions CI: `npm ci` + `npm run check` on push and PR to `main`, Node 24 | ✅ 2026-10-19 (`.github/workflows/ci.yml`, job `check`) |
| OS-02 | `CONTRIBUTING.md` | ✅ 2026-10-19 |
| OS-03 | Branch ruleset on `main` (PR, 1 approval, status check, admin bypass while single-maintainer) | after OS-01 |
| OS-04 | README demo (GIF) once the bot does something useful | after RT-* + EX-01 |
| OS-05 | `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue/PR templates, `CODEOWNERS` | when there are contributors |

## Open questions

- Debounce window and attachment wait: defaults per channel, overridable per client.
- `.gitattributes` with `* text=auto eol=lf` so Biome passes on Windows clones.
- Default model provider for `examples/` (the runtime is provider-agnostic).

## Decision log

| Date | Decision |
|---|---|
| 2026-10-19 | TypeScript on Node 24 (ADR 0001). |
| 2026-10-19 | LangGraph.js for orchestration; only `@langchain/core` + provider chat models, no chains (ADR 0002). Replaces the earlier draft "small agent loop over provider SDKs". |
| 2026-10-19 | Hexagonal at the edges, LangGraph in the middle; boundaries enforced with `dependency-cruiser` (ADR 0003). |
| 2026-10-19 | Transactional inbox/outbox in Postgres; two processes, no broker; Postgres is a hard dependency of the runtime (ADR 0004). |
| 2026-10-19 | One deployment per client; no tenant concept in the core; client repos are private (ADR 0005). |
| 2026-10-19 | Chatwoot is the first connector; its local setup moved out of this repo into the first client repo so the core stays CRM-agnostic. |
| 2026-10-19 | `ROADMAP.md` and `CLAUDE.md` added as the agent-facing source of truth, next to ARCHITECTURE + ADRs. |
| 2026-10-20 | Verified identity comes from the channel, never from the model; personal-data tools get the phone as context; optional access list (ADR 0006). |
| 2026-10-20 | The runtime owns the bot/human mode of each conversation; direct channels send notes and handoffs to an operator chat; Telegram is the first direct channel (ADR 0007). |
| 2026-10-20 | A failed run hands off to a human instead of retrying; a run interrupted by a new message is discarded and the next one forks from the last committed checkpoint (runtime spec). |
| 2026-10-20 | Approval policy (RT-05) postponed: no tool in the first deployments writes to a system of record. |
| 2026-10-20 | Compared with Chatwoot's Captain (v4.18 code): we keep the debounce (one model call per burst) and take its attachment-aware wait (RT-12); its vision and audio transcription become RT-18 / RT-19 (renumbered on merge: RT-13..17 were taken by operator replies); its playground becomes PG-01. Captain itself is `enterprise/` and needs a paid plan in production. |
| 2026-10-21 | Operators on direct channels answer through the bot, two ways: a reply to the handoff is relayed verbatim (`human.replied`); `/bot <facts>` briefs the bot, which answers keeping its memory (`human.briefed`, new event). The event is generic (core); this increment implements it on Telegram only, where there is no inbox. Chatwoot brief (CW-04) later. "Answer from Telegram" is not viable: no chat by numeric id. While a human owns the conversation, customer messages are forwarded to the operator chat. Spec `docs/specs/operator-replies.md`. |
| 2026-10-21 | A channel declares itself direct with `ChannelPort.direct` (the channel knows, so a deployment cannot misconfigure it). On direct channels the runtime plans a `relay` action for each human reply and a note for each customer message received in `human` mode. Operator messages on Telegram start with a fixed line carrying the conversation id; replies are routed by it, nothing stored. Spec `docs/specs/operator-replies.md`. |
| 2026-10-21 | A brief is the team's answer to the handoff: `handoff_to_human` pauses the graph and the brief resumes it as that tool's result. The user-turn framing (RT-13, `FROM_THE_TEAM`) is dropped: the model read it as the customer claiming a price and refused it. Same pause/resume plumbing as RT-05. Spec `docs/specs/brief-as-tool-result.md`. |
