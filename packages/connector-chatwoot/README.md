# @backlabs/connector-chatwoot

Connects Backlabs Bot to [Chatwoot](https://www.chatwoot.com) as an **Agent Bot**.

- `chatwootInbound` verifies the webhook signature and turns Chatwoot events into domain events.
- `chatwootChannel` reads history and performs actions through the Chatwoot API.

## Events

| Chatwoot | Backlabs | Notes |
|---|---|---|
| `message_created`, incoming | `message.received` | Text may be empty when the customer only sent attachments. |
| `message_created`, outgoing by a user | `human.replied` | A human agent answered: the bot should step back. |
| `message_created`, outgoing by the bot | ignored | Chatwoot echoes the bot's own messages. |
| `message_created`, private or activity | ignored | |
| `conversation_resolved` | `conversation.resolved` | |
| anything else | ignored | Acknowledged with `{ ok: true, event: null }`. |

Event ids are stable across Chatwoot's retries (`chatwoot:message:<id>`), so the inbox can deduplicate on them.

## Actions

| Action | Chatwoot API |
|---|---|
| `reply` | `POST conversations/:id/messages`, public |
| `note` | `POST conversations/:id/messages`, private |
| `handoff` | `POST assignments` with the team (if any), then `toggle_status` → `open` |
| `add_labels` | reads the labels, then posts the union (Chatwoot replaces the list) |
| `set_attributes` | `POST custom_attributes` with `merge: true` |
| `resolve` | `toggle_status` → `resolved` |

Errors are `ChatwootApiError`, with `retryable` true for 429 and 5xx.

## Setup in Chatwoot

1. **Settings → Bots → Add bot.** Set the webhook URL to your `api` process. Chatwoot shows the bot's **access token** and **secret**.
2. **Settings → Inboxes → (inbox) → Bot configuration.** Pick the bot. New conversations then start as `pending` and are the bot's until it hands off.
3. **A user access token** for reading history (Profile settings → Access token). Chatwoot does not let bot tokens list messages. Use a dedicated user if you can. The connector never writes with this token, so the bot's replies are never attributed to a person.
4. **Team ids** for handoffs: Settings → Teams. Map your team names to ids in `teams`.

```ts
import { chatwootChannel, chatwootInbound } from "@backlabs/connector-chatwoot";

const inbound = chatwootInbound({ secret: process.env.CHATWOOT_BOT_SECRET! });

const channel = chatwootChannel({
	baseUrl: "https://chat.example.com",
	accountId: 1,
	botToken: process.env.CHATWOOT_BOT_TOKEN!,
	readToken: process.env.CHATWOOT_READ_TOKEN!,
	teams: { reception: 1, parts: 2 },
});
```

`inbound.parse` needs the **raw body**. Read it as a string before any JSON parsing, because the signature covers the exact bytes.

## Tests

`npm test` runs the unit tests and the `ChannelPort` contract against `InMemoryChannel`. To run the contract against a real Chatwoot too, set the `CHATWOOT_CONTRACT_*` variables listed in [`test/contract.test.ts`](test/contract.test.ts).
