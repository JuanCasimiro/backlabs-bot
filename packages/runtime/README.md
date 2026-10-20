# @backlabs/runtime

Runs the agents of a Backlabs Bot deployment: inbox, per-conversation worker, LangGraph agent graph, outbox and dispatcher, all on one Postgres. Design in [`docs/specs/runtime-v1.md`](../../docs/specs/runtime-v1.md) and ADRs [0004](../../docs/adr/0004-transactional-inbox-outbox.md), [0006](../../docs/adr/0006-verified-identity-from-the-channel.md), [0007](../../docs/adr/0007-direct-channels-and-conversation-mode.md).

```ts
import { createPostgresCheckpointer, createRuntime, migrate } from "@backlabs/runtime";

await migrate(pool);
const checkpointer = await createPostgresCheckpointer(pool);

const runtime = createRuntime({
	pool,
	channel,            // any ChannelPort: Chatwoot, Telegram, ...
	model,              // any @langchain/core chat model with tool calling
	checkpointer,
	config: {           // validated at boot; invalid config refuses to start
		entryAgent: "reception",
		agents: [
			{ name: "reception", instructions: "…", handoffs: ["orders"] },
			{ name: "orders", instructions: "…", tools: ["order_status"], team: "support" },
		],
	},
	tools: [orderStatus],
});

await runtime.enqueue(event);          // from a webhook handler or a poller
await runtime.start({ signal });       // worker + dispatcher loops
```

## What an agent can do

| Tool | Offered to | Effect |
|---|---|---|
| its own `tools` | that agent | runs the tool; the result goes back to the model as an observation |
| `transfer_to_<agent>` | agents listed in `handoffs` | the other agent answers from now on |
| `handoff_to_human` | every agent | private note with the summary + `handoff` to the agent's `team`; the bot stops answering |
| `request_phone_verification` | autonomous agents | `request_phone` action; ends the turn |

A final answer becomes a `reply`, or a private `note` for `mode: "copilot"` agents.

## Identity (ADR 0006)

A tool with `requires: "verified_phone"` is only called when the channel proved the customer's number. It receives it in `context.verifiedPhone`, never as a model argument. With `access.allowedPhones`, everyone else gets `verifyText` or `deniedText` without a model call.

## Guarantees

- The same event delivered twice is processed once.
- One run per conversation at a time (lease + `FOR UPDATE SKIP LOCKED`), after a debounce window.
- A run is discarded when a message arrives during it; the next one starts again from the last committed checkpoint.
- Actions and "events processed" are committed together. The dispatcher performs them in order per conversation, retries `retryable` errors with exponential backoff, and is at least once towards the channel.
- A failed run hands the conversation to a human with a note (and `fallbackText` to the customer, if set).

## Testing your bot

`@backlabs/runtime/testing` exports `ScriptedChatModel`, `say` and `call` to script model turns, for tests of wiring and tools without a provider. Agent behaviour itself is tested with evals against a real model.

Runtime tests need Postgres: set `TEST_DATABASE_URL`, or they are skipped.
