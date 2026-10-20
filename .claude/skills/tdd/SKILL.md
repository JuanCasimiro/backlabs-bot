---
name: tdd
description: Test-driven development for Backlabs Bot runtime mechanics and adapters — inbox dedup, per-conversation lock, outbox idempotency, task leases, approval policy, identity gate, config validation, connector parsing. Use before writing or changing any of that code, when fixing a bug in it, or when the user says "TDD", "test first", "write the test".
---

# TDD in Backlabs Bot

A bug in runtime mechanics is a duplicate message, a lost message, or another customer's data. Those are the cases tests must pin down **before** the code exists.

## Loop

1. **Red.** Write one test that states one behaviour in its name, as a sentence about the system: `"a duplicate webhook does not create a second inbox row"`. Run it, see it fail **for the right reason** (not an import error).
2. **Green.** Write the least code that passes. No speculative options.
3. **Refactor.** Remove duplication, improve names, keep tests green. Then the next behaviour.

Run `npm test -- <file>` while iterating and `npm run check` before every commit.

## What to test, where

| Code | Test against | Never |
|---|---|---|
| SQL, locks, leases, outbox (`packages/runtime/src/store`) | **Real Postgres** (`DATABASE_URL` / `TEST_DATABASE_URL`). Each test file gets its own schema; the suite is skipped, not faked, when no database is set | mocking `pg` — the bug lives in the SQL |
| Graph and worker (`packages/runtime`) | `ScriptedChatModel` + `InMemoryChannel` from `@backlabs/testing` | calling a real model in unit tests |
| Connectors (`packages/connector-*`) | Recorded payloads as fixtures + a fake `fetch`; plus `channelContract` | hitting the real API in CI |
| Domain (`packages/core`) | Plain values | — |

## Rules

- **In-memory implementations over mocks.** Implement the port in memory (`InMemoryChannel`, a fake tool, a scripted model) instead of asserting which methods were called; it tests behaviour and survives refactors.
- **Builders for test data** (`message({...})`, `event({...})`): never rebuild the same fixture inline twice.

- **One behaviour per test**; arrange–act–assert, separated by a blank line.
- Assert on **observable outcomes**: rows in the outbox, actions performed on the channel, the event returned. Not on private calls.
- Concurrency claims get a concurrency test: two workers, one conversation, one run.
- Time is injected (`now`), never read from the clock inside the logic under test.
- A bug fix starts with the test that reproduces it.
- Do not weaken, skip or delete a failing test to get green. If the test is wrong, say why in the commit.
