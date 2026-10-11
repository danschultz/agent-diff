# 0009: Reviews are submitted to review sessions, and agents claim feedback per workspace

- Status: Accepted, amended by [0010](0010-user-prompts-agent-to-fetch-review.md)
- Date: 2026-10-10

> **Amended by [0010](0010-user-prompts-agent-to-fetch-review.md):** no
> agents are told when a review is submitted. The reviewer prompts an agent,
> which claims a workspace and fetches the most recent review.

## Problem

Agents often change several repos at once, so the app needs a clear answer
to what one review covers: everything, one agent's work, or one repo.

Earlier, a review was scoped to a node of the agent tree
([0004](0004-agent-tree-is-an-input.md)), and feedback went to the agent
that made the changes ([0005](0005-notify-then-pull-feedback.md)). That ties
reviews to agents, which leaves gaps:

- A human can't review plain repos that no agent registered.
- Feedback for an agent that has exited has nowhere to go.
- An agent that restarts in a new agent session can't easily pick up its old
  feedback.

## Solution

### Review sessions

- An actor (human or agent) starts a **review session** through an API call.
- A review session covers a list of **workspaces**. Each workspace is a repo,
  the branch being reviewed, the worktree or working directory it's checked
  out in, and the **base ref** it's compared against.
- Workspaces can be added to a review session after it starts, for example
  when a new sub-agent starts work in a new worktree.
- The reviewer submits **reviews** to the review session. Each review is a
  batch of comments, which can span several workspaces. A review session can
  receive many reviews over time.
- A review session ends through an API call. That can come from the reviewer
  in the review UI, an agent, or other automation.

### Claims

- An agent **claims** a workspace to address its unaddressed feedback in a
  review session. A workspace has at most one active claim at a time, so two
  agents don't start work on the same workspace.
- A claim is a lease. The agent renews it while working, and it expires if
  the agent stops renewing it, for example because the agent died. The agent
  can also release it, or complete it when the feedback is addressed.
- Claims are advisory. The review server records them and tells agents who
  holds a workspace, but it can't stop another process from editing the
  files. Having the claim in the data model gives well-behaved agents what
  they need to coordinate.

### Effect on earlier decisions

- **Agent tree ([0004](0004-agent-tree-is-an-input.md)).** The agent tree no
  longer defines what a review covers. It's still reported as described in
  0004, and is used to show who changed what and to filter the review UI by
  agent. Starting a review session from an agent's tree, with its workspaces
  added automatically, is a convenience.
- **Notifications ([0005](0005-notify-then-pull-feedback.md)).** A
  notification now says that feedback is available in a review session. The
  agent claims a workspace and then fetches the comments for it.

## Tradeoffs

Benefits:

- Multiple repos are handled naturally, because a review session is just a
  list of workspaces.
- Reviews don't depend on agents. A human can start a review session on
  plain repos with nothing registered.
- Feedback outlives the agent that caused it. If an agent exits, its
  workspace's feedback waits in the review session until another agent
  claims it.
- Agents can work on different workspaces in parallel without editing the
  same files.
- Every review for a piece of work lives in one review session.

Costs:

- Claims are advisory, so an agent or human that ignores them can still edit
  a claimed workspace.
- An agent that claims a workspace it didn't change may lack the context the
  original agent had.
- Lease timing is a balance. Too short, and a claim expires during long work.
  Too long, and feedback is stuck after an agent crashes.
- One claim per workspace means comments in the same workspace are
  addressed one agent at a time, even when they're unrelated.
- Overall comments aren't tied to a workspace, so claims don't cover them.
- Deciding which agents to notify is more involved than notifying one fixed
  agent.

## Follow-up design choices

- **Overall comments.** Who handles comments on the review as a whole: the
  actor that started the review session, or a separate claim.
- **Who gets first claim.** Whether the agent that made the changes in a
  workspace gets the first chance to claim it before others can.
- **Who is notified.** Which agents are notified when a review is
  submitted.
- **Lease timing.** How long a lease lasts and how agents renew it.
- **New reviews during a claim.** Whether an active claim covers feedback
  from reviews submitted after it was taken.
- **A workspace in several review sessions.** Whether a workspace can belong
  to more than one review session at once, and if so, whether a claim in one
  blocks work from the other.
- **Removing workspaces.** Whether workspaces can be removed from a review
  session.
- **Ending with open feedback.** What happens to unclaimed or unaddressed
  feedback when a review session ends.
- **API shape.** The calls for starting and ending review sessions, adding
  workspaces, and taking, renewing, releasing, and completing claims.
