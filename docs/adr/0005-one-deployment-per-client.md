# 0005 — One deployment per client

**Status:** Accepted

## Context

Backlabs Bot is the base for bots we build for different clients (a car workshop, a recruiting firm). Their data includes personal information (customers, candidates), and each has its own agents, tools and integrations. A multi-tenant runtime would need tenant isolation in every table, query, queue and log.

## Decision

Each client gets its own deployment: `api` + `worker` + Postgres, built from a private `<client>-bot` repo that depends on the public packages and contains only configuration, prompts, skills, client tool packs and evals.

The runtime has no tenant or organization concept.

## Consequences

- Data isolation comes from the infrastructure, not from code that can get a `WHERE` wrong.
- No tenant columns, filters or permission checks in the core.
- Operating many clients means many deployments; upgrades are a dependency bump per client repo.
- Revisit if we ever offer a hosted, self-serve product.
