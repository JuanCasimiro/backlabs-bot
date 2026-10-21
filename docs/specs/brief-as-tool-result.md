# Spec: a brief is the team's answer to the handoff (RT-15..17)

## Problem

RT-13 delivers a brief (`human.briefed`) to the model as a **user turn** with a text marker in front. Chat models know three voices: system, user and assistant, plus tool results. A user turn is the customer by definition of the format, so the model read the brief as *the customer claiming a price*, and, following the usual client rule "never invent prices or stock", refused to confirm it and said so to the customer. Seen live on 2026-10-21 and reproduced by a client eval. A stronger marker makes the eval pass but keeps the wrong channel: it depends on every client prompt cooperating.

The model already has a channel it treats as fact: a tool result. And a handoff *is* the bot asking the team a question. The brief is the team's answer to it.

## Scope

| ID | Behaviour |
|---|---|
| RT-15 | **The handoff waits for the team.** `handoff_to_human` interrupts the graph (LangGraph `interrupt()` inside the tool). The run still commits the `note` and `handoff` actions and switches the conversation to `human` mode, exactly as today; the thread keeps a pending interrupt at that tool call. A later `human.briefed` **resumes** the graph with the brief as the tool's result (`Command({ resume })`), rendered as the team's answer, for example `Answer from the team: sale 11 mil y hay stock`. The agent continues the same turn and answers the customer. No user turn is synthesized for a brief; `toModelMessage` stops framing human-authored messages (`FROM_THE_TEAM` goes away). |
| RT-16 | **A brief without a pending handoff.** When `human.briefed` arrives and the thread has no pending interrupt (there was no handoff, or `conversation.resolved` started a fresh memory), the runtime does not run the agent and does not touch the conversation mode: it plans a `note` for the operators with `config.texts.briefWithoutHandoff` (English default, overridable by the deployment like `fallbackText`), telling them there is nothing pending and to answer the customer themselves. |
| RT-17 | **What was said in between is in the thread.** Customer messages and human replies received while a human owned the conversation (today only forwarded to operators, RT-14) are appended to the paused thread as they arrive (`updateState` on the paused graph, no run), in order: customer messages as customer turns, human replies as **assistant turns**, because the customer received them from the bot's account, so to the conversation they are what the business said. When the brief resumes the graph, the agent sees them before it answers. |

`conversation.resolved` keeps its meaning (ADR 0007): fresh memory; a pending interrupt is discarded with the old thread. RT-14 forwarding to operators on direct channels is unchanged.

RT-05 (approval policy) will pause and resume the graph the same way; build the pause/resume plumbing so both can use it.

## Acceptance criteria (test names)

Runtime
- a handoff leaves the thread waiting for the team
- answers the customer from a brief as the handoff tool's result
- the model sees the brief as a tool result, not as a user turn
- a brief after a resolution does not run the agent and tells the operators there is no pending handoff
- a brief without any handoff does not run the agent and tells the operators there is no pending handoff
- uses the deployment's text for the brief-without-handoff note
- customer messages sent while a human owned the conversation are in the thread when the bot answers
- a human reply sent through the bot reaches the model as said by the business, not by the customer
- a customer message while the thread is paused does not discard or restart the paused run
- a resolution discards the pending handoff and starts a fresh memory
- a brief does not verify the phone and does not unlock a personal-data tool (existing, must keep passing)
- answers the customer from a brief, keeping the conversation memory (existing, must keep passing)

The RT-13 test "frames a human-authored message as coming from the team" is replaced by "the model sees the brief as a tool result, not as a user turn".

## Out of scope

- Approvals themselves (RT-05); only the shared pause/resume plumbing.
- The Chatwoot gesture for a brief (CW-04). The event is the same; a Chatwoot deployment gets RT-15..17 the day its connector emits `human.briefed`.
- Attachments in briefs or relays (text only).

## Decisions taken in implementation

- **Where the graph pauses (deviation).** Not inside `handoff_to_human`: a provider needs a result for every tool call before the next assistant turn, so the handoff call cannot stay open while the agent tells the customer "I'll pass you to someone", which the existing tests (and the customer) expect. The handoff tool answers at once as before; after `finish`, a `wait_for_team` node calls `interrupt()`. On resume that node records an assistant call to `ask_team` (a built-in name, reserved, never offered to the model) and its tool result, the brief. So the brief is still the result of the bot asking the team, in the channel models treat as fact; it is just not the result of the `handoff_to_human` call itself.
- **Tool result text:** `Answer from the team: <brief>`. Short, English; the agent's instructions set the language of the answer.
- **How the worker knows a thread is paused: it asks the graph.** `graph.waitingFor({ threadId, checkpointId })` reads `getState(...).next` at the conversation's committed checkpoint and returns `"team"` when the next node is `wait_for_team`. `next`, not `tasks[].interrupts`: appending to the thread (RT-17) makes a new checkpoint whose pending interrupt is not carried, but whose next node is still `wait_for_team`. Only conversations in `human` mode with a thread are looked up (a committed handoff always leaves them so); no flag on the conversation record.
- **Resume point: the committed checkpoint, which is the pause.** The worker's `checkpointId` is the interrupted checkpoint (or the one an append left after it), so "fork from the last committed checkpoint" and "resume from the pause" are the same point. Resuming always first appends (possibly nothing) to get a fresh child checkpoint, then invokes `Command({ resume })` from it: LangGraph keeps a run's task writes on the checkpoint it resumed from and replays them, so resuming twice from the same checkpoint would replay the first answer.
- **Discard-and-fork with a pause (RT-02).** A customer message during a resumed run discards it as usual; the brief stays pending in the inbox, the committed checkpoint is still the pause, and the next pass resumes again from it with the brief plus the new message. Appending (RT-17) runs no model, so it is never discarded; it moves the committed checkpoint forward along the paused thread.
- **What enters the thread, and where.** Messages before the brief (customer as user turns, human replies as assistant turns) are appended before the answer; customer messages after the brief in the same batch come after the tool result. Appends happen for any channel, not only direct ones; forwarding to operators (RT-14) stays direct-only.
- **One brief answers one handoff.** A second brief in the same batch, a brief after a resolution, or a brief with no handoff gets the `briefWithoutHandoff` note. A human reply after a brief in the same batch means the operator took over after all: the brief is dropped and the thread keeps waiting.
- **Text:** `BotConfig.texts.briefWithoutHandoff` (`texts` is a new optional object, so later operator-facing texts have a home); English default.
- **Shared plumbing for RT-05:** `WaitingFor` (`"team"` today), `waitingFor`, `append` and resuming from a fresh checkpoint are generic; approvals add a wait node and a value.
