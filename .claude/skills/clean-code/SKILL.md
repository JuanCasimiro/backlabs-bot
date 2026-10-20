---
name: clean-code
description: Code conventions for Backlabs Bot and the client repos built on it — naming, function size, errors, boundaries, zod at the edges, comments, dependencies. Use while writing or reviewing any TypeScript in these repos, and when the user asks for "clean code" or "best practices".
---

# Clean code here

Match the code that is already there: it is the style guide. These are the rules it follows.

## Shape

- **Layering is law** (`docs/ARCHITECTURE.md` §1): `packages/core` imports only zod; adapters import `@backlabs/core` and never LangGraph; LangGraph lives in `packages/runtime` and reaches out only through ports.
- **Parse at the edge, trust inside.** External input (webhooks, API responses, env, client config) goes through a zod schema once; inner code takes typed values and does not re-validate.
- **Functions do one thing** and read top-down: the public function first, helpers below it. Prefer a small pure function over a method with state.
- **Dependencies are passed in** (`fetch`, `now`, `pool`, `model`): no module-level singletons, no reading `process.env` outside the composition root (`main.ts`).
- **No `any`, no non-null `!`** unless the invariant is stated next to it. Use discriminated unions and exhaustive `switch`.

## Reuse before you create

- **Search first.** Grep for the concept (and its synonyms) before adding a function, type or package. If something close exists, extend it.
- **One source of truth per rule.** A business rule, a mapping or a constant lives in one place.
- **Extract on the second copy**, not the first: by then you know what varies. Equivalent logic in two files is fixed before merging.
- **Do not abstract speculatively.** No interface, option or flag "in case we need it later"; a port exists because there are two real implementations (or one plus a test double). Three duplicated lines are cheaper than the wrong abstraction.
- **Size signals:** a function over ~40 lines or doing "and also…", a file over ~300 lines or mixing layers, more than 4 parameters (pass a named object instead).
- **No N+1:** never one `await` per row in a loop against the database; batch it.

## Names

- Domain words over technical ones: `handoff`, `conversation`, `verifiedPhone`, not `data`, `info`, `obj`.
- Booleans read as questions: `isStale`, `phoneVerified`. Functions are verbs: `claimConversation`, `planActions`.
- Same concept, same name across packages.

## Errors

- Fail loudly at boot (invalid config refuses to start). At runtime, errors carry what failed and whether retrying can help (`retryable`), like `ChatwootApiError`.
- Never swallow an error silently. If it is expected and ignorable, say why in one line.
- Tools return observations (`{ ok: false, reason }`) for things the model should react to; they throw only for bugs and outages.

## Comments

- Explain **why** or the invariant, never restate the code. The doc comment on an exported symbol says what a caller must know (units, ordering, idempotency).
- Link the ADR when code exists because of one.

## Hygiene

- English in code, comments, docs and commits of the public repo. No client names, prompts or data in it (`CLAUDE.md`).
- Pin exact dependency versions; prefer a release that has been out for a while; add a dependency only when it removes real code.
- Biome formats (tabs, double quotes). `npm run check` before every commit.
- Commits: imperative subject ≤ 72 chars, body says why. No AI attribution lines.
