# 0007: The UI live-reloads by watching the file system

- Status: Accepted
- Date: 2026-10-10

## Problem

The diff and file view must stay current while the code changes. Changes can
come from any actor: an agent in another process, a sub-agent in another
worktree, or a human editing in their IDE. The UI could refresh when agents
report changes, or by watching the files directly.

## Solution

The review server watches the file system of every workspace in the review
session.
When something changes, it recomputes the affected diffs and file statuses
and pushes the update to the browser.

The server watches both the working tree and the parts of the git directory
that the diff modes depend on:

- Working tree files, for "All changes", "Unstaged", and "Last turn".
- The index, for "Staged".
- `HEAD` and refs, for "Committed" and to notice branch switches.

Agent events, such as turn boundaries
([0004](0004-agent-tree-is-an-input.md)), are still used for snapshots, but
the UI doesn't rely on them to refresh.

## Tradeoffs

Benefits:

- It catches changes from every actor, including humans and processes that
  never talk to the app.
- It needs no cooperation from agents, so plain repos with no registered
  agents also update live.
- There's one refresh path, whatever made the change.

Costs:

- **Bursts of events.** Agents rewriting many files, a branch checkout, or a
  build writing output produce floods of events. The server has to debounce
  them and ignore paths that don't matter, such as files ignored by
  `.gitignore`.
- **Platform differences.** File-watching APIs differ between operating
  systems, and large repos can hit watch limits.
- **Unusual save patterns.** Editors that save by writing a temporary file
  and renaming it, and git's lock files, produce event sequences that need
  careful handling.
- **No attribution.** A file event doesn't say who made the change. Knowing
  which agent changed what still depends on agent reports and snapshots.
- **Half-finished states.** The reviewer can see code while an agent is in
  the middle of changing it.
- **Cost of recomputing.** Recomputing diffs on every change can be slow in
  large repos unless only the affected files are recomputed.

## Follow-up design choices

- **Debounce timing.** How long to wait after a burst of events before
  refreshing.
- **What to watch.** Which paths are watched and which are ignored, and
  whether to fall back to polling where watching isn't reliable.
- **Changes under the reviewer.** What the UI does when lines change while
  the reviewer is reading them or drafting a comment on them: update in
  place, or show a "this file changed" notice and let the reviewer refresh.
- **Re-anchoring comments.** How changes trigger moving comments to follow
  the lines they refer to.
- **Showing activity.** Whether the UI shows that an agent is mid-turn, so
  the reviewer knows the code is still changing.
