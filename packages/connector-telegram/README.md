# @backlabs/connector-telegram

Connects Backlabs Bot to a Telegram bot. Telegram is a **direct channel** (ADR 0007): there is no inbox behind it, so notes and handoffs go to an **operator chat**, and the runtime decides whether the bot or a human owns each conversation.

- `pollTelegram` receives updates with long polling. No public URL is needed, which is the easiest way to run a bot locally.
- `telegramInbound` parses webhook requests instead, verified with the `secret_token` of `setWebhook`.
- `telegramChannel` performs actions through the Bot API.

## Events

| Telegram | Backlabs | Notes |
|---|---|---|
| private message (text, caption, photo, voice, video, document, location) | `message.received` | conversation id = chat id. Event id `telegram:update:<update_id>`. |
| private message with the customer's **own** contact | `message.received` with `phoneVerified: true` | Only when `contact.user_id` is the sender (ADR 0006). Anyone else's contact is not a verification. |
| `/resume <conversation>` in the operator chat | `conversation.resolved` | Gives the conversation back to the bot. |
| groups, other bots, edits, anything else | ignored | |

Attachments are referenced as `telegram:file:<file_id>`; download them with `getFile` if a tool needs the content.

## Actions

| Action | Bot API |
|---|---|
| `reply` | `sendMessage` to the customer, removing any pending keyboard |
| `request_phone` | `sendMessage` with a one-time "share my number" button (`request_contact`) |
| `note` | `sendMessage` to the operator chat |
| `handoff` | `sendMessage` to the operator chat, with a link to the customer and the `/resume` command |
| `add_labels`, `set_attributes`, `resolve` | no visible effect |

Errors are `TelegramApiError`, with `retryable` true for 429 and 5xx.

## Setup

1. Create the bot with [@BotFather](https://t.me/BotFather) and keep the token in `.env`.
2. Create a group for operators, add the bot, and get the group's chat id (it is negative).
3. Polling: make sure no webhook is set (`deleteWebhook`). Webhook: `setWebhook` with your `api` URL and a `secret_token`.

Humans answer customers from their own Telegram account for now; relaying their replies through the bot is a later feature.
