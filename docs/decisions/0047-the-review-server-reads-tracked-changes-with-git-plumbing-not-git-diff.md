# 0047: The review server reads tracked changes with git's plumbing commands, not `git diff`

- Status: Accepted
- Date: 2026-10-27

## Problem

[0044](0044-the-review-server-reads-diffs-from-git-and-never-writes-to-the-repo.md)
says the [review server](../glossary.md#review-server) never writes to a
[working directory](../glossary.md#working-directory)'s repo, and that tracked
changes come from `git diff`, such as `git diff <merge-base>` for the All
changes [diff mode](../glossary.md#diff-mode). It expects `GIT_OPTIONAL_LOCKS=0`
to keep `git diff` from refreshing the index.

Building All changes showed that it doesn't. With git 2.47, `git diff <commit>`
compares the working tree with the index's stat information, and whenever a
file's modification time no longer matches it, git checks the file's contents
and then rewrites `.git/index` with the refreshed stat information, whatever
`GIT_OPTIONAL_LOCKS` says. That happens after a checkout, a `touch`, or an
editor that saves files it didn't change. A test that compares every file under
`.git` before and after the `diff` procedures caught it. The plumbing commands
that `git diff` runs underneath never write the index.

## Solution

- **Tracked changes come from git's plumbing commands,** which only read:
  - **All changes:** `git diff-index <merge-base>`, the command
    `git diff <merge-base>` runs.
  - **Committed:** `git diff-tree -r <merge-base> HEAD`.
  - **Staged:** `git diff-index --cached HEAD`.
  - **Unstaged:** `git diff-files`.

  They take the same options as `git diff` in 0044, such as `-M`, `--raw`,
  `--numstat`, and `--relative`. Untracked files still come from
  `git ls-files --others --exclude-standard`, and every git command still runs
  with `GIT_OPTIONAL_LOCKS=0`.

- **Files whose modification time changed but whose contents didn't are left
  out, as `git diff` leaves them out.** `git diff-index` without `--cached`, and
  `git diff-files`, compare the working tree by the index's stat information, so
  they list every file whose modification time no longer matches it as modified,
  with no new object. For each of these:
  - **A text file** that `--numstat` doesn't list has the same contents on both
    sides, since `--numstat` leaves out files with no changed lines.
  - **A binary file,** which `--numstat` always lists, has the same contents
    when `git hash-object` hashes it, through its filters, to the old side's
    object. A symlink is hashed as its target. Without `-w`, `hash-object`
    writes nothing.
  - **A request for one file's contents** doesn't run `--numstat`, so it hashes
    that one file when it's one of these.

  One `git hash-object --stdin-paths` covers every binary file in a working
  directory, so git still isn't spawned per file.

### Effect on earlier decisions

- **[0044](0044-the-review-server-reads-diffs-from-git-and-never-writes-to-the-repo.md).**
  Amended. Tracked changes come from `git diff-index`, `git diff-tree` and
  `git diff-files` instead of `git diff`, and files whose contents didn't change
  are left out. Of its tradeoffs:
  - "Plain `git diff` and `git ls-files` respect attributes, filters,
    `.gitignore`, and sparse checkouts" still holds. The plumbing commands
    compare contents through the same filters and attributes, and untracked
    files still come from `git ls-files`. What changes is that the plumbing
    commands ignore the user's `diff.*` settings, such as `diff.renames`,
    `diff.external`, and `diff.relative`, so the file lists don't depend on
    them.
  - "`GIT_OPTIONAL_LOCKS=0` means git can't save the stat information it
    refreshes, so in a repo whose index is out of date, `git diff` may re-read
    files on every request" becomes: the review server never saves refreshed
    stat information, whatever `GIT_OPTIONAL_LOCKS` says. In a repo whose index
    is out of date, each file list reads every file whose modification time
    changed, for `--numstat` and `hash-object`, until the user runs a git
    command that refreshes the index.

## Tradeoffs

Benefits:

- The review server really doesn't write to the repo. The index's contents and
  modification time stay the same however out of date it is.
- The file lists are the same as `git diff` would give, without its refresh.
- The output doesn't depend on the user's `diff.*` settings, so a setting such
  as `diff.renames=false` or `diff.external` can't change what the review UI
  shows.

Costs:

- The review server does what `git diff` would have done itself: it leaves out
  files whose contents didn't change, with code and tests of its own, and one
  more git spawn when binary files have out-of-date modification times.
- Files whose modification time changed are read again on every request until
  the user refreshes the index, and more of them can build up than before, since
  the review server never refreshes it.
- A future change to `git diff`'s refresh, or to what `--numstat` lists, has to
  be followed by hand.

## Follow-up design choices

- **Committed, Staged and Unstaged** will use the commands listed here when
  they're built. Only All changes uses them so far.
- **Caching** from 0044 could keep the hashes of files whose modification time
  changed, keyed by their stat information, once live reload lands.
