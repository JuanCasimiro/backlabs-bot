# Architecture (draft)

Early design notes. Everything here is open to change.

## 1. Integration with Chatwoot

```
Customer (WhatsApp, web, email...)
        │
     Chatwoot  ── Agent Bot webhook ──►  Backlabs Bot
        ▲                                     │
        └──────── REST API (reply, note, ─────┘
                  assign team, status)
```

- Backlabs Bot is registered in Chatwoot as an **Agent Bot** (`outgoing_url`) and attached to one or more inboxes.
- While a conversation is **`pending`**, the bot handles it.
- A handoff sets it to **`open`**, assigns a **team**, and leaves a **private note** with a summary for the human.
- Conversation state, such as the active agent, is stored in the conversation's **`custom_attributes`**, so the bot needs no database of its own to start.
- It only uses features of **Chatwoot Community (MIT)**: no Enterprise code, no fork.

## 2. Agents

```
Agent "reception" ──handoff──► Agent "sales"     tools: search_catalog, ...   → team Sales
                  ├─handoff──► Agent "support"   tools: order_status, ...     → team Support
                  └─handoff──► human (status "open")
```

An agent is defined by:
- **instructions** (system prompt);
- **tools** (HTTP, MCP or code);
- **handoffs**: which agents it can route to;
- **human team**: the Chatwoot team that receives its handoffs;
- **mode**:
  - `autonomous`: replies to the customer;
  - `copilot`: writes private notes for humans and never replies to the customer.

Built-in tools: hand off to an agent, hand off to a human, add label, add private note, resolve conversation.

## 3. Runtime

- **No LangChain or LangGraph.** A small agent loop over the provider SDKs with native tool use.
- **Language:** TypeScript (Node).
- **Per incoming message:**
  1. Load the conversation history from Chatwoot.
  2. Run the active agent, up to N tool turns.
  3. Apply the result: reply, note or handoff.
- **Debounce:** if a newer customer message arrives while generating, discard the stale response. Wait briefly for attachments.
- **Model-agnostic** behind a provider interface.

## 4. Knowledge capture

When a conversation is resolved, an extraction step reads the transcript and produces structured records (outcome, loss reason, entities) defined by the integrator's schema. The records go to a **review queue**: nothing is trusted automatically.

## 5. Observability

- Structured logs per run: prompt, tool calls and results, response.
- Optional OpenTelemetry export (e.g. self-hosted Langfuse).

## 6. Optional Chatwoot extensions

The free edition lists conversations by **inbox membership** only. Teams do not restrict visibility, although `ConversationPolicy` already grants access by team.

An optional MIT-licensed initializer (`prepend` on `Conversations::PermissionFilterService` and `ActionCableListener`) lets agents who belong only to a team see that team's conversations. This would be shipped as a separate, opt-in Docker image layer.

## 7. Privacy defaults for Chatwoot

`DISABLE_TELEMETRY=true` and `ENABLE_PUSH_RELAY_SERVER=false`. Optionally override `ChatwootHub.sync_with_hub` and block `hub.2.chatwoot.com`.
