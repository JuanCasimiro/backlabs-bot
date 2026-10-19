# Architecture (draft)

Early design notes. Everything here is open to change.

## 1. Core and connectors

```
Customer (WhatsApp, web, email...)
        │
   Your inbox / CRM  ◄──── actions ────┐
        │ events                       │
        ▼                              │
   Connector (yours) ─────────────►  Backlabs Bot core
                   normalized events    (agents, tools, state)
```

The core is CRM-agnostic. A **connector** translates between a specific inbox/CRM and the core.

**Events in:**
- a customer message arrived (text, attachments);
- a conversation was resolved;
- a human took over.

**Actions out:**
- reply to the customer;
- add a private note for humans;
- hand off to a human team;
- add a label;
- set conversation attributes;
- resolve the conversation.

**State:** the connector also provides a key-value store for conversation state (e.g. the active agent). It can live in the CRM itself, when the CRM supports custom attributes, or in a database.

## 2. Agents

```
Agent "reception" ──handoff──► Agent "sales"     tools: search_catalog, ...   → team Sales
                  ├─handoff──► Agent "support"   tools: order_status, ...     → team Support
                  └─handoff──► human team
```

An agent is defined by:
- **instructions** (system prompt);
- **tools** (HTTP, MCP or code);
- **handoffs**: which agents it can route to;
- **human team**: who receives its human handoffs;
- **mode**:
  - `autonomous`: replies to the customer;
  - `copilot`: writes private notes for humans and never replies to the customer.

Built-in tools map to connector actions: hand off to an agent, hand off to a human, add label, add private note, resolve conversation.

## 3. Runtime

- **No LangChain or LangGraph.** A small agent loop over the provider SDKs with native tool use.
- **Language:** TypeScript (Node).
- **Per incoming message:**
  1. Get the conversation history from the connector.
  2. Run the active agent, up to N tool turns.
  3. Apply the result through the connector: reply, note or handoff.
- **Debounce:** if a newer customer message arrives while generating, discard the stale response. Wait briefly for attachments.
- **Model-agnostic** behind a provider interface.

## 4. Knowledge capture

When a conversation is resolved, an extraction step reads the transcript and produces structured records (outcome, loss reason, entities) defined by the integrator's schema. The records go to a **review queue**: nothing is trusted automatically.

## 5. Observability

- Structured logs per run: prompt, tool calls and results, response.
- Optional OpenTelemetry export (e.g. self-hosted Langfuse).
