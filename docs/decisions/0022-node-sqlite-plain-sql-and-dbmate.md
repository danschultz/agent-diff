# 0022: Review state is stored with `node:sqlite` and plain SQL, and migrated with dbmate

- Status: Accepted
- Date: 2026-10-15

## Problem

[0006](0006-sqlite-review-state.md) stores review state in SQLite, but didn't
choose a driver, a way to write queries, or a way to change the schema as the
app changes, which it lists as a cost.

Research [0006](../research/0006-review-server-libraries.md) ran the same
workload with six SQLite drivers, and the same store with plain SQL, Kysely,
Drizzle, and Prisma. The prototype already uses `node:sqlite` with plain SQL
([`prototype/src/server/db.ts`](../../prototype/src/server/db.ts)).

## Solution

- **Driver.** The review server uses Node's built-in `node:sqlite`.
- **Queries.** Queries are plain SQL in a store module, with prepared statements
  and rows cast to types by hand. There's no query builder or ORM.
- **Migrations.** Schema changes are SQL files managed with
  [dbmate](https://github.com/amacneil/dbmate). Each file in `db/migrations` has
  a `-- migrate:up` and a `-- migrate:down` section, and dbmate records the
  applied versions in a `schema_migrations` table:

```sql
-- migrate:up
CREATE TABLE review_sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  started_at TEXT NOT NULL
);

-- migrate:down
DROP TABLE review_sessions;
```

- **Applying migrations.** The review server runs `dbmate up` against its
  database when it starts, before it serves requests, so a new version's
  migrations are applied the first time it runs. The `dbmate` npm package is a
  runtime dependency. This is the simplest way while packaging is undecided.

`node:sqlite` is synchronous, so a store method runs without interruption. A
transaction must not `await` between `begin` and `commit`, or other requests run
inside it.

## Tradeoffs

Benefits:

- Nothing to install for the driver: no package, no native binary, and no
  per-platform builds wherever the review server runs.
- In 0006, `node:sqlite` was the fastest driver at bulk and single inserts (141
  and 293 ms, against 236 and 397 ms for better-sqlite3), and plain SQL read a
  review session about four times faster than Drizzle or Prisma, and loaded
  fastest (267 ms with the store).
- Synchronous calls make transactions atomic with respect to other requests,
  with no lock.
- Plain SQL needs no query layer to learn or upgrade, and the prototype's schema
  and store carry over.
- dbmate migrations are plain SQL files, independent of the driver and of any
  ORM. Each runs in a transaction by default. When checked on 2026-10-15, dbmate
  2.36.0 applied and rolled back a migration on SQLite, and the result was read
  with `node:sqlite`.

Costs:

- `node:sqlite` is "Stability: 1.2 - Release candidate", not stable. Node 26
  renamed `DatabaseSync` to `Database`, keeping the old name as a deprecated
  alias.
- It's synchronous only, so a slow query blocks every request, server-sent
  event, and file-watching event until it finishes. Long jobs need a worker
  thread with its own connection.
- Rows come back as `Record<string, SQLOutputValue>` and are cast by hand, so
  `tsc` doesn't catch a query and its type drifting apart.
- Every query is written and maintained by hand.
- dbmate is a Go binary. Its npm package installs the binary for the current
  platform through optional dependencies: 33.7 MB on linux-x64, for 7 platforms.
  It ran a command in 41 ms when called directly, and in 1.2 seconds through
  `npx`.
- Running migrations at startup ships a 33.7 MB binary with the review server,
  and adds a process launch to every start.
- dbmate writes `db/schema.sql` only when the `sqlite3` command-line tool is on
  the `PATH`. Without it, `dbmate up` skips the dump without an error.

## Follow-up design choices

- **Packaging.** Once it's decided how the review server is distributed, whether
  it keeps running dbmate's binary at startup, or uses dbmate only in
  development and applies the same migration files itself.
- **Failed migrations.** What `agent-diff server start` reports when a migration
  fails, and whether the database is backed up before migrating.
- **Downgrades.** What an older review server does with a database that a newer
  one has migrated.
- **Schema dump.** Whether `db/schema.sql` is committed, which needs the
  `sqlite3` tool wherever migrations are written.
- **Connection settings.** WAL mode, `synchronous`, `foreign_keys`, and a busy
  timeout, which are set on each connection rather than in a migration.
- **Typing rows.** Whether the store validates rows with Valibot
  ([0021](0021-orpc-and-valibot-build-the-api.md)), or casts them.
- **Long jobs.** Which work, such as retention or large migrations, runs in a
  worker thread.
- **Node 26.** When to move from `DatabaseSync` to `Database`.
- **Location** and **retention**, left open in 0006.
