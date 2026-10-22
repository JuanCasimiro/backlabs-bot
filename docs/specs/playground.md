# Spec: playground (PG-01)

## Problem

Trying a prompt change today means a real channel (Telegram, Chatwoot) and reading logs to guess why the agent did what it did. The person tuning a bot cannot see which agent answered, which tools it called, with what arguments and results, or why it handed off. Chatwoot's Captain has a playground; we need one that also shows the mechanics our runtime adds (verified identity, transfers, copilot notes, handoff mode).

## Who uses it

| Role | Needs |
|---|---|
| The developer of a client bot | Change a prompt or tool, try it in seconds, see the path the agent took |
| The business owner, sitting next to the developer | Read a conversation as the customer and as the operator would see it |

## Main flow

1. In the client repo: `npm run playground` → opens `http://localhost:4545`.
2. The page shows a chat as the customer sees it, and next to it the path of each answer: active agent, tool calls with arguments and results, transfers, notes, handoff.
3. The customer can be verified or not. When the agent asks for the phone, a "share my number" button appears, as on Telegram.
4. After a handoff the conversation is in human mode; "give back to the bot" resolves it.
5. "New conversation" reloads the client's config from disk, so an edited prompt applies at once.

## Acceptance criteria (test names)

Runtime
- inspect returns the turns of a conversation with tool calls, results and the agent that spoke
- inspect returns the mode and the verified identity of the conversation

Playground server
- serves the page
- a customer message returns the bot's reply and the path that produced it
- a verified customer reaches tools that need a verified phone
- sharing the phone verifies it for the rest of the conversation
- a handoff puts the conversation in human mode, and giving it back answers again
- a new conversation reloads the bot from its factory
- listens only on localhost

## Edge cases

- No model key: the page says so and does not start a conversation.
- The client's tools point at real systems: the page header shows what the bot is connected to (the client passes a label), so nobody mistakes demo data for real data.
- A run fails: the page shows the fallback note and handoff, as the operator would see them.

## Out of scope (next)

Saving a conversation as an eval file (EV-01), editing prompts in the browser, several people sharing one playground, streaming tokens.
