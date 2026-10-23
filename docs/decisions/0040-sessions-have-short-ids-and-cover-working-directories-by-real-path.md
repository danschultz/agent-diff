# 0040: Sessions have short IDs, and cover working directories by real path, each with its own base ref

- Status: Accepted
- Date: 2026-10-22

## Problem

Sessions are the first real feature, replacing the hello world scaffolding, and
building them needs answers that earlier decisions left open:

- [0013](0013-working-directories.md) asks whether the base ref belongs to the
  working directory or to its membership in a session, whether working
  directories can be nested, and how a working directory is identified.
- [0018](0018-agents-list-open-comments.md) asks what IDs look like, given that
  people copy them into prompts, and whether `session new` and `session add`
  take a base ref.
- [0022](0022-node-sqlite-plain-sql-and-dbmate.md) asks which settings each
  database connection uses.
- [0031](0031-the-review-ui-gets-the-token-in-the-url-fragment.md) has
  `server start` print the review UI's URL with the token, which opens a page
  with nothing on it, now that the review UI's only page is a session.

The glossary also said "review session", while the CLI's commands are
`agent-diff session …`.

## Solution

### Terminology

- **"Review session" becomes "session".** The glossary term is
  [session](../glossary.md#session), which matches the `session` commands.
- **Agent sessions keep their full name.** "Agent session" is always written in
  full, so a bare "session" always means a session.

### IDs

- **A session's ID is `s_` and 6 random characters** of lowercase Crockford
  base32, `0123456789abcdefghjkmnpqrstvwxyz`, such as `s_7kq9a1`. The alphabet
  leaves out `i`, `l`, `o`, and `u`, which are easy to misread.
- **IDs come from `node:crypto`,** and one that's already taken is generated
  again.
- **Comment IDs will be `c_`** with the same shape, when comments are built.
- **An ID that's malformed or names no session** fails with an error naming it,
  such as "There's no session s_7kq9a1."

### Working directories

- **The CLI sends absolute paths.** It resolves relative paths against its
  current directory, and the API rejects relative paths.
- **A working directory is identified by its real path,** with symlinks
  resolved, across every session it's in. Two paths to the same directory, such
  as one through a symlink, are one working directory.
- **A path that doesn't exist or isn't a directory fails the command,** which
  names the path and adds nothing.
- **A working directory uses git when `git rev-parse` succeeds in it,** so a
  directory inside a repo counts. One that doesn't use git has no base ref.
- **Adding a working directory that's already in the session keeps it as it
  is,** including its base ref, and says so. It isn't an error. A path given
  twice in one command is added once.
- **Nested working directories are allowed,** with no check.

### Base ref

- **The base ref belongs to a working directory's membership in a session,** so
  the same working directory can have different base refs in two sessions.
- **`session new` and `session add` take `--base <ref>`,** which applies to
  every git working directory in that command. Working directories that don't
  use git ignore it. `session add` only uses it for the working directories it
  adds.
- **Without `--base`, the default is chosen per working directory:**
  1. The short name of `refs/remotes/origin/HEAD`, such as `origin/main`, when
     it's set.
  2. Otherwise `main`, then `master`, when the branch exists and isn't the
     current branch.
  3. Otherwise `HEAD`.
- **The base ref is stored as the ref name,** given or chosen, not resolved to a
  commit. The diff will compare against the base ref's merge-base with `HEAD`,
  as a pull request does.
- **An explicit `--base` must resolve to a commit** in each git working
  directory, checked with `git rev-parse --verify --quiet <ref>^{commit}`.
  Otherwise the command fails, names the ref and the working directory, and adds
  nothing. The default isn't checked, so a repo with no commits gets `HEAD`.

### Titles

- **`session new` takes an optional `--title <text>`,** which is trimmed, and
  fails when it's empty after trimming or longer than 200 characters.
- **A session without a title shows only its ID.**

### Commands

Output is plain text written for agents, with no JSON, as 0018 says. Every
command fails with [0019](0019-cli-does-not-start-the-server.md)'s error when
the review server isn't running.

- **`agent-diff session new [--title <text>] [--base <ref>] <working-dir>...`**
  needs at least one working directory. It prints the new session's ID, its
  review UI link, and each working directory's real path with its base ref or
  "doesn't use git".
- **`agent-diff session add [--base <ref>] <session-id> <working-dir>...`**
  prints the working directories it added, and those already in the session,
  with their base refs. It fails on an archived session.
- **`agent-diff session show <session-id>`** prints the ID and title, whether
  the session is active or archived and when it was archived, when it was
  created, its review UI link, and its working directories with their base refs,
  marking any that's missing on disk.
- **`agent-diff session list [--all]`** lists active sessions, newest first,
  with each one's ID, title, creation time, and working directory paths. `--all`
  includes archived sessions, marked as archived.
- **`agent-diff session archive <session-id>`** archives a session. Archiving is
  one-way, and the session becomes read-only. Archiving a session that's already
  archived succeeds, and says so.
- **`agent-diff session delete [--yes] <session-id>`** permanently deletes a
  session. In a terminal, it asks first, and `--yes` skips the question. When
  stdin isn't a terminal and `--yes` isn't given, it fails with an error saying
  to pass `--yes`, and never waits for input. Active sessions can be deleted
  without archiving them first, and working directories left in no session are
  deleted too.

### The API and the database

- **The API has a procedure for each command,** grouped under `session` and
  named after the CLI's verbs, such as `session.new`.
- **Three tables:** `sessions`, `working_directories` by real path, and
  `session_working_directories` for a working directory's membership in a
  session, with its base ref. Timestamps are ISO 8601 strings in UTC.
- **Deleting a session** deletes its memberships through a foreign key with
  `ON DELETE CASCADE`, and the working directories left in no session, in one
  transaction.
- **Every connection the store opens sets** `PRAGMA foreign_keys = ON`,
  `PRAGMA journal_mode = WAL`, and `PRAGMA busy_timeout = 5000`. `synchronous`
  keeps SQLite's default.

### Links with the token

- **Only `session new` and `session show` print links with the token,** such as
  `http://127.0.0.1:<port>/sessions/<id>#token=<token>`, built from the config
  file in one place in `packages/shared`.
- **`server start` prints its port and no URL:** "The review server is running
  on port `<port>`." when it starts the review server, and "The review server is
  already running on port `<port>`." when it finds one.
- **`npm run dev:ui` prints no URL with the token.** To use the dev server, open
  a session's link with its origin changed to the dev server's.
- **The review UI's only page is `/sessions/<id>`.** It shows the session's
  title and ID, whether it's active or archived, when it was created, and its
  working directories with their base refs. An unknown or malformed ID, and
  every other path, including `/`, show a not-found message. The token in the
  fragment of any path is still saved.
- **Without a token, or after a 401,** the review UI shows "Open the link
  printed by `agent-diff session new` or `agent-diff session show`."

### Effect on earlier decisions

- **[0013](0013-working-directories.md).** Answers the follow-ups on the base
  ref, which belongs to the membership, and on nested working directories, which
  are allowed. Partly answers identity: a working directory is identified by its
  real path, so one recreated at the same path is the same working directory.
- **[0018](0018-agents-list-open-comments.md).** Answers the follow-ups on the
  ID format and on the base ref.
- **[0022](0022-node-sqlite-plain-sql-and-dbmate.md).** Answers the follow-up on
  connection settings.
- **[0031](0031-the-review-ui-gets-the-token-in-the-url-fragment.md).**
  `server start` and `npm run dev:ui` no longer print a URL with the token.
  Links come from `session new` and `session show`, and the review UI's message
  without a token names those commands.

## Tradeoffs

Benefits:

- Six characters from a 32-character alphabet give about a billion IDs, short
  enough to read aloud or type into a prompt, and with no characters that look
  alike.
- A working directory reached through a symlink is the same one, so it doesn't
  show up twice in a session or get two sets of comments.
- A per-membership base ref lets one working directory be reviewed against
  different bases, such as `main` in one session and a release branch in
  another.
- Storing the ref name means the base follows the branch as it moves, as a pull
  request's does.
- The default base ref matches what a pull request would compare against in most
  repos, so agents rarely need `--base`.
- Checking every path and an explicit `--base` before writing means a failed
  command adds nothing, so an agent can fix the command and run it again.
- Every link with the token opens a page that shows something, and the review
  UI's message names the commands that print one.
- WAL lets readers run while the review server writes, and the busy timeout
  waits for a lock rather than failing at once.

Costs:

- An ID is short enough that a collision is possible and has to be checked for.
- A working directory that's moved is a new working directory, and one that's
  deleted and recreated at the same path is treated as the same one.
- A base ref that's a branch name changes what's compared as the branch moves,
  and a default that isn't checked can fail later, such as `HEAD` in a repo with
  no commits.
- Nested working directories can show the same files twice.
- Getting a link with the token after `session new` needs `session show`, and
  `server start` no longer gives one to open the review UI with.
- The CLI resolves relative paths, so it has to run where the paths make sense,
  and the review server checks the paths on its own machine.

## Follow-up design choices

- **Removing working directories, changing a base ref, and unarchiving.** Left
  out of this decision.
- **Moved and recreated working directories.** Whether a working directory can
  be pointed at a new path, and whether one recreated at the same path should
  start again.
- **A page that lists sessions.** What the review UI shows at `/`, and whether
  it links to each session.
- **Case-insensitive file systems.** Whether two paths that differ only in case
  are one working directory on file systems that ignore case.
- **Checking the base ref again.** Whether `session show` says when a base ref
  no longer resolves, such as after a branch is deleted.
- **`synchronous`.** Whether to set `PRAGMA synchronous = NORMAL`, which WAL
  allows, once write speed matters.
