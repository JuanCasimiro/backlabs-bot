# 0006 — Verified identity comes from the channel, never from the model

**Status:** Accepted

## Context

Many bots answer questions about the customer's own records: the state of their car's repair order, their appointment, their application. Systems of record usually key those records by phone number, and WhatsApp-style channels deliver the sender's number already verified by the network. The tempting shortcut is a tool like `order_status(phone)`. Then anyone can type "my number is +54 9 11 …" and the model passes it along: the bot leaks another person's data, and no prompt reliably prevents it.

Not every channel proves the phone number. WhatsApp does. Telegram does only if the user shares their own contact. Web chat and email never do.

## Decision

- `Contact` carries `phone` plus `phoneVerified`. Only a connector sets `phoneVerified: true`, and only when the channel itself proves the number (WhatsApp sender id; a Telegram contact shared by its owner). A number the customer types is just text.
- The runtime keeps the verified identity per conversation. Once a channel proves a number, later events of that conversation keep it.
- Tools receive the identity from the runtime as **context**, not as model arguments. A tool that reads personal data declares `requires: "verified_phone"`. If the conversation has no verified phone, the runtime does not call it: the model gets an observation saying identity is not verified, and can ask the customer to verify.
- A domain action `request_phone` asks the customer to prove their number. Each channel implements it the way it can (Telegram: a "share my number" button). Channels where the number is always verified, or never can be, fall back to sending the text.
- Optional **access list** per deployment: when set, only verified numbers on the list get the agent. Everyone else gets the verification request or a fixed refusal, without spending a model call. Useful for pilots and private bots.

## Consequences

- A tool cannot be tricked into reading somebody else's records by what the customer writes. The guarantee lives in code and tests, not in a prompt.
- Tool authors must not add `phone` as a model-facing parameter of a personal-data tool. Reviews check this.
- Identity is only as strong as the channel. A phone number is "possession of a SIM or account", not a legal identity. Clients that need more (an ID number, a code sent by SMS) add it as another verification step on top.
