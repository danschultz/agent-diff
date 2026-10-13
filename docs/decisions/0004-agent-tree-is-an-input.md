# 0004: The agent tree is an input, not inferred

- Status: Accepted, amended by [0009](0009-review-sessions-and-claims.md)
- Date: 2026-10-09

> **Amended by [0009](0009-review-sessions-and-claims.md):** the agent tree no
> longer defines what a review covers. Review sessions do. The tree is still
> reported as described here, and is used to show who changed what and to filter
> the review UI by agent.

## Problem

A review is scoped to one agent and its sub-agents, and the reviewer can switch
between agents. The app needs to know which agents exist, how they relate to
each other, which worktrees and branches each one changed, and how to send
feedback to each one. That information could be reported to the app, or the app
could try to infer it from worktrees, branches, and harness state.

## Solution

Agents and their harnesses report the agent tree to the app. The app does not
infer agents from git.

Registration should happen where agents are spawned, in the harness (cmux,
herdr) or a CLI wrapper that starts the agent, rather than relying on the model
to remember to call a tool. A parent passes its ID to its children (for example
through an environment variable) so the tree builds itself.

A plain repo or worktree with no registered agents can still be reviewed. The
app treats it as a tree with a single unnamed agent.

## Tradeoffs

Benefits:

- **Accuracy.** Git has no concept of an agent. One agent can change several
  repos, several agents can share a worktree, and parent and child links aren't
  visible in git. Anything inferred would rely on fragile naming conventions.
- **Feedback needs an address.** Submitted feedback has to reach a specific
  agent session, and only the agent or its harness knows how to reach it.
- **"Last turn" needs agent input anyway.** Snapshots at turn boundaries depend
  on the agent signaling when a turn ends, so reporting identity and working
  directories adds little extra work.
- **Simplicity.** The app has no heuristics to maintain or debug and is easy to
  test with a fixture tree.

Costs:

- **Adoption effort.** Each harness or agent has to integrate before the full
  tool works. The single-agent fallback keeps plain repos reviewable without
  setup.
- **Unreliable reporting.** If registration depends on the model, it will
  sometimes be skipped or wrong. Registering at spawn time in the harness avoids
  this.
- **Lifecycle.** Agents finish, crash, or get killed. The app needs a rule for
  agents that stop reporting, while keeping their changes reviewable.

## Follow-up design choices

- **How the tree is fed in.** Either each agent registers itself when it starts
  and the app builds the tree as reports arrive, or the main agent hands over
  the whole tree when it opens a review. Self-registration is preferred: it
  holds up better, and new sub-agents appear live in an open review. Handing
  over the whole tree is simpler, but the main agent must know every sub-agent's
  worktree and how to reach it, and the review goes stale when a new sub-agent
  starts.
- **Shared worktrees.** If two agents edit the same worktree at the same time,
  knowing who they are doesn't tell you which lines each one wrote. Either
  attribute changes using snapshots at each turn boundary, or require one
  worktree per agent.
- **Stale agents.** How the app detects agents that stopped reporting (heartbeat
  or explicit end event) and how it shows them.
- **What an agent reports.** The exact schema, for example ID, parent ID, label,
  working directories, and how to send it feedback.
