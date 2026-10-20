---
name: sdd
description: Spec-driven development for Backlabs Bot — decide whether a change needs an ADR, a roadmap spec with acceptance criteria, or an eval, and write it before the code. Use when starting a feature, a new package, a new port or domain type, or any change that is expensive to reverse; and when the user says "SDD", "spec first", "ADR".
---

# Spec before code

The repo already says which artefact comes first for each kind of change (`CLAUDE.md`, "How we build, by layer"). This skill is the checklist.

## 1. Classify the change

| The change… | Write first |
|---|---|
| Adds or changes a **port**, a **domain type** (`packages/core`), a **process** or table the runtime depends on, a dependency that is hard to remove, or how identity/privacy work | **ADR** in `docs/adr/NNNN-title.md` + row in `docs/adr/README.md` |
| Adds a feature inside the existing shape (a tool pack, a connector, a runtime behaviour) | **Roadmap row** with an ID and **acceptance criteria** written as tests-to-be (see 3) |
| Changes what an agent says or decides | **Eval** (skill `agent-eval`) |
| A bug | The failing test (skill `tdd`) |

If unsure whether it is "expensive to reverse": would undoing it touch more than one package or a client repo? Then ADR.

## 2. ADR shape

Short. `# NNNN — <decision as a sentence>`, `**Status:** Accepted`, then **Context** (the forces, with the failure it prevents), **Decision** (bullets, concrete names), **Consequences** (good and bad, including what we now must not do). A superseded ADR stays, linked to its replacement.

## 3. Acceptance criteria

Write them as the test names you will implement, in Given/When/Then if it helps:

```
RT-01 Inbox
- a new event is stored and the webhook answers 200
- the same eventId delivered twice is stored once
- the handler never runs an agent
```

These go into the roadmap row or the PR description, then become the `it(...)` names.

## 4. Keep the record

Same commit as the code: `ROADMAP.md` (move the row to Done with where it lives), `docs/ARCHITECTURE.md` if the shape changed, the ADR index.
