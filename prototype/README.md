# agent-diff prototype

A throwaway prototype for derisking the design in [`../docs`](../docs). It's not
the product: the code favors being easy to measure and change over being
complete. Terms follow the [glossary](../docs/glossary.md).

It checks five things:

1. **The agent feedback loop**
   ([0005](../docs/decisions/0005-notify-then-pull-feedback.md)): a submitted
   [review](../docs/glossary.md#review) sends a one-line notification to the
   [agent session](../docs/glossary.md#agent-session), and the agent pulls the
   [feedback](../docs/glossary.md#feedback) with the CLI.
2. **Comment re-anchoring**
   ([0008](../docs/decisions/0008-comment-reanchoring.md)): whether comments
   land in the right [anchor state](../docs/glossary.md#anchor-state) as the
   agent edits.
3. **Live reload**
   ([0007](../docs/decisions/0007-live-reload-from-file-watching.md)): how fast
   and how noisy file watching is while an agent writes.
4. **Turn snapshots**: that recording them for the "Last turn"
   [diff mode](../docs/glossary.md#diff-mode) never disturbs the repo the agent
   works in.
5. **Diff viewers**: four viewers you can switch between in the
   [review UI](../docs/glossary.md#review-ui) to compare.

Nothing here writes outside this directory except the git objects and
`refs/agent-diff/*` refs it adds to repos under review (see
[Turn snapshots](#4-turn-snapshots)). Changes you'd make to cmux, Claude Code,
or Cursor to try the loop with a real agent are described in
[docs/harness-setup.md](docs/harness-setup.md), not made for you.

## Setup

Needs Node 26 or later (for built-in TypeScript and `node:sqlite`) and git 2.36
or later.

```sh
cd prototype
npm install
```

`prototype/.npmrc` points npm at the public registry, so a private registry in
your user `~/.npmrc` isn't used for this directory.

## Quick start

```sh
npm run demo-repo                     # creates .data/demo-repo
cd .data/demo-repo
../../bin/agent-diff start --base main
```

`start` launches the [review server](../docs/glossary.md#review-server) in the
background if it isn't running, starts a
[review session](../docs/glossary.md#review-session), and prints the URL
(`http://127.0.0.1:4317/?rs=...`). The server logs to `.data/server.log`.

The demo repo has an `agent/order-validation` branch with committed, staged,
unstaged, untracked, renamed, deleted, binary, and ignored changes, plus a
6,000-line generated file for viewer timings.

To run the server in the foreground instead (useful with a tmux pane), run
`npm run serve` before `start`. Everything the prototype stores is in `.data/`.
Delete it to start over.

## 1. The agent feedback loop

What's verified:

- Submitting a review creates one notification per registered agent session on
  each [workspace](../docs/glossary.md#working-directory) in the review.
- A notification is only the one-line message. The agent runs
  `agent-diff feedback --workspace <path>` to get the comments, with their
  current line numbers and the code they were written on.
- While an agent is mid-[turn](../docs/glossary.md#turn), notifications are
  held. At the end of the turn, a Stop hook hands them over (Claude Code blocks
  the stop with the message; Cursor sends a follow-up message), or the server
  types them into the agent's terminal.
- Fetched feedback isn't offered again.

Notify methods, set at [registration](../docs/glossary.md#registration):

| Method            | Delivery                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `cmux:<surface>`  | `cmux paste --submit`. cmux refuses if someone is typing in the prompt.                        |
| `tmux:<target>`   | `tmux send-keys`, then Enter after `enterDelayMs`.                                             |
| `command:<shell>` | Runs the command with the message in `$AGENT_DIFF_MESSAGE`. For herdr, otty, or anything else. |
| `hook`            | Nothing is pushed. The agent's hooks pick it up at the next turn boundary.                     |
| `none`            | The review UI shows the message to paste by hand.                                              |

The CLI picks `cmux:$CMUX_SURFACE_ID` or `tmux:$TMUX_PANE` when they're set,
otherwise `hook`. `AGENT_DIFF_NOTIFY` overrides that.

Automated: `test/loop.test.ts` runs the whole loop against an in-process review
server, including the real CLI hooks fed the JSON that Claude Code and Cursor
send.

By hand: set up a harness with [docs/harness-setup.md](docs/harness-setup.md),
ask the agent to make a change, comment in the review UI, and submit. The
review's card shows each notification's status: `held`, `sent`, `pull` (waiting
for a hook), `manual`, `failed` (with a Resend button), or `fetched`.

## 2. Comment re-anchoring

`src/shared/reanchor.ts` places a comment's [anchor](../docs/glossary.md#anchor)
in the current code in three layers: map the lines through a diff of the
[file version](../docs/glossary.md#file-version) and the current file, then look
for a strict content match elsewhere, and otherwise mark the comment outdated
next to the replacement code.

**Scenario file.** `test/reanchor-scenarios.ts` has 22 scenarios: lines added
above, the agent addressing the comment, a moved function, duplicated blocks,
whitespace-only changes, a deleted file, and so on. Each scenario has an
original file and a current file. In the original, lines starting with `>>` are
the commented lines. In the current file, `>>` marks where the comment is
expected to land (or the replacement code, for outdated comments). Add a
scenario by copying one and editing the two files.

```sh
npm run report                          # every scenario, drawn with the comment's placement
npm run report -- --only moved-with-rename
npm run report -- --summary             # one line each, plus a match-threshold sweep
npm run report -- --thresholds 1,0.95,0.9,0.8 --context 2
node --test test/reanchor.test.ts       # the same expectations as assertions
```

In the report, `▶` marks a current placement, `~` a moved one, `^` the
replacement code for an outdated one, and `✗` the original lines.

**Replay on real history.** Puts synthetic comments every few lines on the files
changed between two refs and reports how they'd be placed. It only reads the
repo.

```sh
npm run replay -- --repo ~/some/repo --from HEAD~20 --to HEAD
npm run replay -- --repo ~/some/repo --from main --to WORKTREE --threshold 0.8
```

**Known risk.** If the commented block is edited and an identical copy of the
original exists elsewhere in the file, diff mapping can follow the copy and
report the comment as current there (scenario `single-copy-elsewhere`).

## 3. Live reload

The server watches each workspace with recursive `fs.watch`, drops git internals
except the index, `HEAD`, and refs, drops gitignored paths with
`git check-ignore`, and debounces (150 ms, flushing at least every 1,000 ms).
Each change is pushed to the review UI over server-sent events.

In the review UI:

- **On change** chooses between updating the diff in place and showing a notice
  with a Refresh button.
- The **Live reload and rendering** panel at the bottom shows, for each change,
  how long detection took (first file event to flush), how long refresh took
  (flush to repaint), and how long the server spent on git. It also has the
  watcher and re-anchoring settings. Rows are appended to `.data/metrics.jsonl`.

To simulate agent write patterns:

```sh
npm run burst                           # against .data/demo-repo
npm run burst -- --repo <path> --only single-edit,many-files
```

The scenarios are a single edit, 200 new files, paced edits, atomic
rename-saves, writes to ignored paths, staging and unstaging, and a branch
checkout round trip. The file scenarios only touch an `agent-diff-burst/`
directory that's removed afterwards. The git scenarios only run against the demo
repo unless you pass `--allow-git`. The workspace must be in an open review
session.

## 4. Turn snapshots

Diff modes compare two git trees. The working tree and index are written as
trees through private index files in `.data/indexes/`, never the workspace's own
index. A turn snapshot is a commit of the working-tree tree, kept by a ref under
`refs/agent-diff/<workspace>/snapshots/`. Git doesn't write reflogs for those
refs.

Snapshots are taken when a review session starts and at the start of each turn
(from the `UserPromptSubmit` or `beforeSubmitPrompt` hook), or with
`agent-diff snapshot`. In "Last turn" mode, the review UI compares the latest
snapshot with the working tree, and a menu picks an older one.

`test/workspace.test.ts` checks that building trees and snapshots leaves the
index, `git status`, the stash, reflogs, and the user's refs byte-for-byte
unchanged; captures untracked but not ignored files; works while another process
holds `index.lock`; works in linked worktrees; and sees same-size edits made
within the same second.

To remove snapshot refs from a repo:

```sh
git for-each-ref --format='%(refname)' refs/agent-diff/ | xargs -n1 git update-ref -d
```

## 5. Diff viewers

### The review UI

The review UI shows every file in the diff mode as one continuous diff, in the
same order as the [file view](../docs/glossary.md#file-view). Each file has a
header that sticks to the top while you scroll through it, with the file's path,
git status, added and removed line counts, a collapse button, and a **Viewed**
checkbox. Marking a file viewed collapses it and ticks it in the file view. You
can expand a viewed file again without unmarking it. Viewed and collapsed files
are remembered per review session in `localStorage`. **Expand all** and
**Collapse all** are above the diff.

The button at the right of the header shows or hides the side panel, which has
the file view and the comments. Clicking a file scrolls the diff to it, and the
file at the top of the diff is highlighted in the file view as you scroll.
Clicking a comment expands its file and scrolls to the comment.

A file's diff is fetched and its viewer mounted when it comes within 1,200 px of
the visible area, and the viewer is unmounted once it's 4,000 px away. Unmounted
files keep their last height, so the scroll position doesn't jump.

### Commenting on lines

Hover a line number to show a **+**. Click it to comment on that line, or press
it and drag across line numbers to pick a range, which is highlighted while you
drag. Releasing opens a composer under the range. ⌘/Ctrl+Enter saves the comment
as a draft, and Escape cancels. Overall comments are written in the side panel.
Dragging past the edge of the visible area doesn't scroll it.

### Viewers

Pick one from **Viewer** in the header. Each supports unified and split layouts,
and **Wrap** switches all of them between wrapping long lines and scrolling
sideways. git-diff-view breaks wrapped lines mid-word.

| Viewer               | Notes                                                                                                                                                        | Hover + and drag                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basic (custom)       | jsdiff and a table. No syntax highlighting or virtualization.                                                                                                | Both layouts and both sides.                                                                                                                                                                                                                                                                                                                                                                    |
| @git-diff-view/react | GitHub-style, highlighted. Comments and the composer use its extension rows. Turns highlighting off above 6,000 lines.                                       | Uses the library's own + and multi-line selection, in both layouts and on both sides. The library's + cancels the drag it starts, so the viewer stops the +'s mousedown before React sees it. In unified layout the drag only follows the pointer over the line-number column. In split layout the highlight covers both sides of each row, though the comment goes on the side you started on. |
| Monaco diff editor   | The VS Code editor, bundled locally. Comments and the composer are view zones. Language services are off. Files taller than 900 px scroll inside the editor. | The + is a line-number decoration. In unified layout only the new side has line numbers, so removed lines can't be commented on.                                                                                                                                                                                                                                                                |
| CodeMirror merge     | `@codemirror/merge`. Comments and the composer are block widgets. The editor grows to fit the file but still only renders the lines in view.                 | In unified layout removed lines are widgets without line numbers, so they can't be commented on.                                                                                                                                                                                                                                                                                                |

## Findings so far

Measured on the machine this was built on. Numbers will differ elsewhere.

- **Spawning git is slow here: about 60 ms per command.** Without caching, one
  file took about 850 ms of git time. The server now caches anything keyed by an
  object hash for good, caches results that depend on the repo's current state
  until the watcher reports a change, and reads objects through one long-running
  `git cat-file --batch-command`. Switching files now takes 1 to 10 ms, and a
  refresh after an edit takes about 300 ms on the server.
- **Watcher latency** from `npm run burst`: events arrive about 240 to 290 ms
  after the last write, including the 150 ms debounce. 200 files written at once
  arrive as one event. Writes to ignored paths produce no events.
- **Rendering a 6,000-line file with 422 changed lines** (headless Chrome):
  CodeMirror took 20 to 130 ms, Monaco 250 to 360 ms, Basic about 300 ms, and
  git-diff-view about 580 ms unified and 2 s split.
- **CodeMirror merge marked most of the 6,000-line file as changed.**
  `@codemirror/merge` diffs the whole document character by character, and
  `MergeView` stops searching at a depth of 500 by default and falls back to a
  crude match that treats large spans as changed. The viewer now matches whole
  lines with jsdiff and runs CodeMirror's character diff only inside changed
  blocks (`src/ui/viewers/lineDiff.ts`).
- **Monaco's split layout turns into the inline view below 900 px wide** unless
  `useInlineViewWhenSpaceIsLimited` is off. With the side panel open, the diff
  is often narrower than that.
- **Re-anchoring** on 20 commits of a real service repo: 86% of comments stayed
  current, 1% moved, and 13% became outdated. The outdated samples were real
  edits to the commented lines.
- **cmux has its own diff viewer** (`cmux diff`) with unstaged, staged, branch,
  and last-turn sources, and review comments that are attached to the agent's
  next prompt. It's the closest existing tool to this one.
- **cmux only accepts socket connections from processes started inside cmux**,
  so `cmux:` delivery needs the review server to be started there.

## Code layout

| Path                     | What it is                                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bin/agent-diff`         | CLI entry point. Set `AGENT_DIFF_NODE` if `node` isn't on the agent's `PATH`.                                                                                   |
| `src/cli/main.ts`        | CLI commands and the Claude Code and Cursor hooks.                                                                                                              |
| `src/server/`            | Review server: HTTP API and events (`http.ts`), review state (`service.ts`, `db.ts`), git (`workspace.ts`, `git.ts`), file watching, and notification delivery. |
| `src/shared/reanchor.ts` | Re-anchoring.                                                                                                                                                   |
| `src/ui/`                | Review UI (React, served by Vite in the review server).                                                                                                         |
| `test/`                  | `node --test` suites and the re-anchoring scenarios.                                                                                                            |
| `scripts/`               | Report, replay, demo repo, and burst scripts.                                                                                                                   |

```sh
npm test            # all tests
npm run typecheck
```

Environment variables: `AGENT_DIFF_PORT` (default 4317), `AGENT_DIFF_DATA_DIR`
(default `.data`), `AGENT_DIFF_NOTIFY`, `AGENT_DIFF_AGENT_ID`,
`AGENT_DIFF_PARENT_ID`, `AGENT_DIFF_CLI` (the command agents are told to run),
`AGENT_DIFF_CMUX` (path to the cmux CLI), `AGENT_DIFF_DEBOUNCE_MS`, and
`AGENT_DIFF_MAX_WAIT_MS`.

## Security

The review server listens on 127.0.0.1 only and rejects requests whose `Host`
header isn't `127.0.0.1` or `localhost` on its port, which blocks DNS rebinding.
Requests that change state must send `x-agent-diff: 1`, which a web page on
another origin can't send without a CORS preflight the server never approves.
Notifications carry no review content.

## Not in the prototype

[Claims](../docs/glossary.md#claim), opening files in an IDE
([0003](../docs/decisions/0003-open-in-ide.md)), showing unchanged files
([0002](../docs/decisions/0002-show-unchanged-files.md)), filtering by the
[agent tree](../docs/glossary.md#agent-tree), and authentication beyond the
checks above.
