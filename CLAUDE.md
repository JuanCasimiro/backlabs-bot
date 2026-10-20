# Backlabs Bot — instructions for coding agents

Open-source, CRM- and channel-agnostic framework for multi-agent customer conversations. Apache-2.0. Read before changing anything:

1. `docs/ARCHITECTURE.md` — the shape of the system and the three layering rules.
2. `docs/adr/` — one file per decision that is expensive to reverse. A new decision of that kind gets a new ADR **before** the code.
3. `ROADMAP.md` — what is done, what is next, and the decision log. Keep it current in the same commit as the code.

## Layering rules (enforced, not advisory)

- **The domain (`packages/core`) imports nothing** from LangGraph, adapters or the database. Plain TypeScript + zod.
- **Adapters (`packages/connector-*`, `packages/tools-*`) do not know LangGraph exists.** They implement ports from `@backlabs/core` and nothing else.
- **LangGraph is used directly in `packages/runtime`**, never hidden behind a generic "runtime" port. It reaches the outside only through ports.
- The model provider is not a port of ours: `@langchain/core` chat models already abstract it.

## How we build, by layer

| Layer | Method |
|---|---|
| Runtime mechanics (inbox dedup, per-conversation lock, outbox idempotency, task leases, approval policy, config validation) | **Test first.** A bug here is a duplicate or lost message. |
| Adapters | **Contract tests.** Run `channelContract` from `@backlabs/testing` against the in-memory adapter and the real one. |
| Agent behaviour (prompts, skills, handoffs) | **Eval first.** Add the recorded conversation that shows the problem before touching a prompt. |
| Design decisions | **ADR first**, then code. |

## What never goes in this repo

Client prompts, client tool packs, evals built on real conversations, API keys, customer or candidate data, and client names. Each client is a private `<client>-bot` repo that depends on these packages (ADR 0005). If a change only makes sense for one client, it belongs there, not here.

## Working in the repo

```bash
npm install
npm run check      # typecheck + lint + tests — must pass before every commit
```

Runtime tests need Postgres: set `TEST_DATABASE_URL` (see `CONTRIBUTING.md`), or they are skipped. CI runs them against a Postgres service.

Repo skills in `.claude/skills/`: `sdd` (spec or ADR first), `tdd` (runtime and adapters), `clean-code`, `new-connector`, `agent-eval`.

- Node ≥ 24, TypeScript runs directly (no build step, `.ts` imports with extension).
- Formatting and lint: Biome (tabs). `npm run format` fixes formatting.
- On Windows with `core.autocrlf=true`, `biome check` reports format errors on every file because of CRLF; typecheck and tests are unaffected. Prefer `git config core.autocrlf false` for this clone.
- Code, comments, docs and commit messages in English.
- Every outbound action carries an `idempotencyKey`; every inbound event carries a stable `eventId`. Do not invent either at the edge: they come from the run/step and from the source system.
- Tools report observations with their source, never confidence, and never send customer message bodies to third-party services.
- Secrets only in `.env` (gitignored). A leaked token is revoked, not just removed from history.

## Open-source hygiene

`TODO.md` lists what is still missing for contributions (CI, `CONTRIBUTING.md`, branch ruleset). Until CI exists, `npm run check` locally is the gate.
