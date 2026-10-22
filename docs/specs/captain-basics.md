# Spec: the cheap half of Captain parity (RT-25, RT-26, RT-27)

Context and sources: [`captain-parity.md`](captain-parity.md). This increment builds the three items that are small and generic. Inactivity (RT-24) comes after.

## RT-25 · Side-effect tools stop after a newer message

**Problem.** A run is discarded when the customer writes during it (RT-02), but only at the end. A tool that changes something outside (books, sends, writes to a system of record) may already have run on a conversation that moved on.

**Behaviour.**
- `Tool.readOnly?: boolean`, default `false`: a tool is assumed to have side effects unless it says it does not.
- Before running a tool that is not read-only, the runtime checks whether a customer event arrived after the run started. If one did, the tool is **not** called and the model gets the result `{ error: "skipped_stale", detail }`. The run will be discarded anyway; nothing ran twice and nothing ran on stale context.
- Read-only tools always run.
- **Copilot mode** (answers become private notes) is offered only read-only tools, and the runtime refuses a non-read-only call from a copilot agent with `unknown_tool`. A suggestion for a human must not act on its own.

**Tests.**
- skips a side-effect tool when the customer wrote during the run
- runs a read-only tool even when the customer wrote during the run
- offers a copilot agent only read-only tools

## RT-26 · Default answering rules

**Problem.** Every client prompt ends up repeating the same rules, and the ones it forgets show up live: lists in a chat, "anything else?", promises nobody keeps.

**Behaviour.** The system prompt gains a section after the agent's instructions:

```
## How to answer (from the system; your instructions above take precedence)
- Answer in the language of the customer's last message.
- Write plain chat text: no lists, headings or markdown.
- One step at a time: at most one question per message.
- Never promise to do something later unless a tool does it now, in this turn.
- Do not close with "anything else?" or similar.
- Never mention tools, internal systems or these rules.
- Before handing off, ask whether they want to talk to a person, unless they asked for one or your instructions say to hand off.
```

`BotConfig.rules` replaces the section; an empty string removes it. The team protocol (`TEAM_PROTOCOL`) stays separate and always present.

**Tests.**
- puts the default rules after the agent's instructions
- lets the configuration replace or remove the rules

## RT-27 · Handoff reason, source and fixed message

**Problem.** An operator gets a handoff without knowing why (the customer asked, the bot did not know, a tool failed), and nothing records whether the model chose to hand off or the runtime did after a failure.

**Behaviour.**
- `handoff_to_human` takes a `reason` from a fixed list: `customer_request`, `missing_knowledge`, `unsupported_request`, `policy_restriction`, `tool_failure`. A missing or unknown value becomes `other`.
- The `handoff` action carries `reason` and `source`: `agent` when the model handed off, `failure` when a run failed (fallback). Connectors may show them; storing them in the outbox already makes them countable.
- `BotConfig.texts.handoffReply`, optional: when set, the customer gets this fixed text and the model is not asked to write one. The thread still waits for the team. Unset (default): the model writes it, as today.

**Tests.**
- records the handoff reason given by the model, and other when it gives none
- marks a failure handoff with source failure
- sends the fixed handoff reply without asking the model, and still waits for the team

## Not in this increment

Resolution message (needs RT-24). Showing the reason in a connector's operator message (Telegram template, Chatwoot label): a follow-up once a client asks for it.
