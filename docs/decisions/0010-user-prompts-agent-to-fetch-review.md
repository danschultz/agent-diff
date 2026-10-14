# 0010: The user prompts the agent to fetch the latest review

- Status: Accepted, amended by [0011](0011-api-core-with-cli-client.md) and
  [0013](0013-working-directories.md)
- Date: 2026-10-11

> **Amended by [0011](0011-api-core-with-cli-client.md):** there's no MCP tool.
> Agents run `agent-diff review`, which calls the review server's API.

> **Amended by [0013](0013-working-directories.md):** the agent's current
> directory doesn't have to match a working directory exactly. The CLI finds the
> working directory that contains it.

## Problem

[0005](0005-notify-then-pull-feedback.md) had the review server send a short
message to wake an idle agent when a review was submitted. Making that reliable
takes a lot of machinery: a durable event log, delivery retries, tracking
whether the agent picked up the review, hooks installed into each agent's
config, an integration per harness, and care not to type into a terminal while
the user is typing in it.

Meanwhile, the reviewer is already present when a review is submitted. They just
clicked submit in the review UI, so the only thing automatic delivery saves them
is switching to the agent's terminal.

## Solution

- **The user tells the agent to apply the review.** After submitting a review,
  the reviewer prompts the agent, for example "Apply the latest feedback." The
  review UI shows a prompt to copy after each submit.
- **The agent pulls the review.** The agent runs `agent-diff review` (or an
  equivalent MCP tool), which returns the most recent submitted review for the
  agent's working directory. The working directory is worked out from the
  agent's current directory, so the prompt doesn't need IDs.
- **Claims are unchanged.** The agent claims the working directory, addresses
  the comments, and completes the claim
  ([0009](0009-review-sessions-and-claims.md)).
- **Fleets go through the main agent.** With several agents, the user prompts
  the main agent, which hands working directories to its sub-agents.
- **The review server never contacts agents.** Agents always pull.

Unchanged from 0005: comments are drafts until their review is submitted, the
agent receives the submitted review as a whole, and agents never block waiting
for review.

### Effect on earlier decisions

- **[0005](0005-notify-then-pull-feedback.md).** No message is sent to the agent
  when a review is submitted. The agent fetches with `agent-diff review` rather
  than `agent-diff feedback <review-id>`.
- **[0006](0006-sqlite-review-state.md).** There's no delivery status to store.
- **[0009](0009-review-sessions-and-claims.md).** No agents are told when a
  review is submitted, so the "who is notified" follow-up no longer applies.
- **Registration ([0004](0004-agent-tree-is-an-input.md)).** An agent no longer
  reports how to reach it, only its ID, its parent, and its working directories.

## Tradeoffs

Benefits:

- No event log, delivery tracking, retries, or harness-specific delivery
  integration to build.
- Works with any agent that can run a CLI or call an MCP tool, with nothing
  installed into the agent's config.
- Nothing is ever typed into the agent's terminal, so the user's typing is never
  interrupted.
- The reviewer decides when the agent acts on a review.
- Claims still show the reviewer that an agent picked up the review.

Costs:

- The agent doesn't act on a review until the reviewer prompts it.
- Agents can't run unattended loops where they act on reviews with no human
  involved.
- Only the most recent review is returned. If the reviewer submits two reviews
  before prompting the agent, the earlier one isn't applied unless the agent
  asks for it.
- The agent's current directory must match a working directory in a review
  session, or the agent has to say which one it means.

## Follow-up design choices

- **Earlier reviews.** Whether `agent-diff review` can fetch a specific or
  earlier review, and whether it warns when an earlier review in the review
  session wasn't addressed.
- **Copyable prompt.** What the prompt shown after submit says, and whether it
  names the review session.
- **Working directory lookup.** What happens when the current directory matches
  no working directory, or a working directory in several review sessions.
- **Output format.** Whether `agent-diff review` returns JSON or text formatted
  for a language model.
- **CLI naming.** `agent-diff review` now fetches a review, so starting a review
  session needs a different command.
- **Automatic wake-ups.** Whether to add them later, through harnesses or agent
  hooks, on top of the same pull command.
