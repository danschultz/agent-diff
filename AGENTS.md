# AGENTS.md

Read [README.md](README.md) first. It describes what `agent-diff` is, the review
workflow, diff modes, and open design questions. Design decisions are recorded
in [docs/decisions](docs/decisions/README.md), research into open questions is
in [docs/research](docs/research/README.md), and agreed terms are defined in
[docs/glossary.md](docs/glossary.md).

## Guidelines

- The project is in the planning stage. Don't start implementing until a design
  or task has been agreed with the user.
- Keep `README.md` as the source of truth for product intent.
- The project is in early development, and breaking changes are fine for the
  foreseeable future. Don't write fallbacks, conversions, or tests to keep
  working with what earlier versions wrote or accepted, such as config files,
  API calls, or CLI usage, unless a brief asks for them. See
  [0033](docs/decisions/0033-breaking-changes-are-allowed-during-early-development.md).

## Rules

| Rule                                             | When to read                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [`.rules/glossary.md`](.rules/glossary.md)       | Always                                                                              |
| [`.rules/decisions.md`](.rules/decisions.md)     | When the user settles a design question or answers an open question in `README.md`. |
| [`.rules/research.md`](.rules/research.md)       | When the user or a brief asks for options to be researched.                         |
| [`.rules/briefs.md`](.rules/briefs.md)           | When the user asks for a brief.                                                     |
| [`.rules/formatting.md`](.rules/formatting.md)   | When a change adds a file type the repo doesn't have yet.                           |
| [`.rules/gitignore.md`](.rules/gitignore.md)     | When adding or changing ignore patterns.                                            |
| [`.rules/testing.md`](.rules/testing.md)         | When changing code or tests.                                                        |
| [`.rules/performance.md`](.rules/performance.md) | When changing code.                                                                 |

## Checks

Run `npm install` at the repo root once per checkout or worktree. It installs
every npm workspace, listed in the root `package.json`, and a pre-commit hook
that runs `npm run check:commit`, the formatting check, the doc lint and the
typecheck, and blocks the commit when it fails. The hook doesn't run the tests,
so run `npm run check` before pushing. Agent sessions always do. CI runs
`npm run check` on pushes to `main` and on pull requests. The checks run on the
working tree, not only what's staged. See
[0027](docs/decisions/0027-pre-commit-runs-only-fast-checks.md).

- `npm run format` formats every file Prettier supports, skipping files the root
  `.gitignore` ignores. `.sql` files are formatted as SQLite by
  `prettier-plugin-sql-cst`, configured in `.prettierrc.json`.
- `npm run format:check` lists the files that aren't formatted.
- `npm run lint:docs` runs `scripts/lint-docs.ts`, which never changes files. It
  fails when:
  - Two `.md` files directly in `docs/decisions/`, or two in `docs/research/`,
    have the same number. Numbers are compared as numbers, so `0002` and `2`
    match. A decision and a research doc can share a number.
  - A Markdown file has a local link or image to a file or folder that doesn't
    exist or that git ignores, or to a heading that doesn't exist. Headings
    follow GitHub's anchor rules.
  - A Markdown file has a local link that leaves the repo: a relative path that
    resolves outside it, an absolute path such as `/docs/glossary.md`, or a
    `file:` URL.
  - A skill, a Markdown file under `.claude/skills/`, links to a file or folder
    in `.rules/`. Rules can link to skills, but skills hold their own process
    and don't link to rules. See
    [0039](docs/decisions/0039-work-is-planned-into-briefs.md).

  Every Markdown file the root `.gitignore` doesn't ignore is checked. Links
  with another URL scheme, such as `https:`, and links in code aren't checked.
  The link checks are `remark-validate-links` and
  `scripts/remark-local-links.ts`, configured in `.remarkrc.js`.

- `npm run typecheck` runs `tsc` in every npm workspace, each extending the root
  `tsconfig.base.json`, and on the end-to-end tests in `e2e/`.
- `npm test` runs the tests for `scripts/`, then each npm workspace's `test`
  script, all with `node --test`. CLI commands are tested in-process with
  `@crustjs/testing`, and in child processes against a real review server. Tests
  set `XDG_STATE_HOME` to a temporary directory, so they never use the real
  state directory. Tests that run git, directly, through code under test, or in
  a child process, use the environment from `gitTestEnv` in
  `tools/implement/test/git-env.ts` or `scripts/test/git-env.ts`: `PATH`, a
  temporary `HOME`, no global or system git config, and nothing else they don't
  need. They never inherit `process.env`. Tests that run the real `aven` give it
  a scratch database, config, and home folder, and are skipped when `aven` isn't
  installed, as in CI.
- `npm run check:commit` runs `format:check`, `lint:docs` and `typecheck`, the
  checks the pre-commit hook runs. Only checks that are fast and don't run the
  repo's code belong in it.
- `npm run check` runs every check above: `check:commit`, then the tests. To add
  a check, add an npm script for it and append it to the `check` script in the
  root `package.json`, which today is `npm run check:commit && npm test`. A
  check that's fast and doesn't run the repo's code goes in `check:commit`
  instead, so the hook runs it too.
- `npm run test:e2e` builds the review UI, then runs the Playwright tests in
  `e2e/`, configured in `playwright.config.ts`. It isn't part of `npm run check`
  or the pre-commit hook, and runs in its own CI job. Install Chromium for it
  once with `npx playwright install --with-deps chromium`.

## Development

The review server, the CLI, and `packages/shared` run on Node 24 with type
stripping, with no build step. Only the review UI is built. See
[0026](docs/decisions/0026-workspaces-typescript-7-and-test-stack.md).

- **The CLI** runs from the repo root as `npx agent-diff`, such as
  `npx agent-diff session list`.
- **The review server** runs in the foreground with
  `npx agent-diff server start --foreground`, or with `npm run dev:server`,
  which restarts it when its code changes. It serves the built review UI, so run
  `npm run build -w packages/ui` first. It prints its port, and no URL. To open
  a session, use the link that `npx agent-diff session new <working-dir>` or
  `npx agent-diff session show <session-id>` prints, such as
  `http://127.0.0.1:40723/sessions/s_7kq9a1#token=…`.
- **The review UI** runs on Vite's dev server with `npm run dev:ui`, which
  reloads as its code changes and proxies API calls to the review server. Start
  the review server first, because the proxy reads its port from the config
  file. To open a session on the dev server, take a session's link and change
  its origin to the dev server's, such as
  `http://localhost:5173/sessions/s_7kq9a1#token=…`.

Both use the real state directory, `$XDG_STATE_HOME/agent-diff` or
`~/.local/state/agent-diff`. Set `XDG_STATE_HOME` to another directory, in every
shell, to keep development data separate.

Open the review UI through a session's link, which carries the token. Every API
call needs the token, and the review UI only gets it from the URL, so without it
the review UI asks for the link. See
[0031](docs/decisions/0031-the-review-ui-gets-the-token-in-the-url-fragment.md)
and
[0040](docs/decisions/0040-sessions-have-short-ids-and-cover-working-directories-by-real-path.md).
