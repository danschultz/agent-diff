# Glossary

Terms agreed on for `agent-diff`, in alphabetical order. Use these terms as
defined here in all docs. See [`.rules/glossary.md`](../.rules/glossary.md) for
how to add, change, or remove terms.

### Actor

A human or agent that requests changes, makes changes, or starts a
[session](#session).

### Agent

An AI coding agent that makes changes in one or more
[working directories](#working-directory).

### Agent session

One running instance of an [agent](#agent), usually managed by a
[harness](#harness). When an agent restarts, it runs in a new agent session.
Always write "agent session" in full. A bare "session" always means a
[session](#session).

### Agent tree

A [main agent](#main-agent) and the [sub-agents](#sub-agent) it started, as
reported by the agents or their [harness](#harness). It's never inferred from
git. The agent tree is used to show who changed what and to filter the
[review UI](#review-ui) by agent. It doesn't define what a session covers. See
[0004](decisions/0004-agent-tree-is-an-input.md).

### Anchor

The part of a [comment](#comment) that records exactly what it was written on:
the file path, the diff side, the line range, and the
[file version](#file-version). An anchor never changes. See
[0008](decisions/0008-comment-reanchoring.md).

### Anchor state

Where a [comment](#comment) is shown relative to the current code:

- **Current:** the commented lines are unchanged. The comment may have moved
  with lines added or removed above it.
- **Moved:** the commented lines changed or disappeared, but a strict content
  match found them elsewhere in the file.
- **Outdated:** the commented lines changed and no confident match was found.
  The comment is shown next to the replacement code, along with the original
  code.

This is about where the comment sits, not whether it has been addressed, which
is its [comment status](#comment-status). See
[0008](decisions/0008-comment-reanchoring.md).

### Base ref

The branch or commit that a git [working directory](#working-directory)'s
changes are compared against. Each working directory has its own base ref in
each [session](#session) it's in. See
[0040](decisions/0040-sessions-have-short-ids-and-cover-working-directories-by-real-path.md).

### Comment

A note the [reviewer](#reviewer) leaves in a [session](#session). There are two
kinds:

- **Line comment:** on a single line or a range of lines in a file. It has an
  [anchor](#anchor) and an [anchor state](#anchor-state).
- **Overall comment:** not attached to code. It belongs to the session.

A comment is in the [draft review](#draft-review) until it's submitted in a
[review](#review), and then it's available to agents and can't be edited or
deleted. Each comment is a thread of [replies](#reply), and has a
[comment status](#comment-status). See
[0018](decisions/0018-agents-list-open-comments.md),
[0036](decisions/0036-the-reviewer-submits-reviews-and-the-agent-gets-a-review-message.md),
[0038](decisions/0038-agents-reply-in-comment-threads.md), and
[0043](decisions/0043-each-session-has-one-draft-review-and-submitted-reviews-dont-change.md).

### Comment status

Whether a [comment](#comment) has been dealt with:

- **Open:** submitted in a [review](#review), or reopened, and waiting on the
  agent.
- **Addressed:** the agent's latest [reply](#reply) says it's dealt with.
- **Needs input:** the agent's latest reply is waiting on the
  [reviewer](#reviewer).
- **Resolved:** the reviewer resolved it, usually after checking the agent's
  work.

The agent's latest reply sets addressed or needs input, including on a resolved
comment. The reviewer can resolve a comment with any status, at once, without a
review. The reviewer reopens a comment by replying to it, which sets it back to
open when the reply's review is submitted. This is separate from its
[anchor state](#anchor-state). See
[0038](decisions/0038-agents-reply-in-comment-threads.md) and
[0043](decisions/0043-each-session-has-one-draft-review-and-submitted-reviews-dont-change.md).

### Diff mode

What the diff compares for a git [working directory](#working-directory):

- **All changes:** the [base ref](#base-ref) to the working tree.
- **Committed:** the base ref to `HEAD`.
- **Staged:** `HEAD` to the index.
- **Unstaged:** the index to the working tree.
- **Last turn:** the previous [turn snapshot](#turn-snapshot) to the current
  state.

A working directory that doesn't use git has no diff modes.

### Draft review

The one [review](#review) the [reviewer](#reviewer) is writing in a
[session](#session), holding the [comments](#comment) and [replies](#reply) they
haven't submitted yet. A session has at most one. Agents can't see it. A comment
or reply is "in the draft review" until it's submitted. See
[0036](decisions/0036-the-reviewer-submits-reviews-and-the-agent-gets-a-review-message.md)
and
[0043](decisions/0043-each-session-has-one-draft-review-and-submitted-reviews-dont-change.md).

### File version

The full contents of a file at the point a [comment](#comment) was written on
it. Each file version is stored once and shared by every comment written on it.
See [0008](decisions/0008-comment-reanchoring.md).

### File view

The tree or list of files shown next to the diff in the [review UI](#review-ui).
It's filtered by the [diff mode](#diff-mode) and shows each file's git status.
For a working directory that doesn't use git, it lists all files.

### Harness

A tool that runs and manages [agent sessions](#agent-session), such as cmux,
herdr, or otty. Harnesses can register agents.

### Listener

The `agent-diff session listen <session-id>` process an agent starts in the
background. It prints each [review message](#review-message) for a
[session](#session) as a line, which starts a [turn](#turn). See
[0037](decisions/0037-agents-get-review-messages-through-a-listener-they-start.md).

### Main agent

The agent at the top of an [agent tree](#agent-tree).

### Registration

An agent, or its [harness](#harness), reporting the agent to the
[review server](#review-server): its ID, its parent, and its
[working directories](#working-directory).

### Reply

A message in a [comment](#comment)'s thread, from the agent or the
[reviewer](#reviewer). An agent's reply marks the comment addressed or needs
input, and is saved at once. A reviewer's reply is in the
[draft review](#draft-review) until it's submitted in a [review](#review).
Replies are plain text. See
[0038](decisions/0038-agents-reply-in-comment-threads.md) and
[0043](decisions/0043-each-session-has-one-draft-review-and-submitted-reviews-dont-change.md).

### Review

A batch of [comments](#comment) and [replies](#reply) the [reviewer](#reviewer)
submits in a [session](#session), identified by an ID such as `r_4m2x9p`.
Submitting the [draft review](#draft-review) turns it into a review and sends a
[review message](#review-message). A submitted review can't be withdrawn or
edited. A session gets many reviews over time. See
[0036](decisions/0036-the-reviewer-submits-reviews-and-the-agent-gets-a-review-message.md)
and
[0043](decisions/0043-each-session-has-one-draft-review-and-submitted-reviews-dont-change.md).

### Review message

The short message the [review server](#review-server) sends an agent when a
[review](#review) is submitted. It names the review and the command to fetch it,
and never carries the comments. It reaches the agent through a
[listener](#listener), and the reviewer can copy it from the
[review UI](#review-ui) when no agent session is listening. See
[0036](decisions/0036-the-reviewer-submits-reviews-and-the-agent-gets-a-review-message.md).

### Review server

The local server that stores review state in SQLite, watches
[working directories](#working-directory) for changes, serves the
[review UI](#review-ui), and provides the API that the review UI and the
`agent-diff` CLI call. See [0011](decisions/0011-api-core-with-cli-client.md).

### Review UI

The local web app where the [reviewer](#reviewer) views a [session](#session)'s
diffs and writes [comments](#comment). See
[0001](decisions/0001-local-web-app.md).

### Reviewer

The human reviewing code and writing [comments](#comment) in the
[review UI](#review-ui).

### Self-review

A review of an [agent session](#agent-session)'s changes by a
[sub-agent](#sub-agent) that didn't write them, before the pull request opens.
See [0030](decisions/0030-self-review-before-the-pull-request-opens.md).

### Session

A set of [working directories](#working-directory) under review, identified by
an ID. An [actor](#actor) starts a session through an API call, working
directories can be added after it starts, and the [reviewer](#reviewer) leaves
[comments](#comment) in it and submits [reviews](#review). A session is
archived, which stops watching its working directories and makes it read-only,
or deleted, which removes its data. See
[0009](decisions/0009-review-sessions-and-claims.md),
[0018](decisions/0018-agents-list-open-comments.md), and
[0040](decisions/0040-sessions-have-short-ids-and-cover-working-directories-by-real-path.md).

### Sub-agent

An agent started by another agent.

### Turn

One stretch of work an agent does in response to a prompt.

### Turn snapshot

The state of a [working directory](#working-directory) recorded at a
[turn](#turn) boundary. Used by the "Last turn" [diff mode](#diff-mode).

### Working directory

A directory on disk that agents make changes in and that [sessions](#session)
cover. It may be a git repo, a git worktree, or a directory inside a repo, or it
may not use git at all. The diff and the [file view](#file-view) only include
files under it, even when git runs against the whole repo. In a git working
directory, the branch is whatever `HEAD` points to, and isn't part of the
working directory. A working directory that doesn't use git has no diffs. A
working directory can be in several sessions. See
[0013](decisions/0013-working-directories.md).
