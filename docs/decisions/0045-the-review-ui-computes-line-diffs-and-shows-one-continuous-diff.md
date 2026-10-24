# 0045: The review UI computes line diffs, and shows one continuous diff with a file view

- Status: Accepted
- Date: 2026-10-24

## Problem

[0044](0044-the-review-server-reads-diffs-from-git-and-never-writes-to-the-repo.md)
decides what the [review server](../glossary.md#review-server) returns for a
[session](../glossary.md#session)'s diffs: each
[working directory](../glossary.md#working-directory)'s file list for a
[diff mode](../glossary.md#diff-mode), and one file's old side and new side at a
time. The [review UI](../glossary.md#review-ui) needs to turn that into the
session page the README describes: a diff of every changed file, a switcher for
the diff mode, and the [file view](../glossary.md#file-view) next to it.

Earlier decisions leave parts of this open:

- [0012](0012-codemirror-renders-diffs.md) chose CodeMirror and
  `@codemirror/merge`, but left open where diffs are computed, and how reviews
  with many files stay responsive.
- [0016](0016-tanstack-store-with-immer.md) left open where the
  `createImmerStore` helper lives.
  [0041](0041-the-review-ui-loads-data-with-tanstack-query.md) already answered
  how data loaded from the review server is held.

The [prototype](../../prototype/README.md#5-diff-viewers) already shows one
continuous diff with sticky file headers, mounting each file's editor near the
visible area. It found that `@codemirror/merge` marks most of a large file as
changed unless whole lines are matched first
([findings](../../prototype/README.md#findings-so-far)). Its
[productization notes](../../prototype/docs/productization-decisions.md#62-diff-api-shape)
suggested the review server send hunks instead of full contents, so the browser
doesn't diff 300 files.

## Solution

### Where diffs are computed

- **The review server sends both sides' full contents, one file at a time**
  (0044). The review UI fetches a file's contents the first time its editor
  mounts.
- **The review UI diffs whole lines with jsdiff** and gives the chunks to
  `@codemirror/merge`, which runs its character diff only inside changed blocks,
  as the prototype's `lineDiff.ts` does.
- **The whole-line diff lives in `packages/shared`,** so re-anchoring on the
  review server can use the same diff later
  ([0008](0008-comment-reanchoring.md)).

### The diff mode switcher

- **One switcher on the session page sets the diff mode** for every git working
  directory in the session. The default is All changes.
- **The diff mode is kept in the URL's query,** such as
  `/sessions/s_7kq9a1?mode=staged`, so a reload keeps it. A missing or unknown
  `mode` means All changes.

### The diff

- **One continuous page of every changed file,** in file view order. Files are
  grouped by working directory, in the order the working directories were added,
  and sorted by path within each one.
- **Each file's header sticks to the top while its file is in view.** It shows
  the path, the old path for renames, the git status, and the added and removed
  line counts.
- **The unified layout is `unifiedMergeView`,** with old line numbers on removed
  lines. Unchanged lines collapse to 3 lines of context. The split layout comes
  later.
- **A file's editor mounts when the file comes within about 1,200 px of the
  visible area,** and unmounts when it's more than about 4,000 px away. An
  unmounted file keeps its last height, so the scroll position doesn't jump.
- **Syntax highlighting uses `@codemirror/language-data`,** with each language
  loaded when it's first needed. Plain text is the fallback.
- **Binary files, files too large to show, and submodules** show a placeholder
  instead of a diff.
- **Working directories that don't use git** show a one-line note that their
  files aren't listed yet. Ones missing on disk say so. Ones with no changes in
  the diff mode say so.
- **Archived sessions show the current diff,** the same as active ones.

### The file view

- **A side panel next to the diff, with a tree view and a list view.**
  - The tree view groups files by directory, and marks directories that contain
    changes, so collapsed folders still show where the work is.
  - The list view shows flat paths.
- **The choice between them is remembered in `localStorage`.**
- **Files are grouped by working directory,** as in the diff.
- **Each file shows its git status, its line counts, and its old path when
  renamed.** Clicking a file scrolls the diff to it.
- **The file view is virtualized with `@tanstack/react-virtual`,** so it stays
  responsive with 10,000 changed files.

### State

- **Stores follow 0016,** created with a `createImmerStore` helper kept in
  `packages/ui/src/`.
- **Data loaded from the review server, such as file lists and contents, is
  loaded with TanStack Query,** through oRPC's query options, as 0041 says.
  Stores hold the reviewer's own state.

### Effect on earlier decisions

- **[0012](0012-codemirror-renders-diffs.md).** Answers the "Where diffs are
  computed" follow-up: the review server sends full contents, and the review UI
  diffs whole lines. Partly answers "Many-file reviews" with the mounting
  distances. The follow-up on comments on removed lines in the unified layout
  stays open, for the comment anchors decision.
- **[0016](0016-tanstack-store-with-immer.md).** Answers "Where the helper
  lives": `createImmerStore` is kept in `packages/ui/src/`.
- **[0002](0002-show-unchanged-files.md)** isn't changed. Unchanged files and
  the "show all files" toggle come later.

## Tradeoffs

Benefits:

- The review server stays simple: it returns file lists and contents, and
  doesn't compute or send hunks.
- The same whole-line diff, in `packages/shared`, serves the review UI and
  re-anchoring, so a comment's lines and the diff the reviewer saw can't
  disagree because of two diff algorithms.
- Character diffs only run inside changed blocks, so `@codemirror/merge` doesn't
  give up on large files and mark most of them as changed.
- Only files near the visible area have an editor or fetch contents, so a
  session with hundreds of files loads one file list, not every file.
- The diff mode in the URL survives a reload and can be shared as a link.
- A virtualized file view renders only the rows in view, however many files
  changed.

Costs:

- Full contents go over the wire, up to 2 MB per side, even for a one-line
  change.
- A file's diff isn't ready until its editor mounts and its contents load, so
  scrolling quickly shows files before their diffs.
- The line diff runs in the browser, on the main thread, each time an editor
  mounts, which is noticeable on a large file near the 2 MB limit.
- An unmounted file's last height is a guess until it has mounted once, so the
  scroll bar can change length as files mount.
- Keeping unchanged files and the split layout for later means the reviewer
  can't read surrounding code or compare sides next to each other yet.

## Follow-up design choices

- **The split layout,** with `MergeView`
  ([0012](0012-codemirror-renders-diffs.md)).
- **The "show all files" toggle** ([0002](0002-show-unchanged-files.md)).
- **Live reload** ([0007](0007-live-reload-from-file-watching.md)): how a pushed
  change updates file lists and the contents of mounted files.
- **Search across files,** when most lines aren't rendered.
- **Collapsing files,** and **"Viewed" checkboxes.**
- **How long contents of unmounted files stay in TanStack Query's cache,** which
  trades memory for refetching a file scrolled back to.
- **Comments on removed lines in the unified layout** stay open in 0012, for the
  comment anchors decision.
