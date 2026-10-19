# 0003 — Hexagonal at the edges, LangGraph in the middle

**Status:** Accepted

## Context

Every client brings a different channel (Chatwoot today, maybe web or email later) and different systems of record (a stock system, an ATS). The core must not change per client, and the agent graph must be testable without any of those systems running.

Full DDD (aggregates, a repository per entity, CQRS) would be ceremony without benefit for a bot framework. Hiding LangGraph behind a generic "agent runtime" port would remove the features we chose it for.

## Decision

Ports and adapters at the boundaries only:

- **Domain** (`packages/core`): events, actions, agent configuration, approval policy, capabilities. Plain TypeScript and zod; no imports from LangGraph, adapters or the database.
- **Ports**: `ChannelPort`, `ToolPort`, `ActionLedger`, `TaskQueue`, plus LangGraph's own checkpointer interface.
- **Adapters** (`packages/connector-*`, `packages/tools-*`, Postgres): implement ports and know nothing about LangGraph.
- **Application** (`packages/runtime`): LangGraph, used directly, reaching the outside only through ports.

The model provider is not wrapped; `@langchain/core` chat models already abstract it.

Boundaries are enforced in CI with `dependency-cruiser`.

## Consequences

- An in-memory channel and fake tools let the whole graph run in CI, which is what makes evals cheap.
- A new channel or system of record is a new adapter plus the shared contract test suite, with no core change.
- Replacing LangGraph would mean rewriting `packages/runtime`, but not the domain, adapters or client repos.
