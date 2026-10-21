# 0035: A queued brief waits until the tasks it depends on are done

- Status: Accepted
- Date: 2026-10-21

## Problem

`implement` started queued briefs oldest first, up to the concurrency limit
([0014](0014-implement-briefs-headlessly.md),
[0034](0034-briefs-are-aven-tasks.md)). A brief that builds on another brief's
changes had to be queued by hand once the other one was merged, or it would
start from an `origin/main` without them. Aven already records dependencies
between tasks, with `aven dep add <ref> <blocker ref>`, and Dan wants to queue
several briefs at once and have each start only when the briefs it builds on are
finished, while briefs that don't depend on each other still run in parallel.

What needed deciding was which blockers hold a brief back, what happens when a
blocker will never be finished, and what the agent session is told about its
blockers.

## Solution

- **Blockers come from Aven.** `aven show <id> --full --json`, which `implement`
  already runs for every queued task, lists the task's blockers under
  `dependencies.depends_on`, each with its `ref`, `id`, `title`, `status`, and
  `deleted`. A blocker can be any task: a brief, a manual task, or a task in
  another project. This was checked on Aven 0.1.50.
- **Only `done` unblocks.** Aven counts a blocker as resolved when it's `done`,
  `canceled`, or deleted, in `unresolved` and `depends_on_open`. `implement`
  doesn't read those, only each blocker's `status` and `deleted`.
- **Each queued brief is checked in this order**, oldest first:
  1. A brief missing a required field is sent back, as before.
  2. A brief with a `canceled` or deleted blocker is sent back: `implement`
     removes `agent=queued` and adds a note naming each such blocker, with the
     command that removes the dependency, `aven dep remove <ref> <blocker ref>`,
     and says to set `agent=queued` again. Such a blocker will never be `done`,
     so waiting on it would hold the brief forever. This applies even when the
     brief has other blockers that are still open.
  3. A brief with any other blocker that isn't `done` waits. It keeps
     `agent=queued`, gets no note, and uses no concurrency slot, and the tick
     logs `<ref>: waiting on <blocker refs>`. The briefs after it take the free
     slots.
  4. Any other brief starts as before.
- **A brief starts from a base with its blockers' changes.** Each tick reaps
  before it starts briefs, and starting a brief fetches `origin/main`. When a
  blocker's pull request merges, the tick that sets the blocker to `done` starts
  the brief it was blocking.
- **The start prompt lists the blockers.** A brief with blockers gets a section
  listing each one's ref and title, saying they're done, and that the agent
  session can read them with `aven context <ref>` but must not change them.
  Their refs and IDs are kept off GitHub, the same as the brief's own. A brief
  without blockers gets the same start prompt as before.
- **`implement status`** lists the queued briefs that are waiting, each with the
  blockers that aren't done.
- **What's unchanged.** There's no new `agent` state: a waiting brief stays
  `agent=queued`. `implement` never changes a blocker, such as queuing one that
  isn't queued. A brief never starts from another brief's branch, or while one
  of its blockers is in review, so pull requests aren't stacked. Dependencies
  added after a brief starts don't affect it. Aven refuses dependency cycles, so
  `implement` doesn't look for them.

## Tradeoffs

Benefits:

- Dan can queue a chain of briefs at once, and each starts as soon as what it
  builds on is merged, with no one watching.
- Briefs that don't depend on each other still run in parallel, and a waiting
  brief doesn't take a slot.
- Dependencies are recorded in Aven, where Dan already sees them, rather than in
  the brief's text.

Costs:

- A brief waits for its blockers' pull requests to be merged, not just opened,
  so a chain of briefs runs one after another, with a review in between.
- A blocker that's canceled, or that Dan deletes, sends the brief back, and Dan
  has to remove the dependency and queue the brief again, even when the brief no
  longer needs the blocker's changes.
- Nothing tells Dan a brief is waiting except the tick's log and
  `implement status`.
- `implement` depends on more of `aven`'s `--json` output, which may change.

## Follow-up design choices

- **Stacked pull requests.** Whether a brief could start from its blocker's
  branch while the blocker is in review.
- **Queuing blockers.** Whether queuing a brief should queue the blockers that
  aren't queued yet.
- **Notifications.** Whether Dan should be told when a brief has been waiting a
  long time, such as on a blocker that's a manual task.
