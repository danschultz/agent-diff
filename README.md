# agent-diff

A code review tool for humans reviewing the output of coding agents.

> Status: planning. Nothing is implemented yet. This document describes the
> intended product so that humans and agents working in this repo share the same
> picture. Terms are defined in the [glossary](docs/glossary.md).

## Why

Agents (and fleets of agents) increasingly make changes across one or many
repositories at once. Reviewing that work today means jumping between terminals,
branches, and `git diff` invocations, then copy-pasting feedback back into a
chat. `agent-diff` gives the reviewer a single UI that shows what changed in
every working directory, lets them leave line-level and overall comments and
submit them as a review, and sends the agent a message to fetch the review and
reply to each comment.

## Typical workflow

1. An actor (human or agent) asks an agent to make a code change in one or more
   repos.
2. That agent, or a fleet of sub-agents it delegates to, makes the changes, each
   in its own working directory.
3. An actor starts a session over the working directories to review with
   `agent-diff session new [--base <ref>] <working-dir>...`, which prints the
   session's ID, its review UI link, and how to start a listener on it. Each git
   working directory is compared against `--base`, or by default against
   origin's default branch, `main`, `master`, or `HEAD`. For example, a human
   asks the main agent to start one covering all of its sub-agents' working
   directories, or asks a sub-agent to start one for its own. Working
   directories can be added to the session later.
4. The agent that started the session starts a listener in the background with
   `agent-diff session listen <session-id>`: with the Monitor tool in Claude
   Code, or as a watched background shell in the Cursor CLI. The listener prints
   a line for each review message, which starts a turn.
5. The review UI opens for that session. The reviewer can switch between working
   directories, and filter by agent when the agent tree is known.
6. The reviewer sees the changed files in the file view and a diff comparing
   each working directory to its base ref. A working directory doesn't have to
   be a git repo. If it doesn't use git, the file view lists all its files and
   there's no diff.
7. The reviewer leaves line comments on a single line or a range of lines, and
   overall comments that aren't attached to code. They're in the draft review
   until the reviewer submits it.
8. When the review is submitted, the review server sends the listening agent
   session a short review message, which tells it to finish what it's doing,
   then run `agent-diff review show <review-id>`. The agent addresses each
   comment and replies in its thread with
   `agent-diff comment reply <comment-id>`, marking it `--addressed` with what
   changed or `--needs-input` with a question. If no agent session is listening,
   the review message is held until a listener connects, and the reviewer can
   copy it from the review UI and paste it into any agent session.
9. The reviewer checks the work and resolves each comment, or replies to it,
   which reopens it in the next review. Agents don't block while a session is
   open, so the human can keep working with them in the meantime.
10. Whenever any actor changes the code, the diff updates live. The review
    server watches the file system, so this includes agents in other processes
    and humans editing in their IDE.
11. When the work is done, the reviewer, an agent, or other automation archives
    the session, which stops watching its working directories and keeps its
    comments read-only, or deletes it.

## Documentation

- **[Decisions](docs/decisions/README.md)** record each design decision, with
  its tradeoffs and the follow-up design choices it leaves open. Their index
  summarizes each one.
- **[Research](docs/research/README.md)** records what was found while
  investigating open questions, with the options and their tradeoffs.
- **[The glossary](docs/glossary.md)** defines the terms every doc uses.
- **[`AGENTS.md`](AGENTS.md)** tells agent sessions how to work in this repo:
  the rules in `.rules/` and when to read each one, the checks, and how to run
  the CLI, the review server, and the review UI.
- **Skills** in `.claude/skills/` hold processes Dan runs by name:
  [`/plan-work`](.claude/skills/plan-work/SKILL.md) plans work into briefs, and
  [`/create-brief`](.claude/skills/create-brief/SKILL.md) writes one brief.
- **[`implement`](tools/implement/README.md)** starts a headless agent session
  for each brief, and brings the work back as a pull request.

## Diff modes

For a working directory that uses git, the reviewer can switch what the diff
shows:

| Mode        | Compares                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------- |
| All changes | The merge-base of the base ref and `HEAD` to the working tree (committed, staged, unstaged) |
| Committed   | The merge-base of the base ref and `HEAD` to `HEAD`                                         |
| Staged      | `HEAD` to the index                                                                         |
| Unstaged    | The index to the working tree                                                               |
| Last turn   | The previous turn snapshot to the current state                                             |

"Last turn" means the most recent batch of changes an agent made. Git can't work
this out by itself, so the tool must record a turn snapshot (for example, a
hidden ref or stash-like commit) at turn boundaries.

## File view

Next to the diff, the review UI shows the files in a **tree view** (grouped by
directory) or a **list view** (flat paths), and the reviewer can switch between
them.

- The diff mode filters the files. By default, only files that changed in the
  selected mode are listed, so switching from "All changes" to "Staged" narrows
  the view to staged files.
- A "show all files" toggle also lists unchanged files, so the reviewer can open
  the code around a change. Selecting an unchanged file shows its full contents.
  Changed files stay visually distinct and keep their status.
- Each file shows its git status for the selected mode: added, modified,
  deleted, renamed (with the old path), or untracked. Other statuses, such as a
  type change or a merge conflict, are shown when they apply.
- Selecting a file jumps to its diff. Each file also shows how many comments it
  has and how many lines were added and removed.
- In the tree view, a directory shows when it contains changes, so collapsed
  folders still show where the work is.
- With several working directories in the session, files are grouped by working
  directory.
- For a working directory that doesn't use git, there are no diff modes or git
  statuses, and the file view lists all its files.

## Integrations

There should be deeper integration with agent and terminal tooling where it
helps, for example:

- **cmux**: open the review UI in a pane or browser surface next to the agent's
  terminal.
- **otty** and **herdr**: equivalent hooks for opening the review UI.

Agents and harnesses start sessions, listen for review messages, and fetch and
reply to comments through the `agent-diff` CLI, a small, documented interface
that any harness can adopt. The CLI calls the review server's API, which the
review UI also uses.

### Open in an IDE

From the review UI, the reviewer can open the code in their editor, for example
VS Code or IntelliJ:

- **Open working directory**: opens the working directory as a project.
- **Open branch**: for a git working directory, opens the branch being reviewed.
  If that branch isn't checked out in a worktree, the tool needs to create a
  worktree for it (or ask first) rather than switching the branch of an existing
  checkout.
- **Open file**: opens the selected file, at the selected line when there is
  one, from the diff or the file view.

The review server launches the editor through its command-line tool (such as
`code` or `idea`) or its URL scheme. Which editors are offered, and the default,
are configurable.

## To do

- **Clarify glossary terms.** In [docs/glossary.md](docs/glossary.md), the "Last
  turn" [diff mode](docs/glossary.md#diff-mode) doesn't say whose turn it is
  when several agents work in one working directory, and it says "current state"
  where the other modes say "working tree."

## Open questions

Follow-up choices that come out of a decision are listed in that decision's
file.

- **Reporting turns.** How agents or harnesses tell the review server where a
  turn starts and ends, so it can record the turn snapshots that the "Last turn"
  diff mode needs.
- **Registration.** Whether agents still register
  ([0004](docs/decisions/0004-agent-tree-is-an-input.md)) now that nothing in
  the comment flow needs to know which agent is which, and if so, the command
  for it. What's left is showing who changed what and filtering the review UI by
  agent. It's tied to reporting turns, since turn snapshots are what show who
  changed which lines.
