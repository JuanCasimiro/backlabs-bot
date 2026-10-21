# Spec: operator replies through the bot (TG-02..04, RT-13..14)

## Problem

On a direct channel (ADR 0007) there is no inbox behind the bot, so a handoff goes to the operator chat with the instruction "answer from Telegram". That does not work: Telegram does not let anyone open a chat with a user by numeric id, so unless the customer has a public username the operator has no way to answer. The handoff is a dead end.

Operators also want a cheaper move than writing the whole answer: give the bot the one fact it was missing ("it costs 11,000 and we have it in stock") and let the bot answer in its own voice, with the conversation still in its memory.

Today the connector ignores everything in the operator chat except `/resume`, and while a human owns a conversation the customer's new messages reach nobody on a direct channel.

## Scope

| ID | Behaviour |
|---|---|
| TG-02 | **Reply as a human.** In the operator chat, a plain-text *reply* (Telegram `reply_to_message`) to a note or handoff message of the bot is sent verbatim to that customer with `sendMessage`. The conversation id is read from the replied message: the bot already writes it in every note and handoff, so nothing is stored. The connector emits `human.replied` with the text as a `human`-authored message, and the runtime keeps or switches the conversation to `human` mode. A delivery error is reported back to the operator chat as a reply to the operator's message. |
| TG-03 | **Brief the bot.** A reply to the same messages that starts with the brief command (`/bot` by default, configurable like `resumeCommand`) is not sent to the customer. The connector emits `human.briefed` with the text after the command. The bot answers the customer from the brief. |
| TG-04 | **Operator-facing texts.** The default handoff message explains the two ways to answer plus `/resume`. `telegramChannel` accepts optional `texts` to override the handoff and note templates, because operator chats are usually in the client's language. Defaults stay in English. |
| RT-13 | *(2026-10-21: the user-turn framing below was replaced by RT-15, `docs/specs/brief-as-tool-result.md`: a brief is now the tool result of the paused handoff.)* **`human.briefed` in the runtime.** New domain event in `@backlabs/core`: `{ type: "human.briefed", eventId, conversationId, message }` with `message.author = "human"`. Folding it switches the conversation to `bot` mode **without** resetting memory, appends the message to the thread and runs the agent (debounce as usual). The model sees `human`-authored messages framed as coming from the team, not from the customer, for example `[Message from your team, not from the customer. It is confirmed information from the business: use it to answer the customer now, without saying you cannot confirm it.] …`, so it answers the customer with that information. Identity gates are unchanged: a brief never verifies a phone and never unlocks a personal-data tool. |
| RT-14 | **Customer messages while a human owns the conversation.** On a direct channel, a `message.received` in `human` mode is forwarded to the operator chat as a note that carries the conversation id and the customer's text, so the operator can answer it by replying (TG-02). Not on Chatwoot, where the inbox already shows it. |

`/resume <id>` keeps its meaning (ADR 0007): the human is done, the bot takes over with a fresh memory.

## Acceptance criteria (test names)

Telegram inbound
- turns a plain reply to a handoff message into `human.replied` for that conversation
- turns a plain reply to a note into `human.replied` for that conversation
- turns a `/bot …` reply into `human.briefed` with the text after the command
- ignores operator messages that do not reply to a message of the bot
- ignores a reply to a bot message that carries no conversation id
- ignores an empty brief

Telegram channel
- sends a human reply to the customer verbatim
- reports a failed delivery back to the operator chat, as a reply to the operator's message
- the default handoff message names both ways to answer and `/resume`
- uses the configured texts when given

Runtime
- answers the customer from a brief, keeping the conversation memory
- frames a human-authored message as coming from the team
- a brief does not verify the phone and does not unlock a personal-data tool
- forwards customer messages to the operator chat while a human owns the conversation, on direct channels only
- steps back when a human replies through the bot (existing test, must keep passing)

## Out of scope

- Showing the operator's name to the customer. Relayed text goes verbatim; the operator signs if they want to.
- Editing or deleting a relayed message.
- Attachments from operators: text only.
- Chatwoot. Replying as a human needs nothing there: the inbox is the reply, and an outgoing message by a human already emits `human.replied`. The brief (`/bot …` as a private note, CW-04) is a later increment; `human.briefed` lives in the core so that connector can emit it without touching the runtime.

## Decisions taken in implementation

- **Brief command: `/bot`**, option `briefCommand` (written without the slash, like `resumeCommand`). It is not one of Telegram's reserved commands (`/start`, `/help`, `/settings`). Other commands sent as a reply are ignored, never relayed.
- **Direct channels declare themselves: `ChannelPort.direct?: boolean`.** The channel knows whether an inbox sits behind it, so a deployment cannot misconfigure it; a runtime option would be one more thing to get wrong. `telegramChannel` sets it; `InMemoryChannel` takes `{ direct: true }` for tests. ADR 0007 has a note.
- **Relaying goes through the outbox, as a new action `relay`** (`text`, `sourceMessageId`). The connector only parses; the runtime plans a `relay` for each `human.replied` on a direct channel, so a relayed reply gets the same idempotency, ordering and retries as any other action. Chatwoot handles `relay` like a reply, but the runtime never plans one there.
- **Customer messages in `human` mode (RT-14)** become a note `💬 <text>` (attachments as `[attachment: kind]`). They are not added to the bot's memory: if a brief follows, the operator puts what matters in it.
- **Routing a reply**: every message the bot posts to the operator chat starts with a fixed line, a mark and the conversation id (`📝 <id>` note, `🙋 <id>` handoff, `⚠️ <id>` failed delivery). The configurable `texts` go below it, so a client cannot break routing by translating them. Only replies to messages from a bot are read.
- **Failed delivery**: only errors a retry cannot fix (`retryable: false`, e.g. the customer blocked the bot) are reported, once, as a reply to the operator's message; the outbox row ends `FAILED`. A relay that exhausts its retries on 429/5xx is not reported.
- **Forwarding and relaying need a run id** (the outbox references one): the worker records a run with no agent and no model, like the access-list path.
