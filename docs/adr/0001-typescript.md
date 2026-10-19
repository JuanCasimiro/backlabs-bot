# 0001 — TypeScript on Node

**Status:** Accepted

## Context

The bot is integration-heavy: webhooks, HTTP APIs, MCP servers, queues and state in Postgres. It is not ML-heavy: no training, no local models in the core. The systems it talks to that we build ourselves (Motor Stock, a future ATS) are TypeScript on Supabase.

Python is the reference language for LangGraph and has the larger AI ecosystem (evals, RAG, fine-tuning). New LangGraph features usually reach Python first.

## Decision

TypeScript on Node, with LangGraph.js.

## Consequences

- One language across the bot and the systems it integrates with; zod schemas and types can be shared.
- We may wait for LangGraph features that land in Python first. The parts we depend on — `StateGraph`, `interrupt()`, `PostgresSaver` — are available in JS.
- Heavy ML work for a client (document pipelines, large RAG, custom models) goes in a separate Python service behind a tool or port, not in the core.
