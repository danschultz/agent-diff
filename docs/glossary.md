# Glossary

Terms agreed on for `agent-diff`, in alphabetical order. Use these terms as
defined here in all docs. See [`.rules/glossary.md`](../.rules/glossary.md) for
how to add, change, or remove terms.

### Actor

A human or agent that requests changes, makes changes, or starts a
[review session](#review-session).

### Agent

An AI coding agent that makes changes in one or more
[working directories](#working-directory).

### Agent session

One running instance of an [agent](#agent), usually managed by a
[harness](#harness). When an agent restarts, it runs in a new agent session.
Always write "agent session" or "[review session](#review-session)", never just
"session".

### Agent tree

A [main agent](#main-agent) and the [sub-agents](#sub-agent) it started, as
reported by the agents or their [harness](#harness). It's never inferred from
git. The agent tree is used to show who changed what and to filter the
[review UI](#review-ui) by agent. It doesn't define what a review session
covers. See [0004](decisions/0004-agent-tree-is-an-input.md).

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
changes are compared against.

### Comment

A note the [reviewer](#reviewer) leaves in a [review session](#review-session).
There are two kinds:

- **Line comment:** on a single line or a range of lines in a file. It has an
  [anchor](#anchor) and an [anchor state](#anchor-state).
- **Overall comment:** not attached to code. It belongs to the review session.

A comment is available to agents as soon as it's saved, and has a
[comment status](#comment-status). See
[0018](decisions/0018-agents-list-open-comments.md).

### Comment status

Whether a [comment](#comment) has been dealt with:

- **Open:** not yet addressed. Every comment starts open.
- **Addressed:** an agent has marked it addressed.
- **Resolved:** the [reviewer](#reviewer) checked the agent's work and resolved
  it.

The reviewer can reopen a comment, which sets it back to open. This is separate
from its [anchor state](#anchor-state). See
[0018](decisions/0018-agents-list-open-comments.md).

### Diff mode

What the diff compares for a git [working directory](#working-directory):

- **All changes:** the [base ref](#base-ref) to the working tree.
- **Committed:** the base ref to `HEAD`.
- **Staged:** `HEAD` to the index.
- **Unstaged:** the index to the working tree.
- **Last turn:** the previous [turn snapshot](#turn-snapshot) to the current
  state.

A working directory that doesn't use git has no diff modes.

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

### Main agent

The agent at the top of an [agent tree](#agent-tree).

### Registration

An agent, or its [harness](#harness), reporting the agent to the
[review server](#review-server): its ID, its parent, and its
[working directories](#working-directory).

### Review server

The local server that stores review state in SQLite, watches
[working directories](#working-directory) for changes, serves the
[review UI](#review-ui), and provides the API that the review UI and the
`agent-diff` CLI call. See [0011](decisions/0011-api-core-with-cli-client.md).

### Review session

A set of [working directories](#working-directory) under review, identified by
an ID. An [actor](#actor) starts a review session through an API call, working
directories can be added after it starts, and the [reviewer](#reviewer) leaves
[comments](#comment) in it. A review session is archived, which stops watching
its working directories and makes it read-only, or deleted, which removes its
data. See [0009](decisions/0009-review-sessions-and-claims.md) and
[0018](decisions/0018-agents-list-open-comments.md).

### Review UI

The local web app where the [reviewer](#reviewer) views a
[review session](#review-session)'s diffs and writes [comments](#comment). See
[0001](decisions/0001-local-web-app.md).

### Reviewer

The human reviewing code and writing [comments](#comment) in the
[review UI](#review-ui).

### Self-review

A review of an [agent session](#agent-session)'s changes by a
[sub-agent](#sub-agent) that didn't write them, before the pull request opens.
See [0030](decisions/0030-self-review-before-the-pull-request-opens.md).

### Sub-agent

An agent started by another agent.

### Turn

One stretch of work an agent does in response to a prompt.

### Turn snapshot

The state of a [working directory](#working-directory) recorded at a
[turn](#turn) boundary. Used by the "Last turn" [diff mode](#diff-mode).

### Working directory

A directory on disk that agents make changes in and that
[review sessions](#review-session) cover. It may be a git repo, a git worktree,
or a directory inside a repo, or it may not use git at all. The diff and the
[file view](#file-view) only include files under it, even when git runs against
the whole repo. In a git working directory, the branch is whatever `HEAD` points
to, and isn't part of the working directory. A working directory that doesn't
use git has no diffs. A working directory can be in several review sessions. See
[0013](decisions/0013-working-directories.md).
