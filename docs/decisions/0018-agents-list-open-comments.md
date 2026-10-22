# 0018: Agents list a session's open comments and mark each one addressed

- Status: Accepted, amended by
  [0036](0036-the-reviewer-submits-reviews-and-the-agent-gets-a-review-message.md),
  [0038](0038-agents-reply-in-comment-threads.md), and
  [0039](0039-sessions-have-short-ids-and-cover-working-directories-by-real-path.md)
- Date: 2026-10-15

> **Amended by
> [0036](0036-the-reviewer-submits-reviews-and-the-agent-gets-a-review-message.md):**
> comments and the reviewer's replies are drafts until the reviewer submits a
> review, and the review server sends the agent a review message naming
> `agent-diff review show <review-id>`. The copyable prompt becomes that review
> message, needed only when no agent session is listening. Claims stay removed,
> IDs stay explicit, and sessions are still archived or deleted.

> **Amended by [0038](0038-agents-reply-in-comment-threads.md):**
> `agent-diff comment addressed` is replaced by
> `agent-diff comment reply <comment-id> --addressed|--needs-input <text>`.
> Comment statuses are open, addressed, needs input, and resolved, and the
> reviewer reopens a comment by replying to it.

> **Amended by
> [0039](0039-sessions-have-short-ids-and-cover-working-directories-by-real-path.md):**
> a session's ID is `s_` and 6 random characters of lowercase Crockford base32,
> such as `s_7kq9a1`, and comment IDs will be `c_` with the same shape.
> `session new` and `session add` take `--base <ref>`, and without it the base
> ref defaults to origin/HEAD, then `main` or `master`, then `HEAD`.

## Problem

Walking through how agents and humans would use `agent-diff` end to end, under
[0009](0009-review-sessions-and-claims.md) and
[0010](0010-user-prompts-agent-to-fetch-review.md), showed several parts that no
longer fit:

- **Claims no longer have a job.** Claims were added in 0009, when the review
  server notified agents of a review, so several agents could wake up and go for
  the same working directory. Since 0010, the reviewer prompts the agent, so the
  human already decides which agent works where. What's left is a lease that the
  agent has to keep renewing, which an agent in the middle of a long task won't
  do reliably, and which is only advisory anyway.
- **Nothing records whether a comment was addressed.** Completing a claim was
  the only signal, and it covered a whole working directory, not a comment.
- **Reviews add questions without helping the reviewer.** Comments were drafts
  until submitted as a review, but a draft belonged to a review that didn't
  exist yet. The agent fetched only the most recent review, so an earlier one
  that hadn't been applied was skipped. Review IDs and published groups of
  comments would answer those questions, but add concepts the reviewer doesn't
  need. The reviewer wants to leave comments, sometimes with an overall comment,
  and have an agent address them.
- **Working out the working directory from the current directory is ambiguous.**
  It has no answer when the CLI runs outside every working directory, as a main
  agent coordinating sub-agents does, or when a working directory is in several
  sessions or inside another working directory. A command that guesses which
  session it means can act on the wrong one.
- **Ending a session is undefined.** 0009 says a session ends through an API
  call, but not what ending does to its comments, to file watching, or to its
  data.

## Solution

### Comments

- **Two kinds of comment.** A line comment is on a single line or a range of
  lines, and has an anchor and an anchor state
  ([0008](0008-comment-reanchoring.md)). An overall comment isn't attached to
  code and belongs to the session.
- **No drafts, submit, or reviews.** A comment is available to agents as soon as
  the reviewer saves it.

### Comment statuses

- **Open:** every comment starts open.
- **Addressed:** the agent marks a comment addressed when it has dealt with it.
- **Resolved:** the reviewer resolves an addressed comment in the review UI
  after checking the agent's work.
- **Reopened:** the reviewer can reopen a comment in the review UI, which sets
  it back to open.

A comment's status says whether it has been dealt with. Its anchor state says
where it's shown. The two are independent.

