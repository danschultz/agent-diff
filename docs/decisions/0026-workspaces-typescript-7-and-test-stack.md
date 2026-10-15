# 0026: The code is split into npm workspaces on TypeScript 7, and only the review UI is built

- Status: Accepted
- Date: 2026-10-15

## Problem

Decisions [0011](0011-api-core-with-cli-client.md),
[0017](0017-crust-builds-the-cli.md),
[0021](0021-orpc-and-valibot-build-the-api.md), and
[0022](0022-node-sqlite-plain-sql-and-dbmate.md) chose libraries for the
[review server](../glossary.md#review-server), the `agent-diff` CLI, and the
[review UI](../glossary.md#review-ui), but not how the code is laid out, built,
served, formatted, or tested. The CLI and the review UI share the API's contract
with the review server ([0025](0025-contract-first-orpc-over-rpc.md)), Crust
needs TypeScript 7, and `tools/implement` is on TypeScript 5.9. Prettier doesn't
format SQL, and dbmate's migrations are SQL files.

## Solution

- **npm workspaces.** The root `package.json` lists these workspaces, and one
  `npm install` at the root installs them all:

  | Workspace         | Holds                                                                                                                           |
  | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
  | `packages/shared` | The Valibot schemas, the oRPC contract, and the state directory's file paths ([0024](0024-config-file-holds-port-and-token.md)) |
  | `packages/server` | The review server, and its migrations in `db/migrations`                                                                        |
  | `packages/cli`    | The `agent-diff` CLI, which runs as `npx agent-diff` from the repo root through its `bin`                                       |
  | `packages/ui`     | The review UI, with React and Vite                                                                                              |
  | `tools/implement` | `implement` ([0014](0014-implement-briefs-headlessly.md))                                                                       |

- **TypeScript 7 everywhere.** Every workspace uses the same TypeScript version,
  and extends the compiler options in the root `tsconfig.base.json`.
  `npm run typecheck` checks every workspace.
- **No build step, except the review UI.** `shared`, the review server, and the
  CLI run on Node 24 with type stripping, including `.ts` files imported from
  another workspace. Only the review UI is built, with Vite, into
  `packages/ui/dist`.
- **The review server serves the built review UI** from `packages/ui/dist` with
  `node:http`, and the API under `/api`. In development, Vite's dev server
  serves the review UI and proxies `/api` to the review server, on the port in
  the config file.
- **The state directory's files** are `config.json`, holding
  `{ "port": <number> }` for now, and the database `agent-diff.db`.
- **SQL is formatted.** Prettier formats `.sql` files as SQLite with
  `prettier-plugin-sql-cst`, keeping its default of uppercase keywords. It keeps
  dbmate's `-- migrate:up` and `-- migrate:down` lines as they are.
- **Tests.** `shared`, the review server, and the CLI are tested with
  `node --test`, and CLI commands with `@crustjs/testing`. A Playwright test
  starts the review server with `agent-diff server start --foreground` and opens
  the review UI. It runs with `npm run test:e2e`, in its own CI job, and not in
  `npm run check` or the pre-commit hook. Tests set `XDG_STATE_HOME` to a
  temporary directory, so they never use the real state directory.
- **Exact versions.** Every dependency is pinned to an exact version.

## Tradeoffs

Benefits:

- The contract is imported by the review server, the CLI, and the review UI from
  one place, with no published package and no copy.
- With no build step, the code that runs is the code in the repo: there's no
  `dist` to go stale for the review server or the CLI, and stack traces point at
  the source.
- One TypeScript version and one set of compiler options for every workspace.
- In production, the review UI is served from the same origin as the API, so it
  needs no CORS and can call `/api` directly.
- SQL in migrations, research, and Markdown code blocks is formatted the same
  way, and `npm run format:check` catches unformatted SQL.
- Pinned versions keep installs repeatable while Crust and oRPC are young and
  change quickly.

Costs:

- Type stripping allows only erasable TypeScript: no `enum`, no `namespace`, and
  no parameter properties. `erasableSyntaxOnly` makes `tsc` reject them.
- `tools/implement` is part of the root install and lockfile, and moved to
  TypeScript 7 with the rest.
- The review server finds the built review UI at a path relative to its own
  source, which ties it to the repo's layout until packaging is decided.
- The review UI must be built before the review server can serve it, so a
  checkout without `npm run build -w packages/ui` serves a message instead.
- Uppercase SQL keywords differ from the lowercase in the prototype's SQL.
- The end-to-end test needs a browser, which CI installs on every run, and which
  isn't checked before a commit.
- Pinned versions must be upgraded by hand.

## Follow-up design choices

- **Packaging.** How the review server, the CLI, and the built review UI are
  distributed and put on the `PATH`, which also decides whether a build step is
  needed, and where the review server finds the review UI.
- **Code linting.** Whether to add a linter such as ESLint or Biome.
- **Upgrades.** How pinned versions are kept up to date.
- **Windows**, where the state directory's modes don't apply.
