# 0012: The review UI renders diffs with CodeMirror

- Status: Accepted
- Date: 2026-10-11

## Problem

The review UI needs a diff renderer that stays fast on large files and on
reviews with many files, keeps up with live reload
([0007](0007-live-reload-from-file-watching.md)), and can show
[comments](../glossary.md#comment) inline. Comment placement, line selection,
and keyboard navigation will all be built on whatever renderer is chosen, so
switching later is expensive. This also answers part of the "Which frontend and
backend stack to use" follow-up in [0001](0001-local-web-app.md).

The [prototype](../../prototype/README.md#5-diff-viewers) has four renderers
behind its **Viewer** menu: Basic (a custom jsdiff table with no syntax
highlighting or virtualization), `@git-diff-view/react`, the Monaco diff editor,
and CodeMirror 6 with `@codemirror/merge`. Using them, CodeMirror felt the
snappiest and handled large files best. Before deciding, all four were measured
on the same diffs.

### Measurements

Measured on 2026-10-11 against the prototype's production build (`--static`) in
headless Chrome 156, on a 12-core Intel Atom C3858 VM with no GPU, at 1600×1000
with the side panel open. This CPU is slow, so the order matters more than the
absolute times. Each number is the median of 5 page loads (3 for 300 files). The
diffs are generated TypeScript files with evenly spread changes. All four
renderers collapse unchanged lines to 3 lines of context.

**Time until the first changed line is painted**, in ms, unified / split. This
includes about 600 ms to load the page and start the review UI.

| Diff                            |         Basic |                  git-diff-view |        Monaco |    CodeMirror |
| ------------------------------- | ------------: | -----------------------------: | ------------: | ------------: |
| 1,000 lines, 72 changed         |     728 / 753 |                  2,150 / 3,202 | 2,482 / 2,465 |     815 / 863 |
| 6,000 lines, 422 changed        | 1,162 / 1,278 |                 4,041 / 23,028 | 3,211 / 3,153 |     945 / 998 |
| 25,000 lines, 1,754 changed     | 4,254 / 4,835 | 14,918 / didn't paint in 120 s | 7,036 / 6,717 | 2,030 / 2,092 |
| 25,000 lines, 20 changed        |     775 / 782 |                  1,464 / 1,667 | 3,182 / 3,154 |   974 / 1,034 |
| 40 files, 320 changed lines     |     606 / 631 |                  1,786 / 2,398 | 4,126 / 4,145 | 1,102 / 1,223 |
| 300 files, 21,600 changed lines | 1,473 / 1,497 |                  4,184 / 6,484 | 4,162 / 4,617 | 1,557 / 1,641 |

**Cost of the 25,000-line file with 1,754 changed lines**, unified layout.
"Blocking" is the total main-thread time beyond 50 ms in each long task during
load, when the page can't respond to input.

|                       |  Basic | git-diff-view | Monaco | CodeMirror |
| --------------------- | -----: | ------------: | -----: | ---------: |
| Blocking (ms)         |  2,811 |        11,204 |  4,683 |      1,551 |
| Longest task (ms)     |  1,800 |         5,437 |  2,055 |      1,193 |
| JS heap after GC (MB) |   23.6 |         176.1 |   45.6 |       10.1 |
| DOM elements          | 47,359 |       116,863 | 29,400 |        847 |

CodeMirror only renders the lines in view, so its DOM stays the same size
however large the file is. Its heap grew from 5.4 MB at 1,000 lines to 10.1 MB
at 25,000.

**Live reload** after a one-line edit to the 6,000-line file while it's open,
unified / split. "Edit to painted" is the prototype's reload metric (first file
event to repaint). It doesn't wait for Monaco's diff, which runs in a worker.
Monaco reports finishing its diff at about 600 to 670 ms.

|                      |     Basic |     git-diff-view |    Monaco | CodeMirror |
| -------------------- | --------: | ----------------: | --------: | ---------: |
| Edit to painted (ms) | 716 / 769 | 3,236 / over 10 s | 356 / 361 |  399 / 400 |
| Blocking (ms)        | 276 / 335 |         2,777 / – | 659 / 526 |  317 / 570 |
| Longest task (ms)    | 191 / 249 |         1,667 / – | 339 / 307 |  128 / 141 |

**Scrolling**, in frames per second, unified / split. "Reading" is 100 px
mouse-wheel steps every 50 ms. "Fast" is 300 px steps every 16 ms. 60 is smooth.

| Diff and speed       |   Basic | git-diff-view |  Monaco | CodeMirror |
| -------------------- | ------: | ------------: | ------: | ---------: |
| 6,000 lines, reading | 58 / 29 |       30 / 25 | 37 / 60 |    56 / 45 |
| 6,000 lines, fast    | 51 / 31 |       21 / 26 | 33 / 60 |    37 / 23 |
| 300 files, fast      | 41 / 29 |       20 / 13 |  – / 13 |    26 / 13 |

**JavaScript loaded** for the review UI with each renderer (uncompressed,
including the review UI's own 259 KB): Basic 259 KB, CodeMirror 734 KB,
git-diff-view 1,305 KB, Monaco 4,453 KB.

What the numbers show:

- **The anecdote holds for loading, large files, memory, and live reload.**
  CodeMirror paints first of the three highlighted renderers on every diff, 3 to
  7 times sooner on the large files. On those files it also blocks the main
  thread least and uses the least memory, and its DOM doesn't grow with the
  file. Basic is about as fast on small diffs but has no syntax highlighting,
  and falls behind on large ones.
- **It doesn't hold for fast scrolling.** CodeMirror drops frames when scrolled
  quickly, and its split layout drops frames even at reading speed. A trace
  shows the time is CodeMirror's own JavaScript handling scroll events, not
  painting, so a GPU wouldn't fix it. Monaco's split layout stays at 60 fps
  because each file scrolls inside its own editor.
- **Monaco can't handle many files on one page.** Scrolling through the 40-file
  review, Monaco editors throw while unmounting and the whole review UI goes
  blank, in both layouts. In the 300-file review, each file is taller than
  Monaco's 900 px limit and scrolls inside its own editor. In unified layout,
  the first editor captured the mouse wheel, so the page barely scrolled and
  there's no comparable number.
- **git-diff-view is the slowest overall,** and its split layout on large files
  is unusable.
- **CodeMirror keeps working after it paints on large files.** On the
  25,000-line file with 20 changes, it keeps the main thread busy for about 6 s,
  in tasks no longer than about 190 ms.

A custom virtualized renderer, suggested as an alternative in the prototype's
[productization notes](../../prototype/docs/productization-decisions.md#61-one-diff-renderer-for-the-continuous-view),
wasn't built or measured.

## Solution

The review UI renders diffs with CodeMirror 6 and `@codemirror/merge`: the
unified merge view for the unified layout and `MergeView` for split. Comments
and the comment composer are CodeMirror block widgets. Monaco, git-diff-view,
and the Basic table aren't carried forward.

The prototype's CodeMirror setup is the starting point:

- Whole lines are matched with jsdiff, and CodeMirror's character diff runs only
  inside changed blocks (`prototype/src/ui/viewers/lineDiff.ts`). Otherwise
  `@codemirror/merge` gives up on large files and marks most of the file as
  changed.
- Unchanged lines are collapsed to 3 lines of context.
- Each file's editor is mounted only when the file is near the visible area and
  unmounted when it's far away.

## Tradeoffs

Benefits:

- The fastest time to first paint of the highlighted renderers measured, with
  the biggest lead on large files.
- Memory and DOM size stay small as files grow, because only the lines in view
  are rendered.
- Live reload repaints in about 400 ms on a 6,000-line file, with no task longer
  than about 140 ms.
- About 730 KB of JavaScript, compared with 1.3 MB for git-diff-view and 4.5 MB
  for Monaco.
- Lezer grammars give syntax highlighting without a language server, and
  CodeMirror's extension model allows custom gutters, widgets, and decorations
  for comments and line selection.

Costs:

- Fast scrolling drops frames in both layouts, and the split layout drops frames
  even at reading speed. On the 300-file review, fast scrolling ran at 26 fps
  unified and 13 fps split.
- In unified layout, `@codemirror/merge` draws each block of removed lines as a
  single widget with no line numbers. A spike showed that public APIs
  (`lineNumberWidgetMarker`, `getChunks`, and `getOriginalDoc`) can add the old
  line numbers, map clicks on removed lines to old line numbers, and show a
  comment after the block. But a comment can't sit between two removed lines in
  the same block unless the review UI draws removed lines itself instead of
  using the unified merge view's widget. This matters for comments anchored to
  removed lines ([0008](0008-comment-reanchoring.md)).
- `@codemirror/merge` needed the line-level diff override above to work on large
  files, and the review UI depends on that override.
- On large files, CodeMirror keeps the main thread busy in short tasks for
  several seconds after painting.
- Each file is a separate editor, so reviews with many files depend on lazy
  mounting and unmounting working well.
- Browser find can't see lines that aren't rendered, and CodeMirror's own search
  covers one file at a time.
- `@codemirror/language-data` doesn't cover every language, so the prototype
  needed fallbacks (`prototype/src/ui/language.ts`).
- The numbers come from one slow, GPU-less machine with generated files.

## Follow-up design choices

- **Comments on removed lines in unified layout.** Whether a comment on removed
  lines shows after the whole block of removed lines, or the review UI draws
  removed lines itself so the comment sits right under the lines it's on. Also
  whether a selected range can span removed and added lines.
- **Scroll performance.** Profile CodeMirror's scroll handling, trim
  `basicSetup` to the extensions the review UI uses, and decide whether tall
  files scroll inside a fixed-height editor, as Monaco does, instead of with the
  page.
- **Many-file reviews.** How many editors can be mounted at once, how far ahead
  to mount them, and how a review with hundreds of files stays responsive.
- **Search.** How the reviewer searches across every file in the diff when most
  lines aren't rendered.
- **Where diffs are computed.** Whether the review server sends hunks for
  CodeMirror to show, through the diff override, instead of the browser diffing
  full file contents.
- **Accessibility.** Keyboard navigation and screen reader output for diffs and
  comments.
- **Measuring on real hardware.** Repeat the measurements on a typical developer
  laptop with a GPU, and on real repositories.
- **The prototype's other renderers.** Whether to remove them from the prototype
  now.
