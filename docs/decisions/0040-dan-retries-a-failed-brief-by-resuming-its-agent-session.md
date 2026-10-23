# 0040: Dan retries a failed brief with `agent=retry`, which resumes its agent session

- Status: Accepted
- Date: 2026-10-23

## Problem

When an [agent session](../glossary.md#agent-session) that `implement` started
exits without opening a pull request, the next tick sets `agent=failed` and adds
a note with the end of its output, keeping the worktree and the local branch
([0014](0014-implement-briefs-headlessly.md),
[0034](0034-briefs-are-aven-tasks.md)). The only ways on were queuing the brief
again, which removes the worktree and starts over from `origin/main`, throwing
the work away, or Dan resuming the agent session by hand, outside `implement`.

[Research 0008](../research/0008-continuing-failed-briefs.md) looked at why
these agent sessions exit, each way of continuing one, keeping it from exiting
with a `Stop` hook, who triggers continuing, what the continued agent session is
told, and how it fits `implement`'s states. Both real failures it studied came
from the machine: the Claude Code process that hosts every agent session was
killed for lack of memory, and an agent session's own process got a signal in
the middle of a [turn](../glossary.md#turn). Both were continued without
`implement` and finished: one by Dan at a terminal with an interactive
`claude --resume`, and the other by a script running the same
`claude --bg --resume` that `implement` runs for pull request reviews. It also
found that an idle agent session with Remote Control is retired after 8 hours,
so a brief waiting on Dan overnight is marked failed.

What needed deciding was how a failed brief is continued with its worktree,
branch and conversation: who triggers it, how `implement` continues the agent
session, what the agent session is told, and how it fits the brief's states.
This decision calls that retrying a brief, and keeps "resume" for the
`claude --resume` mechanism.

## Solution

- **Dan retries a brief by setting `agent=retry`**, such as with
  `aven edit <ref> --metadata agent=retry`. It's for a brief `implement` is
  tracking whose agent session isn't running, which in practice means one in
  `agent=failed`. Unlike queuing it again, which starts over from a fresh
  worktree, retrying keeps the worktree, the branch and the conversation.
- **Only Dan triggers it.** `implement` never retries a brief by itself, so
  there's no retry limit. Both real failures came from the machine, which would
  likely happen again on an automatic retry, and failures are rare.
- **`implement` retries by resuming the agent session** with
  `claude --bg --resume <session-id> "<prompt>"` and no other options, as it
  does for pull request reviews. The agent session keeps its session ID, the ID
  `claude stop` takes, its name, Remote Control and the hooks, since it's
  started again with the options it was first started with.
- **The retry prompt** tells the agent session:
  - that it exited before finishing, without opening a pull request, and that
    `implement` doesn't know why;
  - that background commands and [sub-agents](../glossary.md#sub-agent) from
    before are gone, though the processes of background commands may still be
    running;
  - to check the state before going on: `git status`, `git log`, whether the
    branch is pushed, and whether a pull request exists;
  - to finish what's left of the start prompt's "When you're done" steps,
    without redoing work that's already finished. Self-review still runs, since
    no pull request is open yet
    ([0030](0030-self-review-before-the-pull-request-opens.md));
  - the notes added to the task since it failed, as instructions from Dan;
  - the same Aven, escalation and GitHub sections as the start and review
    prompts.
- **Notes since the failure.** Aven notes have no author, so `implement` can't
  tell Dan's notes from its own. It records the ID of the note it adds when it
  marks a brief failed, which `aven note` prints, and passes every note added
  after that one.
- **States.** A retried brief moves from `agent=retry` to `agent=working`, and
  `implement` adds a note saying it was retried. It takes a concurrency slot,
  after review resumes and before queued briefs, and gets the same grace period
  after launching as a new or resumed agent session before `implement` counts it
  as exited. If it exits again without a pull request, it's marked
  `agent=failed` again with a new failure note, and Dan can retry it again.
- **When it can't be retried.** If `implement` has no session ID for the brief,
  or the resume command fails, the brief goes back to `agent=failed` with a note
  saying why. The worktree is kept. `implement` doesn't fall back to a new agent
  session.
- **`agent=retry` on a brief `implement` isn't tracking**, such as one that was
  never started or was let go, has `agent=retry` removed and gets a note saying
  there's nothing to retry and to set `agent=queued` to start it.
  **`agent=retry` while its agent session is still running** waits until it
  exits, as queuing again does.
- **The failure note says how to go on**: add a note with anything the agent
  session should know and set `agent=retry` to resume it where it stopped, or
  set `agent=queued` to start over.
- **Waiting on Dan.** An idle agent session with Remote Control is retired after
  8 hours, so a brief in `agent=needs-input` overnight is marked failed.
  Retrying it with Dan's answer in a note is how Dan answers it.

This amends [0034](0034-briefs-are-aven-tasks.md), which lists the values of the
`agent` metadata, with the new value `retry`. Queuing a failed brief again still
starts over from a fresh worktree. It also amends
[0014](0014-implement-briefs-headlessly.md): `implement` resumes an agent
session when Dan retries its brief, as well as when its pull request gets a
review.

## Tradeoffs

Benefits:

- Keeps the work and the conversation, which queuing again throws away.
- Cheap when retried within an hour of the agent session's last request, while
  the prompt cache holds the conversation.
- Reuses the resume `implement` already runs for pull request reviews.
- Dan decides from the failure note, from wherever Dan uses Aven, and can add
  instructions in a note.
- Covers briefs in `agent=needs-input` whose agent sessions were retired while
  waiting on Dan.

Costs:

- Waits for Dan. After an hour, the first request writes the whole conversation
  to the prompt cache again: 274k tokens for one real brief retried after 93
  minutes.
- Relies on the options Claude Code saves for an agent session, which aren't
  documented, and keeps the model the agent session started on, even if
  `.claude/settings.json` has changed since
  ([0028](0028-the-project-defines-how-agent-sessions-work.md)).
- A new `agent` value to learn.
- The conversation keeps whatever confused the agent session before.
- It doesn't keep agent sessions from exiting, and can't help when there's no
  session ID.

## Follow-up design choices

- **Retrying automatically.** Whether `implement` should retry a brief by
  itself, with a limit, once the causes of failures are better known, and how it
  would tell the causes apart.
- **A `Stop` hook.** Whether a `Stop` hook should keep agent sessions from
  ending a turn without a pull request.
- **A new agent session.** Whether to start a new agent session in the kept
  worktree when the conversation can't be resumed.
- **Waiting on Dan.** How to keep an agent session waiting on Dan from being
  retired after 8 hours.
