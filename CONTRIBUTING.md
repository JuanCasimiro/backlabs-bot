# Contributing

Thanks for taking the time. Backlabs Bot is small and opinionated; the fastest way to land a change is to follow the shape of the repo. Read [`CLAUDE.md`](CLAUDE.md) (it is for humans too), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`ROADMAP.md`](ROADMAP.md) first.

## Setup

Node 24. TypeScript runs directly, there is no build step.

```bash
npm install
npm run check   # typecheck, lint, tests — must pass before you open a PR
```

Runtime tests run against a real Postgres and are skipped without one:

```bash
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
```

Any Postgres 16 works (`docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16`). Each test file creates and drops its own schema.

On Windows, set `git config core.autocrlf false` before cloning (or re-checkout): Biome expects LF and will otherwise flag every file.

## How changes land

- Only maintainers push to `main`. Everyone else: **fork → branch → pull request**.
- CI runs `npm run check` on every PR. One approving review is required to merge. Force pushes and deletion of `main` are blocked.
- Keep PRs small and single-purpose. Say what changed and why, and link the roadmap item or ADR it belongs to.
- Update `ROADMAP.md` in the same PR when you finish or add an item.

## What to do, by layer

| You are changing | Do this first |
|---|---|
| Runtime mechanics (inbox, locks, outbox, task leases, approvals, config validation) | Write the failing test. A bug here is a duplicate or lost message. |
| A connector or tool adapter | Run `channelContract` from `@backlabs/testing` against your adapter and against `InMemoryChannel`. |
| A prompt, skill or handoff | Add the recorded conversation (eval) that shows the problem. The change is done when it passes and the others still do. |
| A decision that is expensive to reverse | Write an ADR in `docs/adr/` before the code. |

## Ground rules

- The domain (`packages/core`) imports nothing from LangGraph, adapters or the database. Adapters do not know LangGraph exists.
- No client prompts, client tools, real conversations, tokens or personal data in this repo. Never commit `.env`.
- Code, comments, docs and commit messages in English.
- Formatting is Biome's (`npm run format`).
- By contributing you agree that your contribution is licensed under the [Apache License 2.0](LICENSE).

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting on this repository if it is enabled; otherwise contact the maintainer through their GitHub profile.
