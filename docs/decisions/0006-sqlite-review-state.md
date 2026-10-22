# 0006: Review state is stored in SQLite

- Status: Accepted, amended by
  [0010](0010-user-prompts-agent-to-fetch-review.md),
  [0018](0018-agents-list-open-comments.md), and
  [0036](0036-the-reviewer-submits-reviews-and-the-agent-gets-a-review-message.md)
- Date: 2026-10-10

> **Amended by [0010](0010-user-prompts-agent-to-fetch-review.md):** the review
> server no longer sends messages to agents, so there's no delivery status to
> store.

> **Amended by [0018](0018-agents-list-open-comments.md):** the database holds
> comments with their statuses, and archived review sessions. There are no
> drafts, reviews, or claims to store, and review sessions are archived or
> deleted with `agent-diff session archive` and `agent-diff session delete`.

> **Amended by
> [0036](0036-the-reviewer-submits-reviews-and-the-agent-gets-a-review-message.md):**
> the database holds drafts, reviews, replies, and each review message's
> delivery state again.

## Problem

Several things can die during a review: the agent session, the review server, or
the browser tab. None of them should lose the reviewer's work. Draft comments,
submitted reviews, and the agent tree all need to survive a restart so the
review can pick up where it left off.

## Solution

The review server stores review state in a SQLite database file. When the server
restarts, it reloads that state, so the reviewer can reopen the UI with drafts
intact and an agent can fetch feedback again.

The database holds the state the app creates:

- Registered agents, the agent tree, and each agent's working directories and
  how to notify it ([0004](0004-agent-tree-is-an-input.md)).
- Review sessions, their working directories, the reviews submitted to them, and
  claims ([0009](0009-review-sessions-and-claims.md)).
- Comments, both drafts and submitted, with their anchors (file, line range,
  diff side, and the commit or snapshot they were written against).
- Delivery status for feedback notifications
  ([0005](0005-notify-then-pull-feedback.md)).

Code stays in git. Diffs are computed from the repos, not copied into the
database.

## Tradeoffs

Benefits:

- Reviews survive crashes and restarts of the agent, the server, or the browser.
- It's a single embedded file, with no database service to install or run.
- Writes are transactional, so a crash can't leave a review half-saved.
- One database can hold reviews that span several repos.
- Threads, statuses, and reviews are easy to query, which helps with agent
  replies (see "Future ideas" in the README).
- The file is easy to inspect, back up, or delete.

Costs:

- SQLite allows only one writer at a time. That suits one server process owning
  the database, but several processes writing to it at once would contend (see
  the server question in [0001](0001-local-web-app.md)).
- The schema needs migrations as the app changes.
- Old reviews pile up unless there's a retention policy.
- Comments refer to commits and snapshots in git. If those are rebased away or
  garbage collected, the comments lose their anchor even though the database
  still has them.
- State is local to one machine and isn't shared between machines.

## Follow-up design choices

- **Location.** Where the database file lives, for example one per user in the
  user's data directory, or one per repo.
- **Ownership.** Whether exactly one server process owns the database, or
  several processes share it (WAL mode and locking).
- **Reconnecting agents.** How an agent that restarts in a new agent session
  reclaims its previous record, so feedback and history carry over.
- **Saving drafts.** Whether drafts save on every edit or periodically.
- **Retention.** When old reviews are archived or deleted.
- **Turn snapshots.** Whether "last turn" snapshots live in git (for example as
  hidden refs) with only references in the database, or in the database itself.
