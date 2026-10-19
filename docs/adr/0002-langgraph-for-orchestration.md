# 0002 — LangGraph for agent orchestration

**Status:** Accepted. Replaces the earlier draft decision "no LangChain or LangGraph, a small agent loop over the provider SDKs".

## Context

The runtime needs per-conversation state that survives restarts, pausing a run until a human approves an action, resuming where it stopped, and routing between agents. A hand-written loop would have to build checkpoints, pause/resume and handoffs itself.

LangChain's higher-level abstractions (chains, `AgentExecutor`) hide what is sent to the model and are hard to debug. LangGraph is a different layer: an explicit state machine with persistence.

## Decision

Use LangGraph.js for orchestration:

- one `StateGraph` per client configuration, one node per agent, handoffs as edges;
- `PostgresSaver` as checkpointer, with `thread_id` = conversation id;
- `interrupt()` for approvals and copilot review.

From LangChain we use only `@langchain/core` and the provider chat model packages. No chains, no `AgentExecutor`.

## Consequences

- Checkpoints, approvals and resume come from the library instead of our code.
- LangGraph does not make external side effects idempotent, serialize concurrent runs per conversation, or schedule follow-ups in self-hosted setups. We still build those: [ADR 0004](0004-transactional-inbox-outbox.md) and the task queue.
- Exposure to LangGraph API churn is contained in `packages/runtime` ([ADR 0003](0003-hexagonal-at-the-edges.md)).
