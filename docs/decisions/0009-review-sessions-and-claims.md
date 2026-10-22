# 0009: Reviews are submitted to sessions, and agents claim feedback per working directory

- Status: Accepted, amended by
  [0010](0010-user-prompts-agent-to-fetch-review.md),
  [0013](0013-working-directories.md), and
  [0018](0018-agents-list-open-comments.md)
- Date: 2026-10-10

> **Amended by [0010](0010-user-prompts-agent-to-fetch-review.md):** no agents
> are told when a review is submitted. The reviewer prompts an agent, which
> claims a working directory and fetches the most recent review.

> **Amended by [0013](0013-working-directories.md):** a working directory is
> just a directory, and may not use git. The branch is whatever `HEAD` points to
> rather than part of what's reviewed.

> **Amended by [0018](0018-agents-list-open-comments.md):** there are no reviews
> or claims. The reviewer leaves comments in a session, an agent lists the open
> ones and marks each one addressed, and the reviewer decides which agent works
> where. Sessions are archived or deleted rather than ended.

## Problem

Agents often change several repos at once, so the app needs a clear answer to
what one review covers: everything, one agent's work, or one repo.

Earlier, a review was scoped to a node of the agent tree
([0004](0004-agent-tree-is-an-input.md)), and feedback went to the agent that
made the changes ([0005](0005-notify-then-pull-feedback.md)). That ties reviews
to agents, which leaves gaps:

- A human can't review plain repos that no agent registered.
- Feedback for an agent that has exited has nowhere to go.
- An agent that restarts in a new agent session can't easily pick up its old
  feedback.

## Solution

### Sessions

- An actor (human or agent) starts a **session** through an API call.
- A session covers a list of **working directories**. As first decided here,
  each one is a repo, the branch being reviewed, the directory it's checked out
  in, and the **base ref** it's compared against.
- Working directories can be added to a session after it starts, for example
  when a new sub-agent starts work in a new worktree.
- The reviewer submits **reviews** to the session. Each review is a batch of
  comments, which can span several working directories. A session can receive
  many reviews over time.
- A session ends through an API call. That can come from the reviewer in the
  review UI, an agent, or other automation.

### Claims

- An agent **claims** a working directory to address its unaddressed feedback in
  a session. A working directory has at most one active claim at a time, so two
  agents don't start work on the same working directory.
- A claim is a lease. The agent renews it while working, and it expires if the
  agent stops renewing it, for example because the agent died. The agent can
  also release it, or complete it when the feedback is addressed.
- Claims are advisory. The review server records them and tells agents who holds
  a working directory, but it can't stop another process from editing the files.
  Having the claim in the data model gives well-behaved agents what they need to
  coordinate.

### Effect on earlier decisions

- **Agent tree ([0004](0004-agent-tree-is-an-input.md)).** The agent tree no
  longer defines what a review covers. It's still reported as described in 0004,
  and is used to show who changed what and to filter the review UI by agent.
  Starting a session from an agent's tree, with its working directories added
  automatically, is a convenience.
- **Notifications ([0005](0005-notify-then-pull-feedback.md)).** A notification
  now says that feedback is available in a session. The agent claims a working
  directory and then fetches the comments for it.

## Tradeoffs

Benefits:

- Multiple repos are handled naturally, because a session is just a list of
  working directories.
- Reviews don't depend on agents. A human can start a session on plain repos
  with nothing registered.
- Feedback outlives the agent that caused it. If an agent exits, its working
  directory's feedback waits in the session until another agent claims it.
- Agents can work on different working directories in parallel without editing
  the same files.
- Every review for a piece of work lives in one session.

Costs:

- Claims are advisory, so an agent or human that ignores them can still edit a
  claimed working directory.
- An agent that claims a working directory it didn't change may lack the context
  the original agent had.
- Lease timing is a balance. Too short, and a claim expires during long work.
  Too long, and feedback is stuck after an agent crashes.
- One claim per working directory means comments in the same working directory
  are addressed one agent at a time, even when they're unrelated.
- Overall comments aren't tied to a working directory, so claims don't cover
  them.
- Deciding which agents to notify is more involved than notifying one fixed
  agent.

## Follow-up design choices

- **Overall comments.** Who handles comments on the review as a whole: the actor
  that started the session, or a separate claim.
- **Who gets first claim.** Whether the agent that made the changes in a working
  directory gets the first chance to claim it before others can.
- **Who is notified.** Which agents are notified when a review is submitted.
- **Lease timing.** How long a lease lasts and how agents renew it.
- **New reviews during a claim.** Whether an active claim covers feedback from
  reviews submitted after it was taken.
- **A working directory in several sessions.** Whether a working directory can
  belong to more than one session at once, and if so, whether a claim in one
  blocks work from the other.
- **Removing working directories.** Whether working directories can be removed
  from a session.
- **Ending with open feedback.** What happens to unclaimed or unaddressed
  feedback when a session ends.
- **API shape.** The calls for starting and ending sessions, adding working
  directories, and taking, renewing, releasing, and completing claims.
