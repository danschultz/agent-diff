# 0003: The reviewer can open the code in an IDE

- Status: Accepted, amended by [0013](0013-working-directories.md)
- Date: 2026-10-09

> **Amended by [0013](0013-working-directories.md):** "Open worktree" is
> now "Open working directory." "Open branch" applies only to git working
> directories.

## Problem

Some review work needs a full IDE: jumping to definitions, finding usages,
running tests, or debugging. Rebuilding those features in the review UI isn't
practical.

## Solution

From the review UI, the reviewer can open the code in an editor such as VS
Code or IntelliJ:

- **Open worktree**: opens the working directory as a project.
- **Open branch**: opens the branch being reviewed. If that branch isn't
  checked out in a worktree, the tool creates a worktree for it (or asks
  first) rather than switching the branch of an existing checkout.
- **Open file**: opens the selected file, at the selected line when there is
  one, from the diff or the file view.

The local server launches the editor through its command-line tool (such as
`code` or `idea`) or its URL scheme. Which editors are offered, and the
default, are configurable.

## Tradeoffs

Benefits:

- The reviewer gets their usual tools instead of a weaker copy inside the
  review UI.
- Opening a separate worktree for a branch never disturbs a checkout an agent
  is working in.

Costs:

- Each editor needs its own launch integration.
- Worktrees created for review use disk space and must be cleaned up.
- If the reviewer edits code in the IDE while an agent is still working in
  the same worktree, their changes can conflict.
- Launching processes from a web page relies on the local server being locked
  down (see [0001](0001-local-web-app.md)).

## Follow-up design choices

- Who cleans up worktrees created for review, and when?
- Should the UI warn when the reviewer opens a worktree an agent is actively
  changing?
- Which editors are supported first, and are installed editors detected
  automatically?
