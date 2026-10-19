# Backlabs Bot

Open-source multi-agent AI for customer conversations, built to plug into any **[Chatwoot](https://github.com/chatwoot/chatwoot)** instance (including the free Community edition) without forking it.

> **Status:** early design. Nothing usable yet. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Why

Chatwoot is a great open-source inbox, but its AI layer (Captain) is an Enterprise feature. Backlabs Bot is an independent, open alternative that talks to Chatwoot through its public **Agent Bot webhook** and **REST API**. It is not based on Chatwoot's Enterprise code.

## Planned features

- **Multi-agent with handoffs.** A reception agent routes to specialist agents, and any agent can hand off to a human team.
- **Agents as configuration.** Each agent is a prompt, a set of tools, the agents it can hand off to, and the Chatwoot team that receives its human handoffs.
- **Bring your own tools.** HTTP tools and MCP servers connect your ERP, CRM, calendar or catalog without touching the core.
- **Copilot mode.** Instead of replying to the customer, an agent can prepare a brief and suggestions as a private note for the human agent. Useful where full automation is unrealistic, such as complex sales.
- **Knowledge capture.** When a conversation is resolved, structured data (outcome, reasons, entities) is extracted into a review queue.
- **Model-agnostic.** Claude, OpenAI or local models.
- **Observability and evals.** OpenTelemetry traces (e.g. Langfuse) and conversation test sets.
- **Privacy-first defaults.** Self-hosted, with no telemetry.

## Repository layout (planned)

```
packages/core       agent loop, handoffs, tools, conversation state
packages/chatwoot   Chatwoot adapter (webhook receiver + API client)
chatwoot-local/     docker-compose to run Chatwoot locally for development
docs/               architecture and design notes
```

## Local Chatwoot for development

Requires Docker with virtualization enabled.

```bash
cd chatwoot-local
cp .env.example .env   # fill in the secrets
docker compose run --rm rails bundle exec rails db:chatwoot_prepare
docker compose up -d   # http://localhost:3001
```

## License

[Apache License 2.0](LICENSE)
