# 0023: Each user runs one review server for every review session

- Status: Accepted
- Date: 2026-10-15

## Problem

[0001](0001-local-web-app.md) left open whether there's one review server per
machine serving every review session, or one per review session.
[0006](0006-sqlite-review-state.md) left open whether exactly one process owns
the SQLite database. [0019](0019-cli-does-not-start-the-server.md) gave the
review server its own `agent-diff server` commands, but didn't say how many
review servers run.

## Solution

- **One review server per user.** `agent-diff server start` starts the operating
  system user's review server, which serves every review session that user has.
  Later review sessions reuse it, and starting it again while it's running does
  nothing, as 0019 says. Other users on the same machine run their own review
  servers, with their own databases.
- **Every client uses it.** The review UI and every CLI command a user runs talk
  to that user's review server, whichever review session they name.
- **It owns the database.** The review server is the only process that opens its
  user's SQLite database while it runs. The CLI only calls the API
  ([0011](0011-api-core-with-cli-client.md)), and dbmate migrates the database
  before the review server serves requests
  ([0022](0022-node-sqlite-plain-sql-and-dbmate.md)).

## Tradeoffs

Benefits:

- The CLI and the review UI have one port and one token to find.
- Users on a shared machine don't see or change each other's review sessions.
- One process writes to SQLite, so writes never wait on another process's lock,
  which suits SQLite's single writer.
- Every review session is in one place, for `agent-diff session list` and for a
  review UI that switches between them.
- A working directory in several review sessions
  ([0018](0018-agents-list-open-comments.md)) is handled by one process.

Costs:

- A crash or restart interrupts every review session at once, including their
  live updates.
- One process holds the file watchers and memory for every active review
  session.
- Upgrading means restarting the review server that every review session and
  agent shares, and CLIs of a different version all talk to the same review
  server.

## Follow-up design choices

- **Discovery, auth, and the database's location** are decided in
  [0024](0024-config-file-holds-port-and-token.md).
- **Racing starts.** How two `server start` commands run at the same moment
  agree on which one starts the review server, for example with a lock file.
- **Version mismatch.** What the CLI does when the running review server is a
  different version, still open from 0011.
