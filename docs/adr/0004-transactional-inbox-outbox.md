# 0004 — Transactional inbox and outbox

**Status:** Accepted

## Context

Channel webhooks are delivered at least once. Customers send several messages in a row. Processes can die mid-run, and LangGraph may re-execute a step on resume. Running the agent inside the webhook request, and calling the channel directly from the graph, would produce duplicate replies, concurrent runs on one conversation and lost messages.

## Decision

- **Inbox.** Webhook handlers normalize the event, insert it into an `inbox` table deduplicated by source event id, and return 200. They never run an agent.
- **Worker.** Claims inbox rows with `FOR UPDATE SKIP LOCKED` and holds a lock per conversation. Messages arriving during a run or the debounce window are folded into the next run; a response generated against stale history is discarded.
- **Outbox.** The graph never calls the channel. It writes actions as `PLANNED` with a unique idempotency key derived from run and step. A dispatcher executes them and marks `SUCCEEDED` or `FAILED`.
- **Run ledger.** Each run records status, model, tokens and cost.

Two processes (`api`, `worker`) and one Postgres. No message broker.

## Consequences

- A duplicate webhook or a retried graph step cannot send a second message.
- One conversation never has two runs at once.
- Latency gains a small, bounded delay (queue pickup plus debounce), which is acceptable for chat.
- Postgres is a hard dependency of the runtime.
