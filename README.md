# agent-diff

A code review tool for humans reviewing the output of coding agents.

> Status: planning. Nothing is implemented yet. This document describes the
> intended product so that humans and agents working in this repo share the
> same picture. Terms are defined in the [glossary](docs/glossary.md).

## Why

Agents (and fleets of agents) increasingly make changes across one or many
repositories at once. Reviewing that work today means jumping between terminals,
branches, and `git diff` invocations, then copy-pasting feedback back into a
chat. `agent-diff` gives the reviewer a single UI that shows what changed in
every working directory, lets them leave line-level and overall comments, and
sends that feedback back to agents to address.

## Typical workflow

1. An actor (human or agent) asks an agent to make a code change in one or
   more repos.
2. That agent, or a fleet of sub-agents it delegates to, makes the changes,
   each in its own working directory.
3. An actor starts a review session over the working directories to review.
   For example, a human asks the main agent to start one covering all of its
   sub-agents' working directories, or asks a sub-agent to start one for its
   own. Working directories can be added to the review session later.
4. The review UI opens for that review session. The reviewer can switch between
   working directories, and filter by agent when the agent tree is known.
5. The reviewer sees the changed files in the file view and a diff comparing
   each working directory to its base ref. A working directory doesn't have
   to be a git repo. If it doesn't use git, the file view lists all its files
   and there's no diff.
6. The reviewer adds comments on a single line, a range of lines, or the
   review as a whole. Comments are drafts until they're submitted.
7. The reviewer submits a review to the review session, then tells the agent to
   apply it, for example "Apply the latest feedback." The agent claims a working
   directory, fetches the most recent review with `agent-diff review`, and
   addresses its comments. Agents don't block while a review session is open, so
   the human can keep working with them in the meantime.
8. Whenever any actor changes the code, the diff updates live. The review
   server watches the file system, so this includes agents in other processes
   and humans editing in their IDE.
9. The review session ends through an API call, from the reviewer in the
   review UI, an agent, or other automation.

## Decisions

Design decisions, with their tradeoffs and follow-up choices, are recorded in
[docs/decisions](docs/decisions/README.md). So far:

- The review UI is a local web app.
- The file view can show unchanged files.
- The reviewer can open the code in an IDE.
- The agent tree is reported by agents and harnesses, not inferred from git.
- The user prompts the agent to apply a review, and the agent fetches the
  most recent review from the review server. The server never contacts
  agents.
- Review state is stored in SQLite, so it survives crashes and restarts.
- The review UI live-reloads by watching the file system.
- Comments follow the code as it changes, and are marked outdated rather
  than guessed when their lines change.
- Reviews are submitted to review sessions, and agents claim feedback per
  working directory.
- The review server has an API. Agents and harnesses use the `agent-diff`
  CLI, which calls it. There's no MCP server.
- The review UI renders diffs with CodeMirror.
- Review sessions cover working directories, which don't have to use git.
  Only files under the working directory are shown, and the branch is
  whatever `HEAD` points to.

## Diff modes

For a working directory that uses git, the reviewer can switch what the diff
shows:

| Mode        | Compares                                                  |
| ----------- | --------------------------------------------------------- |
| All changes | Base ref to the working tree (committed, staged, unstaged) |
| Committed   | Base ref to `HEAD`                                        |
| Staged      | `HEAD` to the index                                       |
| Unstaged    | The index to the working tree                             |
| Last turn   | The previous turn snapshot to the current state           |

"Last turn" means the most recent batch of changes an agent made. Git can't
work this out by itself, so the tool must record a turn snapshot (for
example, a hidden ref or stash-like commit) at turn boundaries.

## File view

Next to the diff, the review UI shows the files in a **tree view** (grouped
by directory) or a **list view** (flat paths), and the reviewer can switch
between them.

- The diff mode filters the files. By default, only files that changed in the
  selected mode are listed, so switching from "All changes" to "Staged"
  narrows the view to staged files.
- A "show all files" toggle also lists unchanged files, so the reviewer can
  open the code around a change. Selecting an unchanged file shows its full
  contents. Changed files stay visually distinct and keep their status.
- Each file shows its git status for the selected mode: added, modified,
  deleted, renamed (with the old path), or untracked. Other statuses, such as
  a type change or a merge conflict, are shown when they apply.
- Selecting a file jumps to its diff. Each file also shows how many comments
  it has and how many lines were added and removed.
- In the tree view, a directory shows when it contains changes, so collapsed
  folders still show where the work is.
- With several working directories in the review session, files are grouped
  by working directory.
- For a working directory that doesn't use git, there are no diff modes or
  git statuses, and the file view lists all its files.

## Integrations

There should be deeper integration with agent and terminal tooling where it
helps, for example:

- **cmux**: open the review UI in a pane or browser surface next to the
  agent's terminal.
- **otty** and **herdr**: equivalent hooks for opening the review UI.

Agents and harnesses start review sessions, claim working directories, and fetch
reviews through the `agent-diff` CLI, a small, documented interface that any
harness can adopt. The CLI calls the review server's API, which the review
UI also uses.

### Open in an IDE

From the review UI, the reviewer can open the code in their editor, for
example VS Code or IntelliJ:

- **Open working directory**: opens the working directory as a project.
- **Open branch**: for a git working directory, opens the branch being
  reviewed. If that branch isn't checked out in a worktree, the tool needs
  to create a worktree for it (or ask first) rather than switching the
  branch of an existing checkout.
- **Open file**: opens the selected file, at the selected line when there is
  one, from the diff or the file view.

The review server launches the editor through its command-line tool (such as
`code` or `idea`) or its URL scheme. Which editors are offered, and the
default, are configurable.

## Future ideas

These ideas aren't committed yet. They're listed so the design doesn't rule
them out.

### Agents reply to comments

After addressing feedback, the agent replies in each comment's thread and
gives it a status, such as addressed, declined, or needs input. Comments
become threads that both the reviewer and the agent can add to, and the
reviewer resolves them. Replies are one more message from the agent to the
review server, so no new kind of connection is needed.

Examples of how this helps:

- **Verifying fixes quickly.** "Addressed: added the null check," with a
  link to the change. The reviewer jumps straight to the change that fixes
  the comment instead of re-reading the whole diff.
- **Pushback with reasons.** "Declined: this function runs on the hot path,
  and the extra validation already happens in the caller." The reviewer sees
  why instead of finding the comment silently ignored.
- **Asking instead of guessing.** "Needs input: should this rename apply to
  the public API too, or only to internal callers?" The agent stops and
  asks rather than making a broad change on a guess.
- **Showing extra scope.** "Fixed here and in three other files that had the
  same bug." The reviewer knows to look at changes they didn't ask for.
- **Reporting blockers.** "Couldn't address this: the test needs a database
  that isn't available in this environment." The reviewer learns why
  nothing changed.
- **Focused follow-up reviews.** The next review shows only threads that are
  still open, so the reviewer doesn't re-check comments that are already
  settled.

## To do

- **Clarify glossary terms.** Go through [docs/glossary.md](docs/glossary.md)
  and resolve these unclear spots:
  - A [comment](docs/glossary.md#comment) is a draft "until its review is
    submitted," but a [review](docs/glossary.md#review) only exists once it's
    submitted, so drafts point to a review that doesn't exist yet.
  - The "Last turn" [diff mode](docs/glossary.md#diff-mode) doesn't say whose
    turn it is when several agents work in one working directory, and it says
    "current state" where the other modes say "working tree."

## Open questions

None right now. Follow-up choices that come out of a decision are listed in
that decision's file.