### Agents

- **The reviewer prompts the agent, as in 0010.** The review UI shows a prompt
  to copy that includes the session's ID, for example "Run
  `agent-diff comment list 4` and address the open comments." The review server
  never contacts agents.
- **The agent lists open comments.** `agent-diff comment list <session-id>`
  returns the session's open comments. Overall comments come first, so the agent
  reads any framing before the line comments, which follow grouped by working
  directory and file. Each line comment includes its working directory's path
  and its file path relative to the working directory.
- **The list can be filtered by working directory.** `--working-directory <dir>`
  returns only that working directory's line comments, along with every overall
  comment. In a fleet, a sub-agent can list just its own working directory's
  comments and still see the framing.
- **The agent marks each comment addressed.**
  `agent-diff comment addressed <comment-id>` sets a comment's status to
  addressed. Comment IDs are unique across sessions, so the command doesn't need
  a session ID.
- **Output is written for agents.** Commands print text that's easy for an agent
  to read by default. There's no JSON output for now.

### No claims

There are no claims. The reviewer decides which agent works on which working
directory. With a fleet, the reviewer prompts the main agent, which hands
working directories to its sub-agents.

### Explicit IDs

- Every command that acts on a session takes the session's ID. Nothing works out
  a working directory or session from the directory the CLI runs in.
- Working directories are path arguments. A relative path is resolved like any
  other path argument.
- A working directory can be in several sessions.

### Session commands

- `agent-diff session new <working-dir>...` starts a session. At least one
  working directory is required. It prints the session's ID and the review UI's
  URL.
- `agent-diff session add <session-id> <working-dir>...` adds working
  directories to a session.
- `agent-diff session show <session-id>` shows a session, its working
  directories, and how many comments have each status.
- `agent-diff session list` lists sessions and their IDs, so an agent can find
  an ID it wasn't given.

### Archiving and deleting

Sessions are archived or deleted rather than ended.

- `agent-diff session archive <session-id>` archives a session:
  - The review server stops watching its working directories for it, and frees
    the resources it held. A working directory that's also in an active session
    is still watched for that one.
  - The session becomes read-only. Comments can't be added or change status, and
    working directories can't be added.
  - It can still be queried through the API, the CLI, and the review UI.
  - Comments keep whatever status they had, including open, and archiving
    doesn't warn about open comments.
  - Archiving is one-way for now.
- `agent-diff session delete <session-id>` permanently removes a session and its
  data from the database. An active session can be deleted without archiving it
  first.
  - It asks for confirmation, and `--yes` skips it.
  - Without a terminal to ask in, as when an agent runs it, it fails unless
    `--yes` is given, with an error that says to pass `--yes`. It never waits
    for input that can't come.

### Effect on earlier decisions

- **[0005](0005-notify-then-pull-feedback.md).** Comments aren't held as drafts
  and delivered as a submitted batch. Each comment is available as soon as it's
  saved. Agents still pull, and still don't block.
- **[0006](0006-sqlite-review-state.md).** The database holds comments with
  their statuses, and archived sessions. There are no drafts, reviews, or claims
  to store.
- **[0008](0008-comment-reanchoring.md).** There are no drafts or submitted
  comments, so the "Drafts and submitted comments" section no longer applies.
- **[0009](0009-review-sessions-and-claims.md).** Sessions stay. Reviews and
  claims are removed, and sessions are archived or deleted rather than ended.
  Comments in an archived session keep their status, which answers the follow-up
  about ending with open feedback. The follow-ups about overall comments, first
  claim, lease timing, and new reviews during a claim no longer apply.
- **[0010](0010-user-prompts-agent-to-fetch-review.md).** The agent lists open
  comments with `agent-diff comment list <session-id>` rather than fetching the
  most recent review with `agent-diff review`, doesn't claim a working
  directory, and marks each comment addressed. The prompt includes the session's
  ID instead of relying on the agent's current directory. The follow-ups about
  earlier reviews, working directory lookup, output format, and CLI naming are
  answered.
