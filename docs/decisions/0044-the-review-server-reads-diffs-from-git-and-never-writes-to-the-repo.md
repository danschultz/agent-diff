# 0044: The review server works out diffs by reading git, and never writes to the repo

- Status: Accepted
- Date: 2026-10-24

## Problem

A [session](../glossary.md#session) lists its
[working directories](../glossary.md#working-directory), each git one with its
[base ref](../glossary.md#base-ref)
([0040](0040-sessions-have-short-ids-and-cover-working-directories-by-real-path.md)),
but nothing shows what changed in them yet. Before the
[review UI](../glossary.md#review-ui) can show a diff, the
[review server](../glossary.md#review-server) needs to know, for each
[diff mode](../glossary.md#diff-mode), what each side of the diff is, how it
reads git, and what it returns for the [file view](../glossary.md#file-view) and
for each file.

The [prototype](../../prototype/README.md#findings-so-far) answered these by
running `git add -A` into a private index and `git write-tree` on every refresh.
That leaves the user's index, refs, and stash alone, but writes loose objects
into the repo's own object database, thousands of them after a day of agent
edits, which can set off `git gc --auto` during the user's next commit
([productization notes, 3.2](../../prototype/docs/productization-decisions.md#32-git-footprint-in-the-users-repos)).
It also found that spawning git costs tens of milliseconds per command, so the
number of git commands per request matters more than what each one does
([3.4](../../prototype/docs/productization-decisions.md#34-git-access-strategy)).

## Solution

### Diff modes

- **The four git diff modes** from the README compare:
  - **All changes:** the merge-base of the base ref and `HEAD`, to the working
    tree.
  - **Committed:** the merge-base of the base ref and `HEAD`, to `HEAD`.
  - **Staged:** `HEAD` to the index.
  - **Unstaged:** the index to the working tree.
- **"Last turn" waits for turn reporting,** which is still an open question in
  the README.
- **The merge-base is found with `git merge-base <base ref> HEAD`,** so the diff
  shows what a pull request would, and not what landed on the base ref since the
  branch started, as 0040 expected.
  - With no merge-base, the base ref's own commit is used.
  - With an unborn `HEAD`, both the base side and `HEAD` are the empty tree.
- **A base ref that doesn't resolve is that working directory's error.** The
  error is returned for that working directory only, and the others in the
  session still load.

### Never writing to the repo

- **The review server only runs git commands that read.** It never writes
  objects, refs, the index, or config, so there's nothing for users to notice or
  clean up. This rules out the prototype's private index.
- **Every git command runs with `GIT_OPTIONAL_LOCKS=0`,** so commands such as
  `git diff` don't refresh the index.
- **Tracked changes come from `git diff` with rename detection (`-M`):**
  - `git diff <merge-base>` for All changes.
  - `git diff <merge-base> HEAD` for Committed.
  - `git diff --cached` for Staged.
  - `git diff` for Unstaged.
- **Untracked files come from `git ls-files --others --exclude-standard`.**
  They're listed with the status "untracked" in All changes and Unstaged, and
  read from disk.
- **The old side's contents come from git objects:** `<commit>:<path>`, or
  `:<path>` for the index.
- **The new side's contents come from:**
  - disk, for the working tree.
  - `HEAD:<path>`, for Committed.
  - `:<path>`, for Staged.
- **Git isn't spawned per file when one command can cover a working directory,**
  because each spawn costs tens of milliseconds. A long-running
  `git cat-file --batch` per working directory is allowed.

### Paths and working directories

- **Git runs in the working directory.** A working directory inside a repo is
  limited to its own files with a pathspec, as
  [0013](0013-working-directories.md) requires.
- **Paths are shown and sent relative to the working directory.**
- **The API names a working directory by the real path** that 0040 stores, with
  no separate ID. Comment anchors will use the same path.
- **Contents are only returned for a path in that working directory's file list
  for that diff mode.** The review server rejects absolute paths and paths with
  `..`.
- **Symlinks are never followed.** A symlink's contents are the link's target,
  as git stores it.

### The file list

Each file in a working directory's file list has:

- its path, and its old path when it was renamed.
- its git status: added, modified, deleted, renamed, untracked, and others such
  as a type change or a conflict when they apply.
- its added and removed line counts, from `--numstat` for tracked files, and
  counted from disk for untracked ones.

### File contents

- **A side is binary when its first 8,000 bytes contain a NUL byte.** It has no
  contents and no line counts.
- **A side over 2 MB isn't sent,** and keeps its line counts.
- **A submodule has its status and no contents.**

### API

Two procedures, grouped under `diff`
([0021](0021-orpc-and-valibot-build-the-api.md)):

- **One returns every working directory's file list** for a session and a diff
  mode, with each working directory's merge-base commit or its error.
- **One returns one file's old side and new side.**

Both take the diff mode as input. Inputs are validated with Valibot, and both
need the token
([0031](0031-the-review-ui-gets-the-token-in-the-url-fragment.md)).

## Tradeoffs

Benefits:

- Users never find anything changed in their repos: no loose objects, refs,
  index updates, or config, and nothing to clean up or document.
- Comparing from the merge-base matches what a pull request shows, so changes
  that landed on the base ref after the branch started aren't shown as the
  agent's.
- Errors stay with the working directory that has them, so one deleted branch
  doesn't hide every other working directory's diff.
- Plain `git diff` and `git ls-files` respect attributes, filters, `.gitignore`,
  and sparse checkouts, because they're git.
- Only paths from the file list are read, so the API can't be used to read other
  files on the machine, and symlinks can't point it outside the working
  directory.

Costs:

- Without a private index, untracked files are read from disk on every request,
  both to count their lines and to send their contents.
- Each request spawns git at least once per working directory, which adds up in
  a session with ~50 working directories.
- `GIT_OPTIONAL_LOCKS=0` means git can't save the stat information it refreshes,
  so in a repo whose index is out of date, `git diff` may re-read files on every
  request until the user runs a git command that refreshes it.
- A file whose side is over 2 MB, or binary, can't be reviewed line by line in
  the review UI.
- A base ref that's a branch makes the merge-base move as either branch moves,
  so the same diff mode can show a different diff after a fetch or a rebase.

## Follow-up design choices

- **The "Last turn" diff mode,** once turn reporting is designed.
- **Listing files in working directories that don't use git,** which
  [0013](0013-working-directories.md) says the file view lists in full.
- **Caching git results once live reload lands**
  ([0007](0007-live-reload-from-file-watching.md)), such as keeping file lists
  until the file watcher reports a change, and contents keyed by object ID.
