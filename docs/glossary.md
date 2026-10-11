# Glossary

Terms agreed on for `agent-diff`, in alphabetical order. Use these terms as
defined here in all docs. See [`.rules/glossary.md`](../.rules/glossary.md)
for how to add, change, or remove terms.

### Actor

A human or agent that requests changes, makes changes, or starts a
[review session](#review-session).

### Agent

An AI coding agent that makes changes in one or more
[workspaces](#workspace).

### Agent session

One running instance of an [agent](#agent), usually managed by a
[harness](#harness). When an agent restarts, it runs in a new agent session.
Always write "agent session" or "[review session](#review-session)", never
just "session".

### Agent tree

A [main agent](#main-agent) and the [sub-agents](#sub-agent) it started, as
reported by the agents or their [harness](#harness). It's never inferred
from git. The agent tree is used to show who changed what and to filter the
[review UI](#review-ui) by agent. It doesn't define what a review session
covers. See [0004](decisions/0004-agent-tree-is-an-input.md).

### Anchor

The part of a [comment](#comment) that records exactly what it was written
on: the file path, the diff side, the line range, and the
[file version](#file-version). An anchor never changes. See
[0008](decisions/0008-comment-reanchoring.md).

### Anchor state

Where a [comment](#comment) is shown relative to the current code:

- **Current:** the commented lines are unchanged. The comment may have moved
  with lines added or removed above it.
- **Moved:** the commented lines changed or disappeared, but a strict content
  match found them elsewhere in the file.
- **Outdated:** the commented lines changed and no confident match was
  found. The comment is shown next to the replacement code, along with the
  original code.

This is about where the comment sits, not whether its feedback has been
addressed. See [0008](decisions/0008-comment-reanchoring.md).

### Base ref

The branch or commit that a [workspace](#workspace)'s changes are compared
against.

### Claim

An agent's lease on a [workspace](#workspace) in a
[review session](#review-session), taken so the agent can address that
workspace's unaddressed [feedback](#feedback). A workspace has at most one
active claim at a time. The agent renews the claim while working, and it
expires if the agent stops renewing it. The agent can also release a claim,
or complete it when the feedback is addressed. Claims are advisory: they
help agents coordinate but don't stop other processes from editing files.
See [0009](decisions/0009-review-sessions-and-claims.md).

### Comment

A note the [reviewer](#reviewer) writes on a single line, a range of lines,
or the [review](#review) as a whole (an overall comment). A comment is a
[draft](#draft) until its review is submitted. Each line or range comment
has an [anchor](#anchor) and an [anchor state](#anchor-state).

### Diff mode

What the diff compares for a [workspace](#workspace):

- **All changes:** the [base ref](#base-ref) to the working tree.
- **Committed:** the base ref to `HEAD`.
- **Staged:** `HEAD` to the index.
- **Unstaged:** the index to the working tree.
- **Last turn:** the previous [turn snapshot](#turn-snapshot) to the current
  state.

### Draft

A [comment](#comment) that hasn't been submitted yet as part of a
[review](#review).

### Feedback

The [comments](#comment) in submitted [reviews](#review), from the point of
view of the agent addressing them.

### File version

The full contents of a file at the point a [comment](#comment) was written
on it. Each file version is stored once and shared by every comment written
on it. See [0008](decisions/0008-comment-reanchoring.md).

### File view

The tree or list of files shown next to the diff in the
[review UI](#review-ui). It's filtered by the [diff mode](#diff-mode) and
shows each file's git status.

### Harness

A tool that runs and manages [agent sessions](#agent-session), such as cmux,
herdr, or otty.
Harnesses can register agents.

### Main agent

The agent at the top of an [agent tree](#agent-tree).

### Registration

An agent, or its [harness](#harness), reporting the agent to the
[review server](#review-server): its ID, its parent, and its
[workspaces](#workspace).

### Review

A batch of [comments](#comment) the [reviewer](#reviewer) submits to a
[review session](#review-session). A review can span several
[workspaces](#workspace), and a review session can receive many reviews over
time.

### Review server

The local server that stores review state in SQLite, watches
[workspaces](#workspace) for changes, serves the [review UI](#review-ui),
and provides the API that the review UI and the `agent-diff` CLI call. See
[0011](decisions/0011-api-core-with-cli-client.md).

### Review session

A set of [workspaces](#workspace) under review. An [actor](#actor) starts a
review session through an API call, workspaces can be added after it starts,
and [reviews](#review) are submitted to it. A review session ends through an
API call from the reviewer in the review UI, an agent, or other automation.
See [0009](decisions/0009-review-sessions-and-claims.md).

### Review UI

The local web app where the [reviewer](#reviewer) views a
[review session](#review-session)'s diffs and writes
[comments](#comment). See [0001](decisions/0001-local-web-app.md).

### Reviewer

The human reviewing code and writing [comments](#comment) in the
[review UI](#review-ui).

### Sub-agent

An agent started by another agent.

### Turn

One stretch of work an agent does in response to a prompt.

### Turn snapshot

The state of a [workspace](#workspace) recorded at a [turn](#turn)
boundary. Used by the "Last turn" [diff mode](#diff-mode).

### Workspace

A repo, the branch being reviewed, the worktree or working directory it's
checked out in, and the [base ref](#base-ref) it's compared against.
