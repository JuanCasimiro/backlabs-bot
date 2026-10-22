# Spec: who answers follows the channel (RT-23, CW-05)

## Problem

The runtime keeps its own `bot` / `human` mode per conversation (ADR 0007) and learns about changes only from messages and resolutions. Chatwoot has its own answer to the same question, and its operators change it from the UI. Seen on a local Chatwoot 4.19 on 2026-10-22:

- An operator gave a conversation back to the bot from the "Assigned agent" dropdown. Chatwoot set it to `pending` and assigned the bot; the runtime never heard of it, stayed in `human` mode and never answered the customer again.
- The bot's webhook failed once, so Chatwoot opened the conversation for humans. The runtime stayed in `bot` mode and kept answering a conversation people now owned.

Chatwoot's own AI agent (Captain) does not keep a second state: it answers only while the conversation is `pending` (`enterprise/app/services/enterprise/message_templates/hook_execution_service.rb:12`), hands off with `pending → open`, and gets a conversation back when a person assigns it from the dropdown (`app/services/conversations/assignment_service.rb:29-47`: no assignee, the bot as AI assignee, `pending`). It then answers with the whole history, human replies included as assistant turns. We copy that contract instead of inventing one.

## Scope

| ID | Behaviour |
|---|---|
| RT-23 | **Two domain events for ownership.** `conversation.taken_over`: a person (or the channel) took the conversation; the runtime switches to `human` mode, drops unanswered customer messages from the bot's turn as `human.replied` does, and the bot stays silent. `conversation.handed_back`: a person gave the conversation back to the bot, **which keeps its memory**; the runtime switches to `bot` mode and the next customer message is answered. Both are idempotent: a `taken_over` in `human` mode or a `handed_back` in `bot` mode changes nothing. |
| RT-23 | **What happened meanwhile is in the memory.** On `handed_back`, customer messages and human replies received while a person owned the conversation are appended to the thread (as RT-17 does for a paused thread, now also when no handoff was pending). If the thread was waiting for the team (RT-15), the pause is closed with the team's answer: "the team answered the customer directly and handed the conversation back to you", as the result of the pending `ask_team` call. The bot does not speak on hand-back; it answers the next customer message. |
| CW-05 | **Chatwoot's status is the source.** The connector turns `conversation_status_changed` into `conversation.handed_back` when the new status is `pending` and into `conversation.taken_over` when it is `open`. Other statuses are ignored (`resolved` keeps arriving as `conversation_resolved`). The bot's own handoff (`pending → open`) produces a `taken_over` that finds the conversation already in `human` mode. |

`conversation.resolved` keeps its meaning: fresh memory. Telegram's `/resume` is unchanged (it still resolves); a direct channel can map its own gesture to `handed_back` later.

## Acceptance criteria (test names)

Runtime
- a conversation taken over by a person stops the bot without any message
- a conversation handed back answers the next customer message keeping the memory
- a hand-back closes a pending handoff with the team's answer and keeps what the person said
- a hand-back in bot mode and a take-over in human mode change nothing

Chatwoot connector
- turns a status change to pending into conversation.handed_back
- turns a status change to open into conversation.taken_over
- ignores other status changes

Client eval (in a deployment repo): after a handoff, a person answers the customer directly and hands the conversation back; asked a follow-up, the bot answers from what the person said and does not ask again which part it was.
