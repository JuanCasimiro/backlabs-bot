# Backlabs Bot

Open-source multi-agent framework for automating customer conversations. It is CRM- and channel-agnostic: you connect it to your own inbox or CRM (Chatwoot, Zendesk, a custom one...) by implementing a small connector.

> **Status:** early, working end to end. Done: domain and ports (`packages/core`), the runtime (`packages/runtime`: inbox, worker, LangGraph agents, outbox on Postgres), connectors for Chatwoot and Telegram, verified identity by phone, copilot mode, and the test kit. See [`ROADMAP.md`](ROADMAP.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Development

Requires Node 24 (TypeScript runs directly, no build step) and, for the runtime tests, a Postgres 16 in `TEST_DATABASE_URL`.

```bash
npm install
npm run check   # typecheck, lint, tests
```

## Features

- **Multi-agent with handoffs.** A reception agent transfers to specialist agents, and any agent can hand off to a human team.
- **Agents as configuration.** Each agent is a prompt, a set of tools, the agents it can transfer to, and the human team that receives its handoffs. The configuration is validated at boot.
- **Exactly one coherent answer.** Webhook retries, bursts of messages and crashes are absorbed by a transactional inbox and outbox in Postgres; a reply is never sent twice by the bot, and a reply based on a stale conversation is discarded.
- **Verified identity.** Tools that read a customer's own records get the phone number the channel proved (WhatsApp sender, a Telegram contact shared by its owner), never one the customer typed. An optional access list keeps a bot private.
- **Copilot mode.** Instead of replying to the customer, an agent prepares a brief and suggestions for the human agent. Useful where full automation is unrealistic, such as complex sales.
- **Pluggable connectors.** The core never talks to a specific CRM; a connector translates its events and actions. Chatwoot and Telegram today, each proven by the same contract suite.
- **Model-agnostic.** Any `@langchain/core` chat model with tool calling: Claude, OpenAI or local models.

## Planned

- Tool packs for HTTP endpoints and MCP servers, so an ERP, catalog or calendar connects without code.
- Per-tool approval by a human before an action runs.
- Follow-ups the agent schedules for itself.
- Knowledge capture into a review queue when a conversation is resolved.
- OpenTelemetry traces and an eval harness.

## Repository layout

```
packages/core            domain types and ports: events, actions, agent config
packages/runtime         LangGraph orchestration, worker, inbox/outbox, task queue, approvals
packages/connector-*     channel adapters: Chatwoot, Telegram
packages/testing         in-memory channel and the adapter contract suite
docs/                    architecture and ADRs
```

Each client project is a separate repo with its agents, prompts, tool packs and evals, deployed on its own. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/adr/`](docs/adr/).

## License

[Apache License 2.0](LICENSE)
