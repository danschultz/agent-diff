# Decisions to make before and during productization

This is a prioritized list of the technical and product decisions that carry the
most implementation risk as `agent-diff` moves from the
[prototype](../README.md) to a product. Each decision says why it matters, the
realistic options, what the prototype already tells us, a recommended default or
the experiment that would settle it, whether it's reversible, and which
[decision record](../../docs/decisions/README.md) it belongs to.

Nothing here is decided. When the user settles one of these, it becomes a
decision record following [`.rules/decisions.md`](../../.rules/decisions.md).
Terms follow the [glossary](../../docs/glossary.md). A few terms this doc needs
aren't in the glossary yet; they're listed in [Proposed terms](#proposed-terms)
and need agreement before they're used in the product docs.

"One-way door" means a choice that's expensive or impossible to undo once users
depend on it. "Two-way door" means it can be changed later at modest cost.

## Decide first

These block the most downstream work or are hardest to reverse, in order:

1. **[Who it's for and how it differs from cmux diff](#11-who-its-for-and-how-it-differs-from-cmux-diff).**
   Every other priority follows from it, and the multi-workspace "fleet" wedge
   is the least-validated part of the prototype.
2. **[Authentication](#71-authentication-and-the-local-attack-surface) and
   [server topology](#31-server-topology-discovery-and-lifecycle).** Today any
   local process can make the review server run a shell command, and every
   client (CLI, hooks, browser, harness) is built on how the server is found and
   authenticated.
3. **[Runtime and packaging](#21-runtime-and-packaging).** It fixes the
   language, the Node version floor, the latency hooks add to every prompt, and
   install friction, and it gets harder to change as the codebase grows.
4. **[The agent-facing contract](#41-the-agent-facing-contract).** Hook configs
   and harness integrations live in users' settings files and other people's
   code, so the API, CLI output, and registration format are one-way once
   adopted.
5. **[Git footprint in the user's repos](#32-git-footprint-in-the-users-repos).**
   The review server writes objects and refs into repos it doesn't own. Whatever
   ships first has to be cleaned up or migrated forever after.
6. **[One diff engine](#53-re-anchoring-guarantees-and-a-single-diff-engine) and
   [one renderer](#61-one-diff-renderer-for-the-continuous-view).** The UI
   redesign is happening now, and selection, comments, "viewed", and keyboard
   navigation will be built on whichever renderer it uses.
7. **The review data model:**
   [turn boundaries](#51-turn-boundaries-and-snapshots),
   [comment lifecycle](#54-comment-lifecycle-and-resolution),
   [viewed state](#55-what-viewed-means-while-code-changes), and
   [schema migrations](#37-data-location-schema-migrations-and-retention). The
   schema becomes user data on the first install.
8. **[Name](#91-name) and [license](#92-license).** The name is baked into refs,
   HTTP headers, environment variables, hook configs, and the notification text
   the model reads.

## 1. Product scope and positioning

### 1.1 Who it's for and how it differs from cmux diff

**Why it matters.** The prototype found that `cmux diff` already covers
unstaged, staged, branch, and last-turn sources, with inline review comments
attached to the agent's next prompt ([findings](../README.md#findings-so-far)).
For a single agent in a single repo inside cmux, that's most of what
`agent-diff` does. If the differentiators aren't sharp, productization effort
goes into polishing features a built-in tool already has.

**Options.**

- **Harness-agnostic reviewer for agent fleets (the current design).**
  Differentiators: [review sessions](../../docs/glossary.md#review-session)
  spanning many [workspaces](../../docs/glossary.md#working-directory) and repos
  ([0009](../../docs/decisions/0009-review-sessions-and-claims.md)), review
  state that survives restarts
  ([0006](../../docs/decisions/0006-sqlite-review-state.md)), comments that
  follow the code ([0008](../../docs/decisions/0008-comment-reanchoring.md)),
  and claims so several agents can work through feedback. Works in cmux, tmux,
  Cursor, or a plain terminal.
- **cmux-first companion.** Lean into cmux (browser surface, notifications,
  maybe its comment format) and position as the multi-workspace layer cmux diff
  doesn't have. Faster to a polished experience for cmux users, but tied to one
  harness's roadmap, and cmux could add multi-worktree review itself.
- **Inner loop before the pull request.** Same core, positioned explicitly as
  the review that happens before a PR exists, with an export of open comments to
  a GitHub PR review later. Clarifies the relationship with GitHub review (outer
  loop, team) and IDE diffs (no agent feedback path).
- **Don't build it.** Contribute the ideas (re-anchoring, claims) to cmux.

**What the prototype tells us.** The single-agent loop works end to end with
Claude Code and Cursor hooks (`test/loop.test.ts`). Re-anchoring and live reload
hold up. The parts that differentiate from cmux diff the most, claims and
filtering by the [agent tree](../../docs/glossary.md#agent-tree), are listed
under [Not in the prototype](../README.md#not-in-the-prototype).

**Still unknown.** How often reviewers actually run three or more agents in
separate worktrees and want to review them together. How cmux diff behaves with
multiple worktrees, and whether its comments survive edits.

**Recommendation.** Keep the harness-agnostic fleet positioning, framed as the
inner loop before a PR. Before building single-repo polish, dogfood a real
workflow with a main agent and three sub-agents in separate worktrees under one
review session, and compare the same task in cmux diff. Write the outcome as a
positioning paragraph in the README's "Why" section.

**Reversibility.** Two-way in code, but one-way in what gets built first.

**Record.** New decision record ("Who agent-diff is for"). Updates the README's
"Why".

### 1.2 Harnesses to support first

**Why it matters.** Each harness has different hook capabilities, and the
wake-up path decides whether the loop feels automatic or needs the human to
paste a message.

**What the prototype tells us** ([harness setup](harness-setup.md)):

| Harness     | Can mark turn start  | Can wake an idle agent          | Notes                                                                           |
| ----------- | -------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| Claude Code | `UserPromptSubmit`   | No (Stop hook only at turn end) | `Stop` can block with the notification, and `UserPromptSubmit` can add context. |
| Cursor      | `beforeSubmitPrompt` | No in the IDE                   | `stop` can send a follow-up. `beforeSubmitPrompt` can't add context.            |
| cmux        | Not a hook source    | Yes, `paste --submit`           | Refuses while someone is typing. The socket rejects non-descendant processes.   |
| tmux        | Not a hook source    | Yes, `send-keys`                | Can't tell if someone is typing, so it can land in a draft.                     |

**Options.** Claude Code plus cmux first; Claude Code and Cursor together; a
generic HTTP and `command:` integration first and let harnesses adopt it.

**Still unknown.** What Codex CLI, Gemini CLI, OpenCode, herdr, and otty expose
for turn boundaries and input injection.

**Recommendation.** Tier 1: Claude Code (the best in-band wake path) with cmux
and tmux as transports. Tier 2: Cursor CLI and IDE, with the paste fallback for
idle IDE agents. Everything else uses the documented HTTP API and `command:`
delivery. Survey the other CLIs' hook APIs before committing to the registration
schema in [4.1](#41-the-agent-facing-contract).

**Reversibility.** Two-way.

**Record.** Amends the follow-up choices in
[0005](../../docs/decisions/0005-notify-then-pull-feedback.md) ("Wake-up
methods").

### 1.3 Single user and local, or shared

Reviews are local to one machine
([0006](../../docs/decisions/0006-sqlite-review-state.md)). A team mode (shared
review state, multiple reviewers) would mean a sync service and conflict
handling, and it overlaps with GitHub review. **Recommendation:** single user,
local, for v1. Use random IDs everywhere (not path hashes, see
[3.3](#33-workspace-identity)) so an export to a PR or a later sync stays
possible. **Two-way** if IDs are portable. **Record:** part of the scope record
in [1.1](#11-who-its-for-and-how-it-differs-from-cmux-diff).

### 1.4 Remote machines and cloud agents

More agent work happens over SSH, in dev containers, and in cloud agents that
push branches rather than leave a working tree. The review server needs file
system access to the worktree, so remote review means port forwarding
([0001](../../docs/decisions/0001-local-web-app.md) costs), and containers bring
path translation problems (the agent's `/workspace` isn't the host's path).
**Options:** run the review server where the code is and forward the port;
support "review a pushed branch" by creating a local worktree
([0003](../../docs/decisions/0003-open-in-ide.md) already plans this); or defer.
**Recommendation:** defer, but keep workspace paths opaque in the API so a
remote review server or path mapping can be added. **Two-way.** **Record:**
answers the 0001 follow-up "How remote and SSH workflows are supported" when
settled.

## 2. Distribution and packaging

### 2.1 Runtime and packaging

**Why it matters.** Hooks run on every prompt and every turn end, on the agent's
critical path, so CLI startup time is a per-prompt cost. The runtime also
decides install friction and what the codebase is written in.

**What the prototype tells us.**

- `bin/agent-diff` runs `src/cli/main.ts` directly on Node 26 with type
  stripping. Node refuses to strip types for files under `node_modules`, so an
  npm package must ship compiled JavaScript. A build step is required either
  way.
- `package.json` says `"node": ">=24"` while the README says Node 26. The real
  floor hasn't been tested.
- Hooks call whatever `node` is on the agent's `PATH`
  ([harness setup](harness-setup.md) already needs `AGENT_DIFF_NODE`). A repo
  that pins an older Node with nvm or Volta breaks the hooks for that repo, and
  the hooks are written to fail silently.
- `agent-diff help` took 0.18 to 0.27 seconds on this machine. The
  `UserPromptSubmit` hook adds an HTTP call and a turn snapshot, which runs
  about five git commands (`add -A`, `write-tree`, `rev-parse`, `commit-tree`,
  `update-ref`) before the prompt is allowed through.
- `node_modules` is 252 MB, mostly the four viewers, and the server loads Vite
  in middleware mode at runtime by default.

**Options.**

- **npm package of compiled JavaScript** (`npm i -g` or `npx`). Easiest to ship
  and update. Needs a recent Node on the machine, and hooks still depend on
  which `node` they find.
- **Single executable with Node bundled** (Node's single executable
  applications). No Node prerequisite, keeps the codebase and `node:sqlite`.
  About 100 MB, native modules (such as a watcher, see
  [3.6](#36-file-watching-and-platform-support)) are harder, and startup is
  about the same as Node.
- **Bun or Deno compiled binary.** Faster startup and one file. The SQLite layer
  has to be checked or ported (`bun:sqlite`), and runtime compatibility for
  `fs.watch` and child process edge cases is a risk.
- **Small native client, Node server.** A Go or Rust binary for the CLI and
  hooks (millisecond startup, no runtime dependency) talking to the Node review
  server. Best hook latency, two languages. A full rewrite of the server is the
  far end of this option.
- **Desktop app** (Tauri or Electron) that owns the review server. Gives a tray
  icon, launch at login, and auto-update, at the cost of signing, notarization,
  and per-platform builds. It still needs a CLI for agents.

**Still unknown.** Real end-to-end hook latency per prompt, and whether it's
noticeable to users. Whether `node:sqlite` and type stripping work without
warnings on Node 24 (they do on Node 26.10 here; `bin/agent-diff` passes
`--no-warnings` anyway).

**Recommendation.** Ship compiled JavaScript on npm for early adopters, with the
Node floor set deliberately: Node 26 is scheduled to enter LTS in late October
2026, so requiring it is defensible for a developer tool if Node 24 turns out to
need flags. Whatever the packaging, hooks must call an absolute path to a
launcher that pins its own runtime, never a bare `node`. Run a spike that
measures the `UserPromptSubmit` hook end to end for Node, a Node single
executable, a Bun binary, and a minimal Go client, and set a budget (for
example, under 150 ms at the 95th percentile). If Node can't meet it, move only
the hook path to a native client.

**Reversibility.** Moving TypeScript between Node, a single executable, and Bun
is a two-way door. A rewrite in another language is one-way.

**Record.** New decision record. Answers the
[0001](../../docs/decisions/0001-local-web-app.md) follow-up "Which frontend and
backend stack to use".

### 2.2 Installing and removing hooks

The prototype asks users to paste JSON into `~/.claude/settings.json` or
`.cursor/hooks.json` with absolute paths to the prototype. A product needs
`agent-diff setup claude|cursor` that edits those files idempotently, points at
a path that survives upgrades, adds the Claude Code permission rules for
`feedback` and `start`, and an `uninstall` that removes everything, including
[snapshot refs](#32-git-footprint-in-the-users-repos). The setup notes say
Cursor can also run Claude Code hooks, so both can fire for one turn; the review
server should deduplicate turn events per
[agent session](../../docs/glossary.md#agent-session). **Recommendation:** build
setup and uninstall before the first external user, and treat the generated hook
entries as part of the [contract](#41-the-agent-facing-contract). **Two-way**
for the tooling, one-way for paths written into users' files. **Record:** part
of the contract record in 4.1.

### 2.3 Updates and version skew

The CLI, the hooks, the running review server, and the review UI can be
different versions after an upgrade. `/api/health` returns only `ok` and `pid`,
so the CLI can't tell it's talking to an old server. **Recommendation:** return
a version and protocol number from health, have the CLI restart an older review
server when no review session is mid-review (or tell the user), and leave
auto-update to the package manager for now. **Two-way.** **Record:** part of the
topology record in 3.1.

## 3. Architecture

### 3.1 Server topology, discovery, and lifecycle

**Why it matters.** Every client depends on finding the review server and
trusting it. The process lifecycle also decides what the server is allowed to
do, as the cmux finding shows.

**What the prototype tells us** ([`main.ts`](../src/server/main.ts),
[`cli/main.ts`](../src/cli/main.ts), [`paths.ts`](../src/shared/paths.ts)):

- One review server on a fixed port, 4317, found through `server.json` in the
  data directory (pid, port, URL) and a health check. If the port is taken, it
  exits.
- `agent-diff start` spawns the review server detached, from the prototype
  directory, and it never exits on its own.
- The review server inherits the environment and process ancestry of whoever
  started it first. That's why cmux delivery fails when the review server was
  started from Cursor: cmux's socket only accepts processes started inside cmux.
  The same applies to `PATH` (finding `tmux`, `cmux`, or an editor's CLI) and to
  anything else environment-dependent.
- Two OS users on one machine would contend for the same port, and a stale
  `server.json` could point one user's CLI at another user's review server,
  which has no authentication.

**Options.**

- **One per user, spawned on demand** (current), plus a token, a version
  handshake, a fallback to a free port, and exit after a period with no open
  review sessions and no connected review UI.
- **One per user as an OS service** (launchd, a systemd user unit, a Windows
  scheduled task). Survives reboots and is predictable, but it never runs inside
  cmux or a terminal, which forces notification delivery to happen on the
  harness side (see [4.2](#42-notification-delivery)).
- **One per repo or per review session.** Simpler isolation, but review sessions
  span repos ([0009](../../docs/decisions/0009-review-sessions-and-claims.md)),
  and several processes writing one SQLite file contend
  ([0006](../../docs/decisions/0006-sqlite-review-state.md)).
- **Owned by a desktop app** (see [2.1](#21-runtime-and-packaging)).

**Recommendation.** One review server per user, spawned on demand. The discovery
file lives in the per-user state directory with `0600` permissions and holds the
port, a random token, and the version. Use 4317 when it's free, otherwise any
free port. Exit after an idle period; hooks already do nothing when no review
server is running. Above all, design delivery so that it doesn't matter where
the review server was started ([4.2](#42-notification-delivery)).

**Reversibility.** Mostly two-way, but the discovery file format and token are
read by hooks installed in users' configs, so stabilize them early.

**Record.** New decision record. Answers the
[0001](../../docs/decisions/0001-local-web-app.md) follow-ups "One server per
machine", "How agents discover a running server", and, with
[7.1](#71-authentication-and-the-local-attack-surface), "How the browser
authenticates".

### 3.2 Git footprint in the user's repos

**Why it matters.** `agent-diff` writes into repos it doesn't own. Users and
their tools notice, and whatever ships has to be cleaned up later.

**What the prototype tells us** ([`workspace.ts`](../src/server/workspace.ts)):

- The user's index, `git status`, stash, reflogs, and refs are never touched,
  and a test checks that byte for byte (`test/workspace.test.ts`). That part is
  solid.
- Every refresh after an edit runs `git add -A` into a private index and
  `git write-tree`, which writes loose blobs and trees into the repo's own
  object database. After a day of agent edits that can be thousands of loose
  objects, which can trigger `git gc --auto` (default threshold 6,700 loose
  objects) during the user's next commit.
- Turn snapshots are commits under
  `refs/agent-diff/<workspace>/snapshots/<seq>`. Nothing ever deletes them. One
  is added per turn per workspace, and each one keeps the whole working tree
  alive, including untracked files that aren't ignored.
- Those refs appear in `git log --all`, `gitk --all`, and many IDE graph views,
  and `git push --mirror` would push them. There's no ref namespace that `--all`
  skips.
- With Git LFS installed, `git add -A` on the private index presumably runs the
  LFS clean filter on every refresh. This hasn't been tested.

**Options.**

- **Hidden refs with retention.** Keep the current design. Delete a workspace's
  snapshot refs when its last review session ends, keep at most N per workspace,
  and ship `agent-diff cleanup`. Simple, but still visible and still writes into
  the repo.
- **Private object store.** Run git with `GIT_OBJECT_DIRECTORY` pointing at a
  store in the data directory and `GIT_ALTERNATE_OBJECT_DIRECTORIES` pointing at
  the repo's objects. Scratch trees, blobs, and snapshot commits land outside
  the repo, existing objects aren't duplicated, snapshots are tracked in SQLite
  or a private bare repo, and `agent-diff` owns garbage collection. Risk: a
  snapshot tree can reference an object that exists only as an unreachable loose
  object in the user's repo, which their `gc` prunes after two weeks. Every git
  call, including the object reader, has to use the same environment.
- **Snapshot contents in SQLite.** Store snapshot files content-addressed, like
  file versions ([0008](../../docs/decisions/0008-comment-reanchoring.md)).
  Fully independent of git, but duplicates the repo and grows quickly.

**Recommendation.** Spike the private object store. It removes the "it writes
into my repo" objection, the `gc --auto` trigger, the `--all` clutter, and
accidental pushes in one move. Test it against linked worktrees, LFS, a user
`gc --prune=now`, and the object reader. If its edge cases bite, fall back to
hidden refs with strict retention. Either way, ship a cleanup command and
document exactly what's written.

**Reversibility.** One-way in practice: repos touched by the first release need
a migration or cleanup forever after.

**Record.** New decision record. Closes the
[0006](../../docs/decisions/0006-sqlite-review-state.md) follow-up "Turn
snapshots".

### 3.3 Workspace identity

**Why it matters.** Comments, snapshots, and claims hang off workspace IDs. A
wrong identity attaches old comments to new work.

**What the prototype tells us.** `workspaceId()` is a hash of the worktree's
real path. Agents often create and delete worktrees at reused paths (for
example, numbered sub-agent directories), so a new worktree at an old path
inherits the old workspace's comments and snapshot sequence. Moving a repo
orphans its history. The base ref is stored on the workspace's membership in a
review session (`review_session_workspaces.base_ref`), which answers one of the
README's to-do questions in practice.

**Options.** A path hash (current); a random ID assigned when the workspace is
added to a review session, matched by path and git directory while that review
session is open; an ID file written into the per-worktree git directory (stable
across moves, but another footprint).

**Recommendation.** A random ID per workspace, matched by real path plus git
directory while it's in an open review session. Treat a worktree that was
deleted and recreated as a new workspace (its git directory is new). Adopt base
ref per membership, and resolve the README's glossary to-do about whether "at
most one active claim" is per review session or overall at the same time.

**Reversibility.** One-way once IDs are stored in users' databases and named in
refs.

**Record.** New decision record, plus the glossary change for
[workspace](../../docs/glossary.md#working-directory) from the README to-do
list.

### 3.4 Git access strategy

**Why it matters.** Git work is the review server's main cost, and the
correctness of every diff mode rests on it.

**What the prototype tells us.**

- Spawning git was measured at about 60 ms per command
  ([findings](../README.md#findings-so-far)). While writing this doc, 15-run
  medians on the same machine were 52 ms for `git` from `PATH` (the Apple
  `/usr/bin/git` shim, which goes through `xcrun`), 26 ms for the Command Line
  Tools binary called directly, 31 ms for Homebrew's git, and 25 ms for
  `/usr/bin/true`. So about half the cost is the shim, and the rest is
  machine-wide process spawn overhead (often endpoint security software), which
  many company laptops will share.
- The long-running `git cat-file --batch-command` reader made file switches 1 to
  10 ms. A refresh still runs about six spawns (`add -A`, `write-tree`, two
  `diff-tree` calls, `check-ignore`, `ls-files`), about 300 ms.
- There's one object reader per workspace, so linked worktrees of one repo each
  start their own `cat-file` process even though they share objects.

**Options.**

- **git CLI** (current). Correct for attributes, filters, LFS, sparse checkout,
  and `fsmonitor`, because it's git. Spawn cost is the price.
- **libgit2** through `nodegit`. In-process, but the Node binding is poorly
  maintained, native builds are painful, and status in large repos is slower
  than git.
- **isomorphic-git.** Pure JavaScript and easy to ship, but slow on large repos
  and incomplete for filters, attributes, and sparse checkout.
- **gitoxide** through a native binding. Fast, but index and worktree status
  support is still maturing, and it adds a native dependency.

**Recommendation.** Stay on the git CLI. Resolve the real git binary once at
startup to skip the `xcrun` shim, set a spawn budget per refresh, merge the
name-status and numstat calls into one `diff-tree`, and share one object reader
per git common directory. Keep the git 2.36 floor (Apple's git is 2.39).
**Two-way**, since all git access goes through `git.ts` and `workspace.ts`.
**Record:** fold into the git footprint record in
[3.2](#32-git-footprint-in-the-users-repos).

### 3.5 Large repos, worktree fleets, and submodules

**Why it matters.** The prototype was measured on a demo repo. The target users
run agents in monorepos and in many worktrees at once.

**What the prototype tells us.**

- `worktreeTree()` runs `git add -A` on the private index after every flush.
  That rescans the whole working tree, so refresh cost grows with repo size, not
  with the size of the change.
- Each workspace's watcher treats any change under the common directory's
  `refs/` as git metadata and drops all cached state (`classify` in
  [`watcher.ts`](../src/server/watcher.ts)). With N sub-agents in N worktrees of
  one repo, every commit by any of them makes all N workspaces recompute.
- The review UI reloads every comment in the review session, across all
  workspaces, on any change event from another workspace (`App.tsx`), and
  `placedComments` re-anchors all of them each time.
- Files over 2 MB aren't shown (`MAX_BLOB_BYTES`). Lockfile updates, codemods,
  and generated code aren't collapsed.
- Submodules show up only as a changed commit pointer.

**Options for refresh cost.** Keep the full rescan and rely on git's untracked
cache and `fsmonitor` (whether they're valid in a copied private index is
unknown); or update the private index incrementally with
`git update-index --add --remove -- <changed paths>` from the watcher, with a
periodic full rescan to catch dropped events.

**Recommendation.** Spike on a repo with around 100,000 files and on a fleet of
eight worktrees: measure refresh with the full rescan, with `fsmonitor`, and
with incremental updates. Scope invalidation to the refs that matter for each
workspace (its own branch, `HEAD`, and its base ref), and send comment updates
only for the affected workspace. Collapse generated files by default using the
`linguist-generated` attribute and a size threshold. For submodules, show the
pointer change with an "add as workspace" action. **Two-way.** **Record:**
follow-ups in
[0007](../../docs/decisions/0007-live-reload-from-file-watching.md) ("Cost of
recomputing"); submodules may need a small new record.

### 3.6 File watching and platform support

**Why it matters.** Live reload
([0007](../../docs/decisions/0007-live-reload-from-file-watching.md)) depends on
the watcher, and watcher behavior differs most between platforms.

**What the prototype tells us.** It uses recursive `fs.watch`, filters
gitignored paths at flush time with `git check-ignore`, and debounces 150 ms
with a 1,000 ms ceiling. On macOS (FSEvents) that measured 240 to 290 ms from
last write to event, and 200 files arrived as one event. On Linux, Node
implements recursive watching by adding an inotify watch for every directory,
including ignored ones like `node_modules` and build output, because filtering
happens after the event. That hits inotify limits and slows startup on large
trees. The watcher also sees the review server's own object writes under
`.git/objects`; they're ignored, but they still arrive.

Windows isn't supported today: `command:` delivery runs `/bin/sh`, the CLI opens
URLs with `open`, and the launcher is a shell script.

**Options.** Keep `fs.watch` everywhere; `@parcel/watcher` (native, used by VS
Code, ignores directories at the source, but needs prebuilt binaries per
platform, which complicates a single executable); chokidar with directory-level
ignores; watchman (an external install).

**Recommendation.** Put the watcher behind an interface. Use `fs.watch` on macOS
and Windows, and `@parcel/watcher` or directory-level ignores on Linux. Add a
cheap periodic reconcile to catch dropped events (FSEvents coalescing, inotify
overflow). Platform tiers: macOS first, Linux (and WSL) second, native Windows
later. **Two-way.** **Record:** answers the 0007 follow-up "What to watch";
platform tiers belong in the [runtime](#21-runtime-and-packaging) record.

### 3.7 Data location, schema migrations, and retention

**Why it matters.** The database becomes user data on the first install, and a
schema without migrations can't evolve.

**What the prototype tells us.** All state lives in `prototype/.data/`. The
schema is `create table if not exists` with no version (`db.ts`), and it has no
place yet for claims, comment statuses, threads, or viewed state.
`metrics.jsonl` grows without limit.

**Recommendation.** One database per user in the platform's state directory
(`~/Library/Application Support/agent-diff`, `$XDG_STATE_HOME`, or
`%LOCALAPPDATA%`). Track the schema with `PRAGMA user_version`, run ordered
forward-only migrations with a backup before each, and refuse to open a database
from a newer version. Archive ended review sessions after a configurable period,
and delete unreferenced file versions with them. Land the migration framework
before the first schema change in [5.4](#54-comment-lifecycle-and-resolution).
**One-way** for the location and the first schema. **Record:** answers the
[0006](../../docs/decisions/0006-sqlite-review-state.md) follow-ups "Location",
"Ownership", and "Retention".

## 4. Agent integration

### 4.1 The agent-facing contract

**Why it matters.** Hooks, harness integrations, and the text the model reads
all depend on this interface. Once other people's code or users' settings files
depend on it, changing it is a breaking change.

**What the prototype tells us.**

- HTTP routes are unversioned (`/api/...`). Writes need an `x-agent-diff: 1`
  header (`http.ts`).
- `agent-diff feedback` prints text written for a language model by default and
  JSON with `--json` (`FeedbackResponse` in `types.ts`).
- Fetching feedback marks it as fetched for the workspace as a side effect, so
  the first caller consumes it, whichever agent that is.
- The notification text names an absolute CLI path and the workspace root
  (`notificationMessage` in `service.ts`), and `SessionStart` injects a
  paragraph telling the model what to do. That text is effectively an API with
  the model.
- [Registration](../../docs/glossary.md#registration) uses a string notify
  method (`cmux:<surface>`, `tmux:<target>`, `command:<shell>`, `hook`, `none`).

**Options.**

- **CLI only.** Works in any agent that can run shell commands, needs no process
  per agent session, and is easy to permission in Claude Code.
- **CLI plus an MCP server.** Structured tools for harnesses that prefer them or
  have no shell. One more process per agent session, and MCP still can't wake an
  idle agent.
- **HTTP API as the contract**, with the CLI, hooks, and an MCP adapter as
  clients of it.

**Recommendation.** Make a versioned HTTP API (`/api/v1`) with published JSON
schemas the contract. Keep the CLI as the main agent interface and hooks as
lifecycle adapters, and add an MCP adapter later for harnesses that need it.
Split reading feedback (repeatable, no side effects) from claiming it
([4.3](#43-claims-concurrent-agents-and-agent-session-identity)). Add a schema
version to `--json` output. Replace the notify string with a structured object
(`{ "type": "cmux", "surface": "..." }`). Keep the notification text short and
stable, and test changes to it with real agents.

**Reversibility.** One-way once harnesses integrate.

**Record.** New decision record. Answers the
[0005](../../docs/decisions/0005-notify-then-pull-feedback.md) follow-up "Fetch
interface" and the
[0009](../../docs/decisions/0009-review-sessions-and-claims.md) follow-up "API
shape".

### 4.2 Notification delivery

**Why it matters.** The loop only feels automatic if feedback reliably reaches
an agent. Today several failure modes are silent or permanent.

**What the prototype tells us** ([`notify.ts`](../src/server/notify.ts),
[`service.ts`](../src/server/service.ts)):

- In-band delivery through hooks works well: Claude Code's `Stop` hook blocks
  with the message, and Cursor's `stop` hook sends a follow-up.
- An idle agent in the Cursor IDE can't be woken. cmux refuses to paste while
  someone is typing or a dialog is open, and tmux can paste into a draft.
- Push delivery runs in the review server, so it depends on the review server's
  ancestry and environment ([3.1](#31-server-topology-discovery-and-lifecycle)).
- An agent session is marked busy by its turn-start hook and idle by its
  turn-end hook. If it crashes mid-turn, it stays busy, and its notifications
  stay `held` forever; nothing times out.
- A review notifies every agent session ever registered on the workspace. Agent
  sessions never expire, so dead ones keep receiving notifications.
- A failed push isn't retried unless the reviewer presses Resend.

**Options.**

- **Review server pushes** (current). Simple, but bound to the review server's
  environment and permissions.
- **Harness-side pull.** The harness, or a helper running inside it, subscribes
  to the review server (server-sent events or long polling) and delivers with
  its own context and permissions. cmux delivery would no longer depend on who
  started the review server, but each harness needs an integration.
- **In-band only.** Deliver only through hooks at turn boundaries and on the
  next prompt, and show the human a copyable message otherwise. Never types into
  a terminal, but idle agents wait for the human.
- **Hybrid.** In-band first, best-effort push for agents known to be idle, and
  retries.

**Recommendation.** Hybrid, with an explicit delivery state machine: held,
attempted, delivered (in-band or through the terminal), fetched, claimed. Treat
busy as stale after a period with no hook activity. Retry a refused cmux paste
on the next hook event or when the prompt is empty. Stop notifying agent
sessions that haven't been seen for a while. Ask cmux for a supported way in (a
provisioned socket password or a delivery endpoint) rather than relying on
process ancestry. Settle the details with a reliability matrix: Claude Code,
Cursor CLI, and Cursor IDE, each in cmux, tmux, and a plain terminal, idle,
busy, and with the human typing, measuring how often feedback is delivered and
fetched without human help.

**Reversibility.** Two-way internally. The registration format is part of the
[contract](#41-the-agent-facing-contract).

**Record.** Amends
[0005](../../docs/decisions/0005-notify-then-pull-feedback.md) (follow-ups
"Wake-up methods", "Busy agents", "Acknowledgement").

### 4.3 Claims, concurrent agents, and agent session identity

**Why it matters.** Claims are the core of the fleet story
([0009](../../docs/decisions/0009-review-sessions-and-claims.md)) and were not
prototyped. The lease design assumes something agents can't do.

**What the prototype tells us.** There are no claims. The per-workspace
"fetched" marker acts as "first fetcher wins" with no lease. Agent IDs are the
harness's IDs (Claude Code's `session_id`, Cursor's `conversation_id`, or the
cmux surface or tmux pane), and `AGENT_DIFF_PARENT_ID` builds the tree.

The key problem: 0009 says the agent renews its claim while working. A language
model has no timer, so it can't reliably renew a lease on a schedule. Renewal
has to come from something that runs automatically.

**Options for keeping a claim alive.**

- **The model calls `agent-diff claim renew`.** Unreliable.
- **Hooks renew on activity.** Claude Code's `PostToolUse` or Cursor's
  `afterFileEdit` renews the claim; the turn-end hook releases or completes it.
- **A claim lives as long as its agent session.** Liveness comes from hook
  activity, with a long expiry.
- **No lease.** A claim lasts until it's completed or the human breaks it in the
  review UI.

**Recommendation.** An agent session takes the claim when it fetches feedback,
any hook event from that agent session renews it, and the turn-end hook or
`agent-diff done` completes it. It expires after about 10 to 15 minutes without
activity, and the review UI shows who holds it and lets the human break it.
Notify only agent sessions on the workspace that were active recently,
preferring whoever made the latest turn there. Test whether Claude Code keeps
`session_id` across `--resume`, `--continue`, and `/clear`, and whether Cursor's
`conversation_id` is stable, because that decides whether a restarted agent
finds its own claim.

**Reversibility.** Two-way until the API is published.

**Record.** Amends
[0009](../../docs/decisions/0009-review-sessions-and-claims.md) (follow-ups
"Lease timing", "Who is notified", "Who gets first claim") and answers the
[0006](../../docs/decisions/0006-sqlite-review-state.md) follow-up "Reconnecting
agents".

## 5. Review model

### 5.1 Turn boundaries and snapshots

**Why it matters.** "Last turn" is the mode a reviewer uses to check what an
agent did about their feedback, and right now it shows the wrong thing in
exactly that case.

**What the prototype tells us.** Turn snapshots are taken when a review session
starts, at every turn-start hook while the workspace is in an open review
session, and on `agent-diff snapshot`. They're per workspace, not per agent
session, so "latest" means the latest turn of any agent in that worktree. When
Claude Code's `Stop` hook delivers feedback by blocking, the agent keeps going
without a new prompt, so no snapshot is taken. The work that addresses the
feedback is merged into the turn before it, and "Last turn" shows the original
change and the fix together. Whether Cursor's follow-up message fires
`beforeSubmitPrompt` is unknown.

**Options.** Snapshot only when a prompt is submitted (current); also when
feedback is fetched, since that's exactly when the agent starts responding to a
review; also when a review is submitted, which gives the reviewer "what changed
since my last review" independent of agents and hooks, and works for plain repos
with no agent registered; keep a snapshot chain per agent session for shared
worktrees.

**Recommendation.** Snapshot at prompt submit, at feedback fetch, and at review
submit, label each by reason (already stored), and let the snapshot picker say
"since review X" or "since feedback was fetched". Consider making "since last
review" its own [diff mode](../../docs/glossary.md#diff-mode). For attribution
in shared worktrees, require one worktree per agent rather than tracking per
agent session (a [0004](../../docs/decisions/0004-agent-tree-is-an-input.md)
follow-up).

**Reversibility.** Two-way.

**Record.** New decision record. Resolves the README to-do "whose turn it is"
for "Last turn"; adding a diff mode changes the README and the glossary.

### 5.2 Diff modes

Keep the five modes, with "All changes" as the default. The prototype compares
"Last turn" against the working tree, which answers the README to-do about
"current state". Settle whether "since last review" is added
([5.1](#51-turn-boundaries-and-snapshots)). **Two-way.** **Record:** README and
glossary change with 5.1.

### 5.3 Re-anchoring guarantees and a single diff engine

**Why it matters.** [0008](../../docs/decisions/0008-comment-reanchoring.md)
promises that a wrong position is worse than none. That only holds if what the
re-anchorer calls unchanged matches what the reviewer sees as unchanged.

**What the prototype tells us.**

- Diff mapping uses jsdiff's `diffArrays` (Myers) in
  [`reanchor.ts`](../src/shared/reanchor.ts). The file list's counts come from
  git's default diff. Each viewer computes its own diff (CodeMirror merge,
  Monaco, git-diff-view, and jsdiff in Basic). So a line can be "current" to the
  re-anchorer while the viewer highlights it as changed, and the +/- counts can
  disagree with what's drawn.
- On 20 commits of a real service repo, 86% of comments stayed current, 1%
  moved, and 13% became outdated. The 22 scenarios pass, with a known false
  "current": `single-copy-elsewhere`, where diff mapping follows an identical
  copy after the commented block is edited.
- Mapping is recomputed for every comment and isn't cached per pair of file
  versions.

**Options.** jsdiff everywhere (client and server); git's histogram diff on the
server, used for hunks, counts, and re-anchoring (0008 suggests histogram; one
`diff-tree -p` call can cover every file); a JavaScript histogram or patience
implementation shared by the server and the UI.

**Recommendation.** One diff, computed on the server, feeds the hunks the viewer
draws, the counts in the file list, and the first re-anchoring layer. State the
guarantee as something measurable: no wrong placement labeled current or moved
on the [corpus](#82-re-anchoring-corpus), with the outdated rate tracked as the
cost. Fix `single-copy-elsewhere` (for example, also require matching context
for a current placement when an identical copy exists) or record it as an
accepted limitation. Cache results by (file version hash, current blob hash).

**Reversibility.** Two-way, because anchors are immutable and only placements
change.

**Record.** Answers the 0008 follow-ups "Diff algorithm" and "Matching
threshold"; amend 0008 if the guarantee wording changes.

### 5.4 Comment lifecycle and resolution

**Why it matters.** The schema and API need to carry statuses before user data
exists, even if the UI comes later.

**What the prototype tells us.** A comment is a draft until it has a
`review_id`, and submitted comments can't change. There are no statuses,
threads, or authors. Notifications track delivery and `feedback_fetches` track
fetching, but nothing records whether a comment was addressed. The README's
"Agents reply to comments" idea needs all of that.

**Options.** Keep comments flat and let anchor state stand in for progress (0008
says it shouldn't); add a status per comment set by the agent (addressed,
declined, needs input) and resolved or reopened by the reviewer; full threads
with messages from both sides.

**Recommendation.** Add threads and statuses to the schema now: a comment
becomes the first message of a thread, agents add replies with a status, and the
reviewer resolves or reopens. Keep resolution separate from
[anchor state](../../docs/glossary.md#anchor-state). Decide who handles overall
comments under claims at the same time (a 0009 follow-up).

**Reversibility.** One-way once data exists.

**Record.** New decision record that promotes the README's "Agents reply to
comments" idea. Needs glossary terms (see [Proposed terms](#proposed-terms)).

### 5.5 What viewed means while code changes

**Why it matters.** The redesign adds a per-file "viewed" mark. In a tool where
files change constantly, a path-only mark would claim the reviewer saw code they
never saw.

**What the prototype tells us.** Not prototyped. Every file side has a git blob
hash (`FileSideContent.hash`), and live reload reports which paths changed.

**Options.** A boolean per path; a mark keyed by path and both blob hashes,
which clears when either side changes; the same plus a "changed since viewed"
diff from the viewed version to the current one.

**Recommendation.** Record viewed per review session, workspace, and path, with
the blob hash the reviewer saw. When the file changes, show "changed since
viewed" and offer that diff instead of silently clearing the mark. Store the
viewed contents as a [file version](../../docs/glossary.md#file-version) so git
garbage collection can't remove it. Make it independent of the diff mode.

**Reversibility.** Two-way, but the redesign will build on it, so decide before
it lands.

**Record.** New small decision record, plus a glossary term.

### 5.6 Unchanged files

Not prototyped ([0002](../../docs/decisions/0002-show-unchanged-files.md)).
Listing can come from `git ls-tree -r` on the "to" tree rather than walking the
disk. Anchors are file versions, so comments on unchanged files ("also update
this caller") already fit the model. **Recommendation:** allow them, show the
working-tree version, and load the tree lazily. **Two-way.** **Record:** answers
0002 follow-ups.

## 6. UI

### 6.1 One diff renderer for the continuous view

Decided in [0012](../../docs/decisions/0012-codemirror-renders-diffs.md):
CodeMirror, with measurements of all four viewers.

**Why it matters.** The redesign wants one continuous diff of all files,
per-file collapse, a "viewed" mark, and selecting a line range by dragging a +
over the line numbers. Comment placement, selection, and keyboard navigation
will be built on whatever renderer it uses, so switching later means redoing
that work.

**What the prototype tells us.**

- Four viewers share a per-file contract (`ViewerProps` in
  [`viewers/types.ts`](../src/ui/viewers/types.ts)). Nothing was measured with
  many files on one page.
- Rendering a 6,000-line file with 422 changed lines: CodeMirror 20 to 130 ms,
  Monaco 250 to 360 ms, Basic about 300 ms, git-diff-view about 580 ms unified
  and 2 s split.
- Monaco needed its language services switched off, and CodeMirror needed
  fallbacks for languages `language-data` doesn't know (`language.ts`).
- In unified layout, Monaco and CodeMirror show only the new side, so comments
  on removed lines don't appear. 0008 anchors comments on deleted lines to the
  base version, so in that layout those comments have nowhere to show.

**Options.**

- **CodeMirror merge per file**, mounted lazily in a virtualized list of files.
  Fastest measured. Removed lines in unified layout are widgets, not lines that
  can be selected or commented on, and hundreds of editor instances need careful
  lazy mounting.
- **Custom virtualized renderer** (an evolution of Basic) drawing hunks from the
  server ([5.3](#53-re-anchoring-guarantees-and-a-single-diff-engine)), with
  syntax highlighting in a worker. Full control over the gutter, drag selection,
  removed lines, and accessibility. The most work, and browser find stops
  working once rows are virtualized, so it needs its own search.
- **Monaco.** The heaviest, the slowest of the editors measured, and the worst
  fit for many files on one page.
- **git-diff-view.** The slowest measured.

**Recommendation.** Drop Monaco and git-diff-view now. Spike CodeMirror against
a custom renderer on a review with about 300 files and 20,000 changed lines,
judged on the redesign's real needs: scrolling, memory, time to first paint,
dragging a selection across removed lines in unified layout, comment widgets,
search, and screen reader output. The likely answer is the custom renderer,
because of the removed-lines gap and the continuous layout, with CodeMirror kept
for full-file views of unchanged files. Settle this before the redesign goes
deep.

**Reversibility.** Two-way in principle, expensive in practice once the
interactions are built.

**Record.** New decision record. Answers the 0001 follow-up "Which frontend
stack to use".

### 6.2 Diff API shape

Today the review UI fetches a file list, then one file at a time, and the server
returns the full contents of both sides for the viewer to diff. A continuous
view of 300 files would move megabytes and diff in the browser.
**Recommendation:** a batch endpoint that returns server-computed hunks and file
metadata for the whole workspace, full contents only when the reviewer expands
context, and incremental refetch of just the paths named in each change event.
**Two-way.** **Record:** part of the renderer record in 6.1.

### 6.3 Performance budgets

The prototype measures detection, refresh, server git time, and rendering (the
metrics panel and `metrics.jsonl`) but has no targets. Suggested starting
budgets, to be checked against the spike results:

| Interaction                                                                 | Budget               |
| --------------------------------------------------------------------------- | -------------------- |
| Agent writes a file, review UI repaints (95th percentile, 10,000-file repo) | 600 ms               |
| Open a review session with 100 changed files, first useful paint            | 1 s                  |
| Scrolling the continuous diff                                               | 60 frames per second |
| Time a hook adds to a prompt or turn end (95th percentile)                  | 150 ms               |

Today's edit-to-repaint on the demo repo is about 240 to 290 ms of detection
plus about 300 ms of server refresh. **Two-way.** **Record:** none; track the
budgets in the benchmark suite ([8.3](#83-benchmarks-and-cross-platform-ci)).

### 6.4 Syntax highlighting

`language.ts` maps about 35 extensions to two grammar systems, and Scala had to
be added by hand. The grammar system follows the renderer: Lezer for CodeMirror,
or TextMate grammars (for example through Shiki), which match VS Code's coverage
but are heavier and best run in a worker. **Recommendation:** one grammar
system, loaded lazily per language, with a plain-text fallback. **Two-way.**
**Record:** part of 6.1.

### 6.5 Keyboard and accessibility

The prototype has no keyboard flow beyond Cmd+Enter to save a draft. Decide a
baseline before the redesign hardens: next and previous file, hunk, and comment;
selecting a line range with the keyboard as well as by dragging; submitting a
review; screen reader labels for added and removed lines; and +/- markers that
don't rely on red and green alone. Virtualization works against screen readers
and browser find, so it has to be designed in. **Two-way**, but much cheaper up
front. **Record:** none needed unless scope is cut.

### 6.6 Code changing under the reviewer

The prototype offers "update in place" or "show a notice" as a setting.
**Recommendation:** update in place by default, but hold updates for the file
the reviewer is drafting a comment on or has selected lines in, and keep the
scroll position anchored to the line being read. **Two-way.** **Record:**
answers the 0007 follow-up "Changes under the reviewer".

## 7. Security and privacy

### 7.1 Authentication and the local attack surface

**Why it matters.** The review server can run commands, write to repos, and
launch editors. In its current form, any process that can open a connection to
127.0.0.1 can use all of that.

**What the prototype tells us** ([security notes](../README.md#security),
[`http.ts`](../src/server/http.ts), [`notify.ts`](../src/server/notify.ts)):

- It listens on 127.0.0.1, checks the `Host` header on `/api/` routes (which
  blocks DNS rebinding), and requires `x-agent-diff: 1` on writes (which blocks
  cross-site forms and simple requests). That stops web pages, not local
  processes.
- `POST /api/agents` accepts a notify method of `command:<shell>`, which the
  review server later runs with `/bin/sh -c` when a review is submitted. Any
  local process, including other OS users' processes, a sandboxed agent with
  network access but no shell, or a container on the host network, can register
  one and get code execution as the reviewer.
- `POST /api/review-sessions` makes the review server write objects and refs
  into any repo the user can write to. Settings and metrics endpoints are open,
  and `GET` routes return file contents of any workspace to any local caller.
- Opening files in an IDE ([0003](../../docs/decisions/0003-open-in-ide.md))
  will add another way to launch processes.

**Options.**

- **Bearer token** in the `0600` discovery file for the CLI and hooks, and a
  cookie for the browser, set through a one-time launch URL.
- **Unix domain socket** for the CLI and hooks (file permissions do the
  authentication), with TCP only for the browser.
- **Scoped capabilities.** Agents get tokens that can only fetch and claim
  feedback for their own workspaces; only the review UI can submit reviews, end
  review sessions, or change settings.

**Recommendation.** The token and cookie before any release, with the `Origin`
header checked as well as `Host`. Remove `command:` from the HTTP API: only
allow it from a user-owned config file or built-in harness adapters. Launch
editors only from an allow-list, with no arguments taken from the browser. Add
the Unix socket and scoped capabilities as hardening, because agents in
sandboxes should be treated as untrusted callers.

**Reversibility.** Two-way, but it has to exist before anyone else runs this.

**Record.** New decision record. Answers the
[0001](../../docs/decisions/0001-local-web-app.md) follow-up "How the browser
authenticates to the server".

### 7.2 Secrets and retention of code

Untracked files that aren't ignored show up in diffs, are written into git
objects, and are pinned by snapshot commits indefinitely
([3.2](#32-git-footprint-in-the-users-repos)). The full contents of every
commented file are copied into the `file_versions` table and never deleted.
**Options:** rely on `.gitignore`; add a default list of sensitive paths
(`.env*`, `*.pem`, `id_*`) that are excluded from snapshots and flagged in the
review UI; add retention and a purge command. **Recommendation:** all three,
with the sensitive-path list configurable. **Two-way.** **Record:** new small
record, or part of the retention record in
[3.7](#37-data-location-schema-migrations-and-retention).

### 7.3 Telemetry

There's none today, which is the right default for a tool that reads private
code. **Recommendation:** if telemetry is ever added, make it opt-in, never
include code, paths, or comment text, and document it before the first public
release. Changing from opt-out to opt-in later costs trust. **One-way** in trust
terms. **Record:** new small record when it comes up.

## 8. Quality

### 8.1 Test layers

Today's `node --test` suites cover the full loop against an in-process review
server with the real CLI hooks (`loop.test.ts`), that the user's repo state is
untouched (`workspace.test.ts`), and the re-anchoring scenarios. Hook payloads
are hand-written, and there are no UI tests. **Recommendation:** keep these
layers; add harness contract tests from recorded real payloads per harness
version, browser tests (for example Playwright) for the redesign's selection and
commenting, and property tests for re-anchoring with random edits and the
invariant "never current unless the lines are identical". **Two-way.**

### 8.2 Re-anchoring corpus

The replay tool puts synthetic comments every few lines of real history. Real
reviewers comment on the lines they want changed, so real comments change far
more often than synthetic ones, and the 86% current rate is optimistic.
**Recommendation:** while dogfooding, log each comment's anchor, file version,
and later versions (opt-in, local), and label placements by hand. Track two
numbers: wrong placements labeled current or moved (target zero) and the
outdated rate. Tune the 0.9 similarity threshold from that. **Two-way.**
**Record:** feeds the 0008 follow-ups.

### 8.3 Benchmarks and cross-platform CI

Turn `npm run burst` and the render timings into a benchmark that runs on fixed
repos (the demo repo, a 10,000-file repo, a 100,000-file synthetic repo) and
fails on regressions against the [budgets](#63-performance-budgets). Run CI on
macOS with both Apple's and Homebrew's git, and on Linux, across the oldest
supported git (2.36) and the latest, and the Node floor and current Node. Add
Windows when it becomes a supported tier. **Two-way.**

## 9. Business and open source

### 9.1 Name

"agent-diff" is generic and baked into the ref namespace (`refs/agent-diff/`),
the HTTP header (`x-agent-diff`), environment variables (`AGENT_DIFF_*`), the
CLI name in users' hook configs, and the notification text models respond to.
Check npm, Homebrew, GitHub, and trademark availability, and settle the name
before the first external user. **One-way** after adoption. **Record:** new
small record.

### 9.2 License

A permissive license (MIT or Apache-2.0) makes it easiest for harness authors to
adopt the contract and integrate. A copyleft or source-available license
protects against a harness vendor absorbing it, but with cmux diff already in
the market, adoption matters more. Dependencies are MIT or similar, and calling
the git CLI has no license effect. Decide before accepting outside
contributions, along with a DCO or CLA. **One-way** in practice. **Record:** new
small record.

### 9.3 Pricing

A local, single-user tool is hard to charge for. Paid options would be team
features or hosted review state, which conflict with local SQLite
([0006](../../docs/decisions/0006-sqlite-review-state.md)) and amount to a
separate product. **Recommendation:** defer; keep IDs portable
([1.3](#13-single-user-and-local-or-shared)). **Two-way.**

## Prototype behavior that must change

Short list of things that are fine for a prototype but shouldn't carry over,
each covered above:

- Any local process can register a `command:` notify method and get code
  execution ([7.1](#71-authentication-and-the-local-attack-surface)).
- An agent session that crashes mid-turn leaves its notifications `held`
  forever, and dead agent sessions are notified forever
  ([4.2](#42-notification-delivery)).
- Snapshot refs and scratch objects accumulate in users' repos with no cleanup
  ([3.2](#32-git-footprint-in-the-users-repos)).
- Every refresh rescans the whole working tree, and any commit in a repo
  invalidates every worktree of it
  ([3.5](#35-large-repos-worktree-fleets-and-submodules)).
- Work that addresses feedback through Claude Code's `Stop` hook is merged into
  the previous turn ([5.1](#51-turn-boundaries-and-snapshots)).
- The re-anchorer, the file list, and each viewer use different diffs
  ([5.3](#53-re-anchoring-guarantees-and-a-single-diff-engine)).
- Workspace IDs are path hashes, so recreated worktrees inherit old comments
  ([3.3](#33-workspace-identity)).
- The schema has no versioning, state lives in the package directory, the port
  is fixed, and Vite runs inside the review server
  ([3.7](#37-data-location-schema-migrations-and-retention),
  [3.1](#31-server-topology-discovery-and-lifecycle),
  [2.1](#21-runtime-and-packaging)).
- `package.json` and the README disagree on the Node version
  ([2.1](#21-runtime-and-packaging)).

## Suggested sequencing

**Decide now**, before productization code is written:

- Positioning and first users
  ([1.1](#11-who-its-for-and-how-it-differs-from-cmux-diff)), and the first
  harnesses ([1.2](#12-harnesses-to-support-first)).
- Server topology, discovery, and authentication
  ([3.1](#31-server-topology-discovery-and-lifecycle),
  [7.1](#71-authentication-and-the-local-attack-surface)).
- Packaging direction and Node floor ([2.1](#21-runtime-and-packaging)), pending
  the hook latency spike.
- The shape of the agent-facing contract ([4.1](#41-the-agent-facing-contract)).
- Workspace identity ([3.3](#33-workspace-identity)), the comment lifecycle
  schema ([5.4](#54-comment-lifecycle-and-resolution)), and the migration
  framework ([3.7](#37-data-location-schema-migrations-and-retention)).
- Name and license ([9.1](#91-name), [9.2](#92-license)), before anything is
  public.

**Settle with a spike:**

- Hook latency per prompt across runtimes ([2.1](#21-runtime-and-packaging)).
- Private object store against hidden refs, including LFS and linked worktrees
  ([3.2](#32-git-footprint-in-the-users-repos)).
- Continuous rendering of a 300-file review with server-computed hunks, custom
  renderer against CodeMirror
  ([6.1](#61-one-diff-renderer-for-the-continuous-view),
  [5.3](#53-re-anchoring-guarantees-and-a-single-diff-engine)). This one is
  urgent because the redesign is in progress.
- Refresh cost on a 100,000-file repo and an eight-worktree fleet
  ([3.5](#35-large-repos-worktree-fleets-and-submodules)), and the Linux watcher
  ([3.6](#36-file-watching-and-platform-support)).
- The notification reliability matrix ([4.2](#42-notification-delivery)).
- Claims renewed by hooks, and agent session identity across resume
  ([4.3](#43-claims-concurrent-agents-and-agent-session-identity)).
- Snapshots at feedback fetch and review submit, with Claude Code's `Stop`
  continuation ([5.1](#51-turn-boundaries-and-snapshots)).

**Can wait:**

- Native Windows support, the MCP adapter, and remote or cloud agents
  ([3.6](#36-file-watching-and-platform-support),
  [4.1](#41-the-agent-facing-contract),
  [1.4](#14-remote-machines-and-cloud-agents)).
- Telemetry implementation (the opt-in policy should be written down now)
  ([7.3](#73-telemetry)).
- Pricing and team features ([9.3](#93-pricing),
  [1.3](#13-single-user-and-local-or-shared)).
- Submodule review, manual re-anchoring, and accessibility beyond the baseline
  in [6.5](#65-keyboard-and-accessibility).

## Proposed terms

These concepts come up above but aren't in the
[glossary](../../docs/glossary.md). Per
[`.rules/glossary.md`](../../.rules/glossary.md), they need the user's agreement
before they're used in the README or decision records:

- **Viewed:** the reviewer's mark that they've read a file at a specific version
  ([5.5](#55-what-viewed-means-while-code-changes)).
- **Thread**, **reply**, and **resolved**: a comment with follow-up messages
  from agents and the reviewer, and its closed state
  ([5.4](#54-comment-lifecycle-and-resolution)).
- **Discovery file:** the per-user file clients read to find and authenticate to
  the review server ([3.1](#31-server-topology-discovery-and-lifecycle)).
