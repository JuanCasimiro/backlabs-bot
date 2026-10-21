# @backlabs/connector-telegram

Connects Backlabs Bot to a Telegram bot. Telegram is a **direct channel** (ADR 0007, `channel.direct === true`): there is no inbox behind it, so notes and handoffs go to an **operator chat**, operators answer customers through the bot, and the runtime decides whether the bot or a human owns each conversation.

- `pollTelegram` receives updates with long polling. No public URL is needed, which is the easiest way to run a bot locally.
- `telegramInbound` parses webhook requests instead, verified with the `secret_token` of `setWebhook`.
- `telegramChannel` performs actions through the Bot API.

## Events

| Telegram | Backlabs | Notes |
|---|---|---|
| private message (text, caption, photo, voice, video, document, location) | `message.received` | conversation id = chat id. Event id `telegram:update:<update_id>`. |
| private message with the customer's **own** contact | `message.received` with `phoneVerified: true` | Only when `contact.user_id` is the sender (ADR 0006). Anyone else's contact is not a verification. |
| groups, other bots, edits, anything else | ignored | |

## Operator chat

Every message the bot posts there starts with a fixed line: a mark and the conversation id (`📝 <id>` note, `🙋 <id>` handoff, `⚠️ <id>` failed delivery). Replies are routed by reading that line back, so nothing is stored.

| Operator sends | Backlabs | What happens |
|---|---|---|
| a plain-text **reply** to a note or handoff of the bot | `human.replied` | The runtime relays the text to the customer verbatim and the conversation stays with humans. If Telegram refuses it for good (e.g. the customer blocked the bot), the bot answers the operator's message with the error. |
| `/bot <facts>` as a **reply** to a note or handoff | `human.briefed` | The customer does not see it. The bot takes the conversation back, keeps its memory and answers using the facts. A brief never verifies the customer's phone. |
| `/resume <conversation>` | `conversation.resolved` | The human is done: the bot takes over with a fresh memory. |
| anything else (other commands, non-text replies, replies to other messages) | ignored | |

While a human owns a conversation, the customer's new messages arrive in the operator chat as notes (`💬 …`), so operators can reply to them.

Commands are configurable on both sides and must match: `resumeCommand` (default `resume`) and `briefCommand` (default `bot`), without the slash.

Attachments are referenced as `telegram:file:<file_id>`; download them with `getFile` if a tool needs the content.

## Actions

| Action | Bot API |
|---|---|
| `reply` | `sendMessage` to the customer, removing any pending keyboard |
| `request_phone` | `sendMessage` with a one-time "share my number" button (`request_contact`) |
| `relay` | `sendMessage` to the customer with the operator's text, verbatim |
| `note` | `sendMessage` to the operator chat |
| `handoff` | `sendMessage` to the operator chat, with a link to the customer, the two ways to answer and the `/resume` command |
| `add_labels`, `set_attributes`, `resolve` | no visible effect |

Errors are `TelegramApiError`, with `retryable` true for 429 and 5xx.

## Setup

1. Create the bot with [@BotFather](https://t.me/BotFather) and keep the token in `.env`.
2. Create a group for operators, add the bot, and get the group's chat id (it is negative). Group privacy mode can stay on: the bot still receives commands and replies to its own messages, which is all it reads there.
3. Polling: make sure no webhook is set (`deleteWebhook`). Webhook: `setWebhook` with your `api` URL and a `secret_token`.

## Operator texts

Operator chats are usually in the client's language. `telegramChannel({ texts })` overrides any of these Telegram-HTML templates (defaults in English, `defaultOperatorTexts`); placeholders are filled with escaped values:

| Text | Placeholders |
|---|---|
| `handoff` | `{id}`, `{team}` (` (name)` or empty), `{brief}`, `{resume}` |
| `note` | `{text}` |
| `deliveryFailed` | `{error}` |

The first line with the conversation id is not part of the templates, so translating them cannot break reply routing.
