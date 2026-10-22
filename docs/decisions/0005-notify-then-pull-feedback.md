# 0005: Agents are notified of feedback, then pull it from the server

- Status: Accepted, amended by [0009](0009-review-sessions-and-claims.md),
  [0010](0010-user-prompts-agent-to-fetch-review.md),
  [0011](0011-api-core-with-cli-client.md),
  [0018](0018-agents-list-open-comments.md), and
  [0036](0036-the-reviewer-submits-reviews-and-the-agent-gets-a-review-message.md)
- Date: 2026-10-10

> **Amended by [0009](0009-review-sessions-and-claims.md):** feedback goes to a
> review session rather than to one fixed agent. A notification says feedback is
> available in a review session, and an agent claims a working directory before
> fetching its comments. Feedback for an agent that has exited waits in the
> review session until another agent claims it.

> **Amended by [0010](0010-user-prompts-agent-to-fetch-review.md):** the review
> server no longer sends a message when a review is submitted. The reviewer
> prompts the agent, and the agent fetches the most recent review with
> `agent-diff review`.

> **Amended by [0011](0011-api-core-with-cli-client.md):** agents fetch feedback
> through the CLI, which calls the review server's API. There's no MCP tool.

> **Amended by [0018](0018-agents-list-open-comments.md):** comments aren't held
> as drafts and delivered as a submitted batch. Each comment is available to
> agents as soon as it's saved, and the agent lists open comments with
> `agent-diff comment list <session-id>`.

> **Amended by
> [0036](0036-the-reviewer-submits-reviews-and-the-agent-gets-a-review-message.md):**
> comments are drafts until the reviewer submits a review again, and the review
> server sends the agent a short review message, which names
> `agent-diff review show <review-id>`. It reaches the agent through a listener
> the agent starts
> ([0037](0037-agents-get-review-messages-through-a-listener-they-start.md)),
> not a harness typing into the terminal.

## Problem

When the reviewer submits feedback, it has to reach the agent that made the
changes. Most coding agents are passive between turns: an idle agent in a
terminal isn't listening for anything, so the app can't simply call it.

The simplest option is for the agent to block on a command such as
`agent-diff review --wait` until feedback arrives. But after a turn, the human
wants to keep working with the agent outside the review, for example asking
questions or giving other instructions. An agent stuck waiting on the review
can't do that.

## Solution

- **Review is synchronous at the feedback level.** Comments stay in draft until
  the reviewer submits them, and the agent receives the submitted batch as a
  whole. Comments are not delivered one at a time as they're written.
- **Agents don't block on review.** Opening a review returns immediately, and
  the agent stays free to work with the human.
- **The app sends a small notification, not the review.** On submit, the app
  sends a short message to the agent, for example: "Review feedback is ready.
  Run `agent-diff feedback <review-id>` to read it." The message only says that
  feedback exists and how to fetch it.
- **The agent pulls the comments from the review server.** The agent uses the
  CLI (or an equivalent MCP tool) to fetch the comments, with their file, line
  range, and text, then addresses them.

How the notification wakes an idle agent depends on the harness. For example,
cmux or herdr can type the message into the agent's terminal. The "how to send
it feedback" field from agent registration
([0004](0004-agent-tree-is-an-input.md)) names the method for each agent.

## Tradeoffs

Benefits:

- The human can keep working with the agent while a review is open or pending.
- A one-line message is much less fragile to inject into a terminal than a full
  review with code snippets.
- Feedback comes back as structured data rather than pasted text, it isn't
  limited by what fits in a terminal, and the agent can fetch it again if
  needed.
- Every notification method uses the same API to fetch feedback, so only the
  notification is harness-specific.
- The server stays the single source of truth for review state.

Costs:

- Waking an idle agent still needs harness-specific integration. Without one,
  the human has to tell the agent to check for feedback.
- The agent must be able to reach the server, through a CLI on its `PATH` or an
  MCP tool, and the notification must say how.
- If the notification arrives while the agent is busy, it may interleave with
  the agent's work unless it's held until the agent is idle.
- There are two steps (notification, then fetch) where something can fail, so
  the app needs to know whether the agent actually picked up the feedback.

## Follow-up design choices

- **Wake-up methods.** Which harnesses are supported first (cmux, herdr, otty),
  and what the fallback is without one, for example showing the human a command
  to paste, or an agent hook that checks for feedback at the start of each turn.
- **Busy agents.** How the app tells whether an agent is idle or busy, and
  whether notifications wait until it's idle.
- **Acknowledgement.** Whether the agent reports that it fetched the feedback
  and is working on it, so the UI can show that, and whether the app re-sends
  the notification if nothing happens.
- **Fetch interface.** CLI, MCP, or both, and whether the response is JSON or
  text formatted for a language model.
- **Several reviews.** Whether the agent fetches only the latest submitted
  review, or every unresolved comment across reviews.
- **Agents that have exited.** Whether feedback for an agent that no longer
  exists goes to its parent, starts a new agent, or waits until a human decides.
