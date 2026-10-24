# 0043: Each session has one draft review, and submitted reviews don't change

- Status: Accepted
- Date: 2026-10-24

## Problem

[0036](0036-the-reviewer-submits-reviews-and-the-agent-gets-a-review-message.md)
has the reviewer submit comments and replies as a review, and the review server
send the agent a review message. [0038](0038-agents-reply-in-comment-threads.md)
has the agent reply in each comment's thread. Both leave follow-up design
choices open that the briefs building them need settled:

- 0036 leaves open the review message's wording, whether `review show` lists
  earlier comments that are still open, whether a review can be withdrawn, and
  whether comments and replies can be edited and deleted before they're
  submitted.
- 0038 leaves open whether an agent can reply several times in a row, and the
  length and format of replies.

Neither says what a review's ID looks like, what `review show` and
`comment reply` print, what can change once a review is submitted, or what an
archived session allows.

## Solution

### Terminology

- **"Draft" becomes "draft review".** The glossary term is
  [draft review](../glossary.md#draft-review): the one review the reviewer is
  writing in a session, holding the comments and replies they haven't submitted
  yet. A comment or reply is "in the draft review" until it's submitted.

### IDs

- **A review's ID is `r_` and 6 random characters** of lowercase Crockford
  base32, the same shape as session IDs (`s_`) and comment IDs (`c_`)
  ([0040](0040-sessions-have-short-ids-and-cover-working-directories-by-real-path.md)),
  such as `r_4m2x9p`.
- **Replies have no public ID.** Nobody refers to a single reply.
- **An ID that's malformed or names nothing** fails with an error naming it, as
  session IDs do.

### The draft review

- **A session has at most one draft review:** the review the reviewer is
  writing. It holds every comment and reply the reviewer has written since the
  last review was submitted.
- **Submitting the draft review** turns it into a review with its `r_` ID, and
  sends the review message. The next comment or reply the reviewer writes starts
  a new draft review.
- **A draft review with no comments or replies can't be submitted,** as in 0036.
- **The reviewer can edit and delete** each comment and reply in the draft
  review until it's submitted.
- **The draft review is saved on the review server** and survives a reload, so
  the review UI doesn't warn about it.
- **Agents can't see the draft review** or anything in it.

### Text

- **Comments and replies are plain text,** from the reviewer and the agent.
- **Text is trimmed,** can't be empty, and is at most 10,000 characters.

### Reviews

- **A submitted review can't be withdrawn or edited.** To take something back,
  the reviewer resolves the comment, or replies to it.
- **A submitted comment can't be edited or deleted,** only resolved or replied
  to.

### The review message

- **The review message is one line,** so the listener prints it as one line
  ([0037](0037-agents-get-review-messages-through-a-listener-they-start.md)):

  ```text
  [agent-diff review r_4m2x9p] The reviewer submitted review r_4m2x9p in session s_7kq9a1. Finish what you're doing first, then run `agent-diff review show r_4m2x9p`, address each comment, and reply to each one with `agent-diff comment reply`.
  ```

- **It names the review and the session,** and nothing else. It doesn't name the
  working directories the review touches, because `review show` groups line
  comments by working directory.

### `agent-diff review show <review-id>`

- **It prints only that review:** the comments submitted in it, and the
  reviewer's replies submitted in it, each with its whole thread so a reply is
  read in context. Comments from earlier reviews that are still open come from
  `comment list`.
- **Overall comments come first,** then line comments grouped by working
  directory and file, as in 0036.
- **Each comment shows its ID and its comment status.**
- **It works on an archived session,** since it only reads.
- **It doesn't record that the review was fetched.**

For a review with overall comments, the output looks like this, and the briefs
that build it follow its shape. A later decision on comment anchors adds how a
line comment's location is printed.

```text
Review r_4m2x9p in session s_7kq9a1, submitted 2026-10-22 14:03.
Address each comment, then reply to it with one of:
  agent-diff comment reply <comment-id> --addressed <what changed>
  agent-diff comment reply <comment-id> --needs-input <your question>

## Overall comments

### c_8f3k2a (open)

Reviewer: Split the migration into its own commit.

### c_2b7q1d (open)

Reviewer, review r_1h6w3z: Use the config file for the port.
Agent, addressed: Read the port from the config file in server.ts.
Reviewer, this review: That's the wrong config file. Use the one in packages/shared.
```

Times are in the local time zone.

### `agent-diff comment reply <comment-id> --addressed|--needs-input <text>`

- **It works on a comment with any comment status,** including resolved.
- **The reply's flag sets the comment's status,** so the agent's latest reply
  always decides it. An agent can reply several times in a row, for example to
  correct itself.
- **A reply on a resolved comment moves it to addressed or needs input,** so the
  reviewer sees it again.
- **It prints one line** saying the reply was saved and the comment's new
  status, such as `Replied to c_8f3k2a. It's now addressed.`

### Resolving

- **The reviewer can resolve a comment with any status,** including open, for
  example after changing their mind. It takes effect at once, without a review,
  as in 0038.

### Archived sessions

- **An archived session is read-only.** Changing or submitting the draft review,
  agent replies, and resolving all fail with an error naming the session.
- **Archiving a session keeps its draft review,** unsubmitted and read-only.
- **Reading still works,** including `review show`.

### Effect on earlier decisions

- **[0036](0036-the-reviewer-submits-reviews-and-the-agent-gets-a-review-message.md).**
  Amended. `review show` doesn't record that a review was fetched, and the
  review UI doesn't show it. The review UI shows whether a review message is
  held or sent to a listener, and only once there's a listener. This answers the
  follow-ups "Review message wording", "Earlier comments", "Withdrawing a
  review", and "Editing the draft review". "Held review messages" stays open.
  0036 already turns every unsubmitted comment and reply in a session into one
  review, so a single draft review per session doesn't change what it decided,
  and only its wording changes for the new term.
- **[0038](0038-agents-reply-in-comment-threads.md).** Amended. An agent's reply
  on a resolved comment moves it out of resolved, so the reviewer isn't the only
  one who can reopen a comment. This answers the follow-ups "Several agent
  replies" and "Reply length and format".
- **[0018](0018-agents-list-open-comments.md).** Answers its follow-up "Editing
  and deleting comments", and the part of "More statuses and messages" about
  resolving an open comment directly. Nothing it decided changes.

## Tradeoffs

Benefits:

- One draft review per session matches how reviewers already work in GitHub.
- A typo in the draft review is fixed before the agent sees it.
- The agent sees exactly one review's feedback, in threads, and each reply comes
  with the thread it answers.
- A comment can't silently change after the agent read it, so what the agent
  acted on is what's shown.
- The agent can correct itself, and can reopen a resolved comment it has a
  question about.
- The review message is one line, so the listener prints it as is, and copying
  it from the review UI gives the same text.
- Review IDs look like session and comment IDs, so they're short to type into a
  prompt and are generated and checked the same way.
- The draft review survives a reload and a browser tab that dies, so the review
  UI doesn't need to warn about leaving.
- `review show` only reads, so the agent can run it again, and it works on an
  archived session.

Costs:

- The agent doesn't see earlier open comments unless it runs `comment list`.
- Plain text means no code blocks or links.
- Nothing records whether the agent fetched a review, so the reviewer can't tell
  a listener's sent message from one the agent acted on.
- A wrong comment can't be deleted, only resolved, and stays in its thread.
- The agent's latest reply always sets the status, so an agent that replies by
  mistake on a resolved comment brings it back for the reviewer to check.
- Archiving a session freezes its draft review, so comments in it are never
  sent.
- The review message doesn't name working directories, so a main agent runs
  `review show` before it can hand work to its sub-agents.

## Follow-up design choices

- **Markdown in comments and replies.** Whether comments and replies can use
  Markdown, such as code blocks and links.
- **Showing that the agent fetched a review.** Whether the review UI shows that
  the agent fetched a review, if the listener's sent state turns out not to be
  enough.
