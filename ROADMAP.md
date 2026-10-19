# Roadmap — Backlabs Bot

Source of truth for scope, IDs and decisions. Update it in the same commit as the code it describes. IDs are prefixed by package / bounded context.

## ✅ Done

| ID | What | Where |
|---|---|---|
| CORE-01 | Domain events: `message.received`, `human.replied`, `conversation.resolved`, each with a stable `eventId` | `packages/core/src/events.ts` |
| CORE-02 | Domain actions: `reply`, `note`, `handoff`, `add_labels`, `set_attributes`, `resolve`, each with an `idempotencyKey` | `packages/core/src/actions.ts` |
| CORE-03 | Conversation model: `Message`, `Contact`, `Attachment`, author `customer | bot | human` | `packages/core/src/conversation.ts` |
| CORE-04 | Ports: `ChannelPort` (`history`, `perform`) and `InboundChannel` (`parse`) | `packages/core/src/ports.ts` |
| CW-01 | Chatwoot inbound: signature verification over the raw body, Agent Bot webhook → domain event, bot echo / private / activity ignored | `packages/connector-chatwoot/src/inbound.ts` |
| CW-02 | Chatwoot channel: all six actions through the REST API, handoff = assignment + `open`, `ChatwootApiError.retryable` on 429/5xx | `packages/connector-chatwoot/src/channel.ts` |
| TEST-01 | `InMemoryChannel` + `channelContract` suite, runnable against any adapter | `packages/testing` |
| DOC-01 | `docs/ARCHITECTURE.md` + ADR 0001–0005 | `docs/` |

Verified 2026-10-19: `tsc` clean, 33 tests passing (4 skipped: contract against a live Chatwoot, needs `CHATWOOT_CONTRACT_*`).

## 🔜 Backlog

### Runtime (`packages/runtime`) — next increment, test first

| ID | Feature | What it does | Status |
|---|---|---|---|
| RT-01 | Inbox | Webhook handler normalizes the event, inserts into `inbox` deduplicated by `eventId`, returns 200. Never runs an agent | priorizado |
| RT-02 | Worker with per-conversation lock | Claims inbox rows with `FOR UPDATE SKIP LOCKED`; one run per conversation at a time; messages during a run/debounce fold into the next run; stale responses discarded; waits briefly for attachments | priorizado |
| RT-03 | Graph builder | Client config (zod, validated at boot) → `StateGraph`: one node per agent, handoffs as edges, built-in tools mapped to actions. `PostgresSaver` with `thread_id` = conversation id | priorizado |
| RT-04 | Outbox + dispatcher | Actions written as `PLANNED` with idempotency key; dispatcher performs through ports and marks `SUCCEEDED` / `FAILED`; retried steps re-plan the same key | priorizado |
| RT-05 | Approval policy | Per tool: `auto` / `approval` (`interrupt()`, request as private note, resume on decision) / `denied-unattended`. Decisions about people default to `approval` | priorizado |
| RT-06 | Run ledger | `QUEUED → RUNNING → WAITING_FOR_APPROVAL → SUCCEEDED | FAILED | CANCELLED`, model, tokens, cost | priorizado |
| RT-07 | Task queue (follow-ups) | Postgres table with leases and max attempts; scheduler emits "task due" into the inbox with a human-readable reason | idea |
| RT-08 | Capabilities preamble | Enabled tool packs and integrations printed at boot and injected at session start | idea |
| RT-09 | Copilot mode | Agent writes private notes and suggestions, never replies to the customer | idea |
| RT-10 | Import boundaries in CI | `dependency-cruiser`: domain cannot import runtime, adapters or LangGraph | idea |

### Tools (`packages/tools-*`)

| ID | Feature | Status |
|---|---|---|
| TL-01 | HTTP tool pack (declarative endpoints, auth, schema) | idea |
| TL-02 | MCP client tool pack | idea |
| TL-03 | Scheduling tool (creates follow-up tasks, RT-07) | idea |

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
