# 0036: The reviewer submits reviews, and the review server sends the agent a review message

- Status: Accepted
- Date: 2026-10-22

## Problem

Under [0010](0010-user-prompts-agent-to-fetch-review.md) and
[0018](0018-agents-list-open-comments.md), the review server never contacts
agents. Every comment is available to agents as soon as it's saved, and the
reviewer switches to the agent's terminal and pastes a prompt copied from the
review UI to get the comments addressed.

0010 chose that because waking an agent session looked like it needed a lot of
harness-specific machinery.
[Research 0007](../research/0007-messaging-agent-sessions.md) found a way that
doesn't: a listener the agent starts in the background, which prints a line that
starts a turn in both Claude Code and the Cursor CLI
([A background process the agent starts](../research/0007-messaging-agent-sessions.md#a-background-process-the-agent-starts)).
With a way to reach the agent, Dan wants the reviewer to finish a pass over the
code in the review UI, submit it, and have the agent pick it up without being
prompted by hand.

Sending comments one at a time as they're saved would interrupt the agent for
each one, and give it feedback the reviewer hasn't finished writing. So the
reviewer needs a way to say that a batch is ready.

## Solution

### Drafts and reviews

- **Comments and replies start as drafts.** A line comment, an overall comment,
  or a reviewer's reply in a comment's thread
  ([0038](0038-agents-reply-in-comment-threads.md)) is a draft until the
  reviewer submits it. Agents can't see drafts.
- **The reviewer submits a review.** Submitting turns every draft in the session
  into a review, with an ID. A session gets many reviews over time. A review
  with no drafts can't be submitted.
- **Comments keep their own status.** Submitting a review sets each new comment
  to open. Statuses then change per comment, as in
  [0038](0038-agents-reply-in-comment-threads.md), not per review.

### The review message

- **On submit, the review server sends a review message** to the agent session
  listening on the session, through its listener
  ([0037](0037-agents-get-review-messages-through-a-listener-they-start.md)).
- **The review message is small.** It names the review and says what to do, and
  never carries the comments. For example:

  ```text
  [agent-diff review 12] The reviewer submitted review 12 in session 4.
  Finish what you're doing first, then run `agent-diff review show 12`, address
  each comment, and reply to each one with `agent-diff comment reply`.
  ```

- **The agent fetches the review with the CLI.**
  `agent-diff review show <review-id>` prints the review's comments and the
  reviewer's replies: overall comments first, then line comments grouped by
  working directory and file, each with the thread it belongs to, so a reply is
  read in context. Output is text written for agents, as in 0018. Running it
  records that the review was fetched.
- **When the agent is busy,** the review message reaches it while it's working,
  so it says to finish the current work first.

### When no agent session is listening

- **The review server holds the review message** and sends it when a listener
  connects to the session. Held review messages are sent in the order their
  reviews were submitted.
- **The review UI shows the reviewer** whether each review's message is held,
  sent to a listener, or fetched with `review show`.
- **The reviewer can copy the review message** from the review UI and paste it
  into any agent session, for example one that never started a listener or runs
  an agent without one. It's the same text the listener prints.

### Commands

- `agent-diff review show <review-id>` is new.
- `agent-diff comment list <session-id>` stays, and lists only submitted
  comments.
- The session commands, archiving, and deleting are unchanged from 0018. An
  archived session can't get a review.

### Effect on earlier decisions

- **[0005](0005-notify-then-pull-feedback.md).** Back to its core: comments are
  drafts until submitted, the review server sends a short message, and the agent
  pulls the review. The message reaches the agent through a listener the agent
  starts, not a harness typing into the terminal.
- **[0006](0006-sqlite-review-state.md).** The database holds drafts, reviews,
  replies, and each review message's delivery state.
- **[0008](0008-comment-reanchoring.md).** There are drafts and submitted
  comments again, so the "Drafts and submitted comments" section applies again.
- **[0010](0010-user-prompts-agent-to-fetch-review.md).** Superseded. The review
  server sends the review message, and copying it from the review UI is the
  fallback.
- **[0018](0018-agents-list-open-comments.md).** Drafts, submit, and reviews
  return. A comment is available to agents once its review is submitted, not
  when it's saved. The copyable prompt becomes the review message, and is only
  needed when no agent session is listening. Claims stay removed, IDs stay
  explicit, and sessions are still archived or deleted.

## Tradeoffs

Benefits:

- The reviewer doesn't switch to the agent's terminal or paste anything. The
  agent starts on the review as soon as it's submitted.
- The reviewer decides when a batch is ready, and the agent isn't interrupted by
  each comment or given half-written feedback.
- The review message is fixed, short text from the review server, so the
  comments always come back as structured output from `review show`, and the
  agent can fetch them again.
- The copyable review message keeps every agent usable, with or without a
  listener.

Costs:

- Comments aren't available to agents until the reviewer submits, so an agent
  can't start on part of the feedback early.
- Drafts add state to store, show, and re-anchor, which 0018 had removed.
- When the agent is busy, the review message arrives mid-turn. The agent is
  asked to finish first, but whether it does is up to the model.
- A held review message may never be sent if no agent session listens again. The
  review UI shows it's held, but nothing else follows up.

## Follow-up design choices

- **Review message wording.** The exact text, and whether it names the working
  directories the review touches, so a main agent can hand them to sub-agents.
- **Earlier comments.** Whether `review show` also lists comments from earlier
  reviews that are still open, or leaves that to `comment list`.
- **Withdrawing a review.** Whether a submitted review can be withdrawn before
  the agent fetches it.
- **Held review messages.** Whether they expire, and whether submitting a new
  review while one is held sends both or merges them.
- **Draft editing.** Whether drafts can be edited and deleted one at a time, and
  whether the review UI warns about unsubmitted drafts.
