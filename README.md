# Backlabs Bot

Open-source multi-agent framework for automating customer conversations. It is CRM- and channel-agnostic: you connect it to your own inbox or CRM (Chatwoot, Zendesk, a custom one...) by implementing a small connector.

> **Status:** early design. Nothing usable yet. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Planned features

- **Multi-agent with handoffs.** A reception agent routes to specialist agents, and any agent can hand off to a human team.
- **Agents as configuration.** Each agent is a prompt, a set of tools, the agents it can hand off to, and the human team that receives its handoffs.
- **Bring your own tools.** HTTP tools and MCP servers connect your ERP, catalog or calendar without touching the core.
- **Copilot mode.** Instead of replying to the customer, an agent can prepare a brief and suggestions for the human agent. Useful where full automation is unrealistic, such as complex sales.
- **Knowledge capture.** When a conversation is resolved, structured data (outcome, reasons, entities) is extracted into a review queue.
- **Pluggable connectors.** The core never talks to a specific CRM; a connector translates its events and actions.
- **Model-agnostic.** Claude, OpenAI or local models.
- **Observability and evals.** OpenTelemetry traces (e.g. Langfuse) and conversation test sets.

## Repository layout (planned)

```
packages/core   agent loop, handoffs, tools, conversation state, connector interface
docs/           architecture and design notes
```

Connectors for specific CRMs live in the projects that use them, or in separate packages.

## License

[Apache License 2.0](LICENSE)
