# 0008: Comments are re-anchored in layers and marked outdated rather than guessed

- Status: Accepted, amended by [0018](0018-agents-list-open-comments.md) and
  [0036](0036-the-reviewer-submits-reviews-and-the-agent-gets-a-review-message.md)
- Date: 2026-10-10

> **Amended by [0018](0018-agents-list-open-comments.md):** there's no draft
> review, so the "Comments in the draft review and submitted comments" section
> no longer applies. How anchor states are shown alongside comment statuses is
> left open in 0018.

> **Amended by
> [0036](0036-the-reviewer-submits-reviews-and-the-agent-gets-a-review-message.md):**
> comments are in the draft review until the reviewer submits it again, so the
> "Comments in the draft review and submitted comments" section applies again.

## Problem

Code keeps changing while a review is open: agents edit files, humans edit in
their IDE, and the UI live-reloads
([0007](0007-live-reload-from-file-watching.md)). A comment on lines 40–45 has
to stay attached to the code it was about, even as lines are added above it, the
commented lines are edited, or code moves.

The hardest case is common in this tool: an agent addressing feedback changes
exactly the lines the comment refers to. Placing a comment on the wrong code
misleads both the reviewer and the agent, so a wrong position is worse than no
position.

## Solution

### Anchors

Each comment stores an anchor that never changes: the file path, the diff side,
the line range, and the version of the file it was written against. Re-anchoring
only changes where the comment is shown, never what it refers to.

- Anchors refer to a version of the file, not to a diff mode. Each diff mode
  works out where the comment falls when it renders.
- The full contents of that file version are saved, because many comments are
  written on uncommitted working-tree code that git can't return to later. All
  comments on the same file version share one stored copy.
- Re-anchoring always compares the original version with the current one, rather
  than chaining through every change, so errors can't add up.

### Layers

1. **Diff mapping.** Diff the original version against the current version. If
   the commented lines are unchanged, move the comment by the number of lines
   added or removed above it. The comment is **current**.
2. **Content matching.** If the commented lines changed or disappeared, search
   the current file for the original lines and their surrounding context, with a
   strict similarity threshold and preferring matches near the position
   predicted by the diff. If a match is found, the comment is **moved**.
3. **Outdated.** Otherwise, the comment is **outdated**. It's shown next to the
   code that replaced those lines, together with the original code it was
   written on.

The UI shows each comment's anchor state, so a guessed position never looks
certain. When in doubt, the comment is marked outdated rather than placed on
code that might not match.

### Comments in the draft review and submitted comments

- **Comments in the draft review:** if a comment in the draft review is current,
  any shift happens silently. If it's moved or outdated, the reviewer is told
  clearly that the code they're commenting on changed, because the comment may
  no longer apply.
- **Submitted comments:** once the agent addresses a comment, the lines changing
  is usually the point. Outdated, with a link to the change, acts as a signal
  that the comment was acted on.

### Other cases

- Comments on deleted lines anchor to the base version, which only changes on a
  rebase.
- Renamed files are followed using git's rename detection.
- Code moved to another file is not followed. Those comments are marked
  outdated.

## Tradeoffs

Benefits:

- Comments almost never end up on the wrong code.
- Comments on unchanged lines follow the code with full confidence, which covers
  the common case of a reviewer drafting while an agent edits elsewhere.
- Moves within a file are usually followed.
- The reviewer can always see the exact code a comment was written on.
- Outdated submitted comments tell the reviewer what changed in response.

Costs:

- More comments end up outdated than with aggressive matching, and the reviewer
  has to check them by hand.
- Saving full file contents takes more storage than saving only the commented
  lines, so storage needs a careful data model.
- Content matching needs a tuned threshold. Set too loose, it misplaces
  comments; too strict, and it rarely helps.
- Re-anchoring runs on file changes, which adds work to every live reload.
- Code moved to another file loses its comments' placement.

## Follow-up design choices

- **Storing file contents.** Design the data model so file contents are stored
  once and shared. One option is content-addressed storage: a table of file
  contents keyed by a hash of the content, which comments refer to by hash. That
  shares contents between all comments on the same version, and also between
  reviews and agents that see identical files. Open points:
  - Which hash to use, and whether to match git's blob hash so contents already
    in git can be recognized.
  - Whether to compress stored contents.
  - How unreferenced contents are cleaned up when comments or reviews are
    deleted (see the retention follow-up in
    [0006](0006-sqlite-review-state.md)).
- **Diff algorithm.** Which algorithm and library to use for diff mapping (git's
  histogram algorithm is a good default).
- **Matching threshold.** The similarity threshold for content matching, how
  much surrounding context to compare, and how far from the predicted position
  to search.
- **When re-anchoring runs.** Whether it runs for affected files on every
  file-watch event, and how results are cached.
- **Manual re-anchoring.** Whether the reviewer can move an outdated comment
  onto new lines by hand.
- **Later layers.** Agent-reported locations, where the agent says where it
  addressed a comment (pairs with the "agents reply to comments" idea), and
  anchors based on code structure (for example, a function found with
  tree-sitter) if moves turn out to be common.
