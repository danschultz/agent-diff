# 0015: Closing a brief's issue clears its agent labels, in a GitHub Actions workflow

- Status: Superseded by [0031](0031-briefs-are-aven-tasks.md)
- Date: 2026-10-12

> Superseded by [0031](0031-briefs-are-aven-tasks.md): briefs are Aven tasks, so
> there are no labels to clear. `implement` removes a brief's `agent` metadata
> when it lets the brief go, and the workflow is removed.

## Problem

When `implement` finished with a brief, it removed the worktree and branch but
left the `agent:*` labels on the issue. Closed issues kept a stale state such as
`agent:review`. Issue #7, closed by merging #8, is an example.

Two things needed deciding: what clears the labels, and what happens to the
issue when its pull request is closed without merging.

## Solution

- **A GitHub Actions workflow clears the labels.**
  `.github/workflows/clear-agent-labels.yml` runs when an issue is closed and
  removes every `agent:*` label from it. Labels that aren't `agent:*` are left
  alone, and an issue with no `agent:*` labels isn't changed.
- **The logic is shared with `implement`.** The workflow checks out
  `tools/implement`, sets up Node 24, and runs `implement clear-labels <issue>`.
  That uses the same `LABELS`, the same `gh` wrapper, and a `clearLabels` helper
  next to `moveTo` in `github.ts`. The workflow has no logic of its own, not
  even a filter on labels: it runs for every closed issue, and the CLI decides
  whether there's anything to remove. The helper is covered by `npm test`.
- **`implement` doesn't touch labels when it finishes with a brief.** Its reap
  step still stops the agent session and removes the worktree and branch.
- **Closing a pull request without merging leaves the issue open.** "Closes #N"
  only closes the issue on merge. If Dan wants the issue closed too, Dan closes
  it by hand, and the workflow then clears its labels.

## Tradeoffs

Benefits:

- Labels are cleared as soon as the issue closes, whether or not the server
  running `implement` is up or its tick fails.
- The workflow only needs the issue that was closed, so it never has to work out
  which issue a pull request belongs to.
- Issues Dan closes by hand, such as a failed brief or one Dan called off, are
  covered too.

Costs:

- An issue whose pull request was closed without merging keeps its `agent:*`
  labels, such as `agent:review`, while it stays open, even though `implement`
  no longer tracks it.
- The workflow runs for every closed issue, including ones that were never
  briefs, though it changes nothing on them.
- The workflow only runs from the default branch, so it can't be tried before
  it's merged.
- Label cleanup is triggered from outside `tools/implement/`, and the workflow
  depends on `implement` running with only `gh` and `IMPLEMENT_REPO`.

## Follow-up design choices

- **Backfilling.** Issues already closed with `agent:*` labels, such as #7,
  aren't cleared until they're closed again or the labels are removed by hand.
