---
name: agent-eval
description: Eval-first workflow for agent behaviour (prompts, skills, handoffs, tool choice) in Backlabs Bot client repos — record the conversation that shows the problem, assert on emitted actions, then change the prompt. Use before touching any prompt or agent config, and when a conversation went wrong.
---

# Eval first

A prompt change is done when the eval that shows the problem passes and the others still do.

1. **Capture the case** as a scripted conversation: the customer turns, the contact identity (verified phone or not), and the tool results the fake tools will return. Anonymise: invented names, plates and numbers.
2. **Assert on actions, not wording**: "handed off to team X", "called `order_status`", "did not call a personal-data tool without a verified phone", "reply mentions the order number". Use a regex or a list of required facts for text, never an exact string.
3. **Run against the real model** (evals need the provider key; they are skipped without it). Run each new eval a few times: a flaky eval is a vague prompt.
4. **Then** change the prompt or config, and run the whole suite.
5. Evals built on real conversations live only in the private client repo, never in `backlabs-bot`.
