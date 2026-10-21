# 0007 — Direct channels and the bot/human mode of a conversation

**Status:** Accepted

## Context

Chatwoot gives us a human inbox: a handoff assigns the conversation to a team, and Chatwoot decides who replies from then on. Some channels have no inbox behind them. A Telegram bot talks to the customer directly, and so would a web widget or a CLI. We want to test agents on Telegram before a WhatsApp number exists, and some clients may run that way in production.

Two things must not depend on the inbox: knowing whether the bot or a human owns the conversation, and telling a human that they are needed.

## Decision

- **The runtime owns the mode of each conversation: `bot` or `human`.** A planned `handoff` switches it to `human` when the outbox commits; `human.replied` does too; `conversation.resolved` switches it back to `bot`. While a conversation is `human`, customer messages are recorded and not answered by an agent. This holds for every channel, Chatwoot included.
- **Direct channels** implement `ChannelPort` like any other. Actions with no native equivalent go to an **operator chat** configured for the deployment: `note` and `handoff` are posted there with the conversation id and summary. `add_labels` and `set_attributes` have no visible effect.
- An operator hands a conversation back to the bot by sending a command in the operator chat. The connector turns it into `conversation.resolved`.
- Telegram is the first direct channel (`packages/connector-telegram`). It supports webhooks (verified with the secret-token header) and long polling (no public URL needed, which is what makes local testing possible). The event id is the Telegram `update_id`, which is stable for a bot.

## Consequences

- A handoff works the same everywhere. The bot steps back even on channels where nobody would otherwise stop it.
- ~~On Telegram, humans answer from their own Telegram account, outside the bot, for now.~~ Superseded by the operator-replies spec (2026-10-21): Telegram cannot open a chat by numeric id, so operators answer through the bot.
- `ChannelPort.history` on a direct channel returns what that process saw and sent. The runtime does not depend on it: the agent's memory is the LangGraph checkpoint of the conversation.

## Note (2026-10-21): operators answer through the bot

`docs/specs/operator-replies.md`. A channel declares itself direct with `ChannelPort.direct`. On direct channels the runtime plans a `relay` action for each `human.replied` (the operator's reply reaches the customer verbatim) and forwards customer messages received in `human` mode to the operator chat as notes. A new event, `human.briefed`, gives the conversation back to the bot **keeping** its memory, with the operator's facts as the next turn; `conversation.resolved` still starts a fresh memory. A brief never verifies identity (ADR 0006).

## Note (2026-10-21): a brief answers the paused handoff

`docs/specs/brief-as-tool-result.md`. A handoff now pauses the agent's thread; `human.briefed` resumes it and the brief reaches the model as a tool result, not as the next user turn. While the conversation is `human`, what the customer and the humans say is appended to the paused thread. A brief with nothing pending does not hand the conversation back: it stays `human` (or `bot`) and the operators get a note. `conversation.resolved` discards the pause with the old memory.
