# Avoiding performance bottlenecks

Catch obvious bottlenecks, and don't optimize what stays small. See
[0030](../docs/decisions/0030-self-review-before-the-pull-request-opens.md).

## Judging the cost

Big-O is one input to how serious a cost is, not the whole measure. A quadratic
loop over the working directories in a session doesn't matter. A quadratic loop
over the lines of a 40,000-line lockfile diff, run on every file-system event,
does. Judge three things together:

1. **Complexity:** how the work grows. Exponential is worse than polynomial,
   which is worse than linear, which is worse than constant.
2. **What n is, and how big it gets in agent-diff:** files, diff lines, working
   directories, comments, or file-system events. Use the sizes below.
3. **How often it runs:** once at startup, once per request, or on every
   file-system event or render.

A cost is a problem only when all three line up: the work grows faster than it
should, n is large in practice, and the code runs often. Name all three when
reporting one, such as "this is O(files × comments), which is 10,000 × 500 on
every file-system event".

## Sizes to design for

| What grows                       | Size to design for                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| Working directories in a session | ~50 (a fleet of agents)                                                                 |
| Files in a working directory     | ~10,000. A working directory that doesn't use git lists every file, `node_modules` too. |
| Lines in one file's diff         | ~50,000 (lockfiles, generated code)                                                     |
| Comments in a session            | ~500                                                                                    |
| File-system events               | Thousands per second during `npm install` or `git checkout`                             |

These are a starting point. Change them here when they turn out to be wrong.

## What to watch for in agent-diff

- **`node:sqlite` is synchronous.** Every query blocks the event loop, and with
  it the file watcher and every client
  ([0022](../docs/decisions/0022-node-sqlite-plain-sql-and-dbmate.md)). That
  makes N+1 queries and unindexed scans worse here than they would be with an
  async driver.
- **File-watcher fan-out.** The obvious bug is "on any change, recompute
  everything". Re-diff only the changed paths, and batch events that arrive in
  bursts.
- **Diffing.** A hand-written diff using the textbook LCS algorithm is O(n·m) in
  time and memory, which is too slow on a lockfile. Use a library or Myers'
  algorithm.
- **Re-rendering the review UI.** Components that subscribe to the whole
  TanStack Store, or a [file view](../docs/glossary.md#file-view) that isn't
  virtualized, re-render too much. CodeMirror only virtualizes the editor's own
  lines.

## Simplicity comes first

Don't make code more complex for constant-factor gains, or to speed up work over
something that stays small. Keep code as simple as it can be until the sizes
above say otherwise.

## Testing performance fixes

Tests that check timing are flaky in CI, so a performance fix doesn't need a
failing test first. Write one when the cost can be checked without timing, such
as a scaling test that counts queries, or a test with a timeout that a
catastrophically backtracking regex would fail. See
[`.rules/testing.md`](testing.md).
