# Spec: runtime v1 (RT-01..04, RT-06, RT-09, identity gate)

## Problem

The domain and the Chatwoot connector exist, but nothing answers a customer. We need the smallest runtime that answers reliably on any channel, without duplicate or lost messages and without leaking one customer's data to another.

## Scope

| ID | Behaviour |
|---|---|
| RT-01 | **Inbox.** `enqueue(event)` stores the event once per `eventId` and returns. It never runs an agent. A webhook handler and a poller both feed it. |
| RT-02 | **Worker.** Claims one conversation at a time with a lease (`FOR UPDATE SKIP LOCKED`), after a debounce since its last pending event. Folds every pending event into one run. If a new event arrives while the run is in flight, the run is discarded and the next one starts again from the last committed checkpoint. |
| RT-03 | **Graph.** Validated config → LangGraph `StateGraph`: an agent node, a tools node, transfers between agents, `handoff_to_human`, `request_phone_verification`. Memory per conversation in a checkpointer. |
| RT-04 | **Outbox + dispatcher.** The run's actions are written as `PLANNED` with idempotency keys `<runId>:<n>`, in the same transaction that marks the events processed. The dispatcher performs them in order per conversation, retries retryable errors with backoff, and marks `SUCCEEDED` / `FAILED`. |
| RT-06 | **Run ledger.** `RUNNING → SUCCEEDED / FAILED / CANCELLED`, with agent, model and tokens. |
| RT-09 | **Copilot mode.** A copilot agent's answer becomes a private note; it is never offered a tool that writes to the customer. |
| ADR 0006 | **Identity gate and access list.** Tools that require a verified phone are not called without one. With an access list, unverified customers get `request_phone` and verified customers outside the list get a fixed refusal, with no model call. |
| ADR 0007 | **Conversation mode.** `handoff` and `human.replied` switch to `human`; `conversation.resolved` switches back to `bot` and starts a fresh memory. Customer messages in `human` mode are not answered. |

## Acceptance criteria (test names)

Inbox
- stores an event once even when it is delivered twice
- does not run an agent

Worker
- answers a customer message with the agent's reply
- folds several pending messages into a single run
- waits for the debounce window before answering
- never runs two workers on the same conversation at once
- discards a run when a message arrives during it, and the next run sees both messages
- remembers the conversation across runs
- hands off to a human with a note and stops answering
- answers again after the conversation is resolved, with a fresh memory
- steps back when a human replies
- transfers between agents and lets the new agent answer
- a copilot agent writes a note, not a reply
- does not call a personal-data tool without a verified phone
- passes the verified phone to the tool as context, not as an argument
- keeps a verified phone for later messages of the conversation
- asks for the phone, without a model call, when an access list is set and the phone is not verified
- refuses a verified phone outside the access list, without a model call
- hands off to a human when the run fails
- records the run with its agent and token usage

Dispatcher
- performs planned actions in order and marks them succeeded
- retries a retryable error later, and gives up after the maximum attempts
- marks a non-retryable error as failed without retrying
- never performs an action of a conversation before the earlier ones

Config
- refuses to start with an unknown entry agent, handoff target or tool

## Out of scope (next)

Per-tool approval with `interrupt()` (RT-05), follow-up task queue (RT-07), capabilities preamble (RT-08), stale-history check against the channel, history trimming, cost in currency.

## Edge cases decided

- A run that throws is not retried by the worker: the customer is handed to a human with a note saying the bot failed. A model outage must not leave a customer unanswered in silence.
- Delivery is at least once between the dispatcher and the channel: a crash after the channel accepted a message and before it is marked `SUCCEEDED` sends it again. Channels with idempotency support can use the key.
