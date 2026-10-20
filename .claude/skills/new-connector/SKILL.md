---
name: new-connector
description: Build or change a channel connector (packages/connector-*) for Backlabs Bot — inbound parsing to domain events, ChannelPort actions, verified identity, and the contract suite. Use when adding a channel (Telegram, WhatsApp, web, email) or changing how one maps events or actions.
---

# Writing a connector

A connector translates one channel to the domain. It imports `@backlabs/core` (and zod) and nothing from the runtime or LangGraph.

## Checklist

1. **Inbound (`InboundChannel.parse`)**: verify authenticity first (signature or secret header) over the raw body; then parse with zod; return `{ ok: true, event: null }` for genuine requests that are not for the bot (echoes of the bot's own messages, private notes, service updates).
2. **`eventId` comes from the source**: an id that is identical when the same thing is delivered twice (message id, update id). Never a random id or a timestamp of reception.
3. **Identity (ADR 0006)**: set `contact.phoneVerified: true` only when the channel proves the number. A number in message text is never verified.
4. **Actions (`ChannelPort.perform`)**: implement all action types with an exhaustive `switch`. When the channel has no equivalent, follow ADR 0007 (operator chat, or a documented no-op). Errors expose `retryable`.
5. **Tests**: recorded payloads as fixtures (anonymised: fake names, `example.test` domains, no real numbers), a fake `fetch` that records calls, and `channelContract` run against the connector with a fake API.
6. **README** in the package: what is supported, configuration, what is not mapped.
7. **Roadmap**: add the row to Done in the same commit.
