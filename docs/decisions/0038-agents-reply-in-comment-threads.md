# 0038: Agents reply in comment threads, marking each comment addressed or needs input

- Status: Accepted
- Date: 2026-10-22

## Problem

Under [0018](0018-agents-list-open-comments.md), an agent can only mark a
comment addressed. The reviewer can't tell what changed, why an agent didn't do
what was asked, or that it had a question, without reading the whole diff again.
The README listed replies as a future idea, "Agents reply to comments".

With
[0036](0036-the-reviewer-submits-reviews-and-the-agent-gets-a-review-message.md),
the agent picks up each review as soon as it's submitted, so the reviewer and
the agent go back and forth more often, and a status alone says too little.

## Solution

### Threads

- **Every comment is a thread:** the reviewer's comment, then replies from the
  agent and the reviewer, in order. Overall comments are threads too.
- **The agent replies with `agent-diff comment reply`:**

  ```text
  agent-diff comment reply <comment-id> --addressed <text>
  agent-diff comment reply <comment-id> --needs-input <text>
  ```

  Exactly one of `--addressed` and `--needs-input` is required. The command adds
  the reply and sets the comment's status in one step. An agent's reply isn't a
  draft. It shows in the review UI as soon as it's saved.

- **Addressed** replies say what changed. **Needs input** replies ask a
  question, push back with reasons, or say what blocked the agent, instead of
  guessing.

### Comment statuses

- **Open:** submitted in a review, or reopened. The agent should address it.
- **Addressed:** the agent's last reply says it's dealt with.
- **Needs input:** the agent's last reply is waiting on the reviewer.
- **Resolved:** the reviewer checked the agent's work and resolved it.

The reviewer resolves a comment in the review UI at once, without a review. The
reviewer reopens a comment by replying to it. The reply is a draft, and when its
review is submitted the comment goes back to open and the reply is part of that
review, so the agent gets it through the review message
([0037](0037-agents-get-review-messages-through-a-listener-they-start.md)).

### Effect on earlier decisions

- **[0018](0018-agents-list-open-comments.md).** `comment addressed` is removed,
  and `comment reply` replaces it. Comment statuses gain needs input, and
  reopening is done by replying.
- **README future idea "Agents reply to comments".** Adopted, with two of its
  statuses. Declined and blocked aren't separate statuses: the agent replies
  with needs input and says why.

## Tradeoffs

Benefits:

- The reviewer reads what the agent did for each comment, and goes straight to
  the change instead of re-reading the whole diff.
- The agent asks instead of guessing, and pushes back with reasons instead of
  silently ignoring a comment.
- The reviewer sees which threads are still open and skips the settled ones.
- Answering the agent is the same as any other feedback: a draft reply, sent
  with the next review.

Costs:

- The agent writes a reply for every comment, which takes more tokens than
  marking it addressed.
- With two statuses, the review UI can't filter declined comments from questions
  or blockers. The reviewer reads the reply.
- Answering a needs input reply takes a submitted review, even for a one-word
  answer.

## Follow-up design choices

- **Linking to the change.** Whether an addressed reply links to the lines it
  changed, for example through a turn snapshot.
- **Several agent replies.** Whether an agent can reply again on a comment
  without the reviewer replying in between, for example to correct itself.
- **Reply length and format.** Whether replies are plain text or Markdown, and
  any limit on their length.
- **Showing threads.** How the review UI shows threads next to the diff, and how
  anchor states and comment statuses are shown together, left open in 0018.