- **[0011](0011-api-core-with-cli-client.md).** The CLI doesn't work out the
  working directory from the directory it runs in, and prints text written for
  agents. The API and CLI deal with comments and their statuses rather than
  reviews and claims.
- **[0013](0013-working-directories.md).** The CLI no longer looks for the
  working directory that contains the directory it runs in, so the term for that
  directory is dropped. The follow-up about claim scope no longer applies, and
  the one about nested working directories no longer has to say which one the
  CLI picks.

## Tradeoffs

Benefits:

- Fewer concepts: no drafts, reviews, review IDs, claims, or leases.
- Whether a comment was addressed is recorded on the comment, which is what the
  agent acts on, and the reviewer can see what's left.
- Nothing is skipped when the reviewer writes more comments before prompting.
  The agent gets every open comment.
- The agent can start on the first comments while the reviewer keeps reviewing.
- Overall comments are listed first, so the agent reads the framing before the
  line comments.
- Agents don't have to renew anything while they work.
- Commands act on the session they name, never one they guessed, and work the
  same from any directory.
- Archiving stops the cost of watching files for finished work while keeping its
  comments to look back on.
- Comment statuses lead into the "agents reply to comments" idea in the README.

Costs:

- There's no "I'm done" signal. If the reviewer prompts the agent partway
  through, the agent sees the comments saved so far, including ones the reviewer
  might still change.
- What the agent gets depends on when it runs, not on when the prompt was
  copied.
- An overall comment doesn't say which line comments it covers, so the agent has
  to use judgment.
- Nothing stops two agents working on the same comment or working directory. The
  reviewer, or the main agent, keeps them apart.
- The agent marks its own work addressed, so the reviewer has to check it before
  resolving.
- Comment text that's typed but not saved isn't stored by the review server, so
  it's lost if the browser tab dies. [0006](0006-sqlite-review-state.md)
  expected drafts to survive a restart.
- Every prompt needs a session ID, so a prompt can't be typed from memory unless
  the agent already knows the ID. An agent that restarts in a new agent session
  has to be given the ID again.
- Archiving freezes open comments without a warning, so unaddressed work can be
  forgotten.
- Deleting is permanent.

## Follow-up design choices

- **Anchor states and status.** How the review UI shows a line comment that
  becomes moved or outdated, now that 0008's different handling for drafts and
  submitted comments no longer applies. An outdated addressed comment may be a
  sign the fix landed, while an outdated open comment may no longer apply.
- **Editing and deleting comments.** Whether the reviewer can edit or delete a
  comment, including after an agent has listed it.
- **More statuses and messages.** Whether the reviewer can resolve an open
  comment directly, and whether agents get statuses such as declined or needs
  input, or a message explaining what they did.
- **Who addressed a comment.** Whether `comment addressed` records which agent
  addressed it, which depends on how registration works
  ([0004](0004-agent-tree-is-an-input.md)).
- **Overall comment scope.** Whether an overall comment can target one working
  directory instead of the whole session.
- **Listing other statuses.** Whether `comment list` can also return addressed
  or resolved comments.
- **Unsaved comment text.** Whether the review UI keeps comment text that's
  typed but not saved across a reload, for example in browser storage.
- **Copyable prompt.** What the prompt in the review UI says, and where it's
  shown now that there's no submit.
- **ID format.** What session and comment IDs look like, given that people copy
  them into prompts.
- **Base ref.** Whether `session new` and `session add` take a base ref, and
  what the default is.
- **Removing working directories.** Whether working directories can be removed
  from a session.
- **What an archived session shows.** Its working directories may have changed
  or been deleted since it was archived, so whether the review UI shows current
  diffs, or only comments with the file versions they were written on.
- **Cleaning up file versions.** How stored file versions that no comment refers
  to are removed when a session is deleted
  ([0008](0008-comment-reanchoring.md)).
