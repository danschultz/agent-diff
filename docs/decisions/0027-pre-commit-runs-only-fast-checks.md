# 0027: The pre-commit hook runs only fast checks, and tests that run git use a hermetic environment

- Status: Accepted
- Date: 2026-10-16

## Problem

The pre-commit hook ran all of `npm run check`, including every npm workspace's
tests. Git exports variables such as `GIT_DIR` and `GIT_INDEX_FILE` to hooks so
they find the repo being committed, and the tests inherited them. Tests that
create temporary repos then acted on the repo being committed instead. That
broke Dan's checkout while #31 was being committed: `core.bare` became `true`,
and `user.name` and `user.email` became the tests' values. In a main checkout,
`GIT_INDEX_FILE` alone is enough for a test's `git add` to overwrite what's
staged.

[`githooks(5)`](https://git-scm.com/docs/githooks) says a hook that runs git in
another repo should clear these variables first, with
`unset $(git rev-parse --local-env-vars)`. #31 added that line to the hook as a
workaround. But the tests shouldn't depend on where they're run from, and a
commit shouldn't run the repo's code at all. What needed deciding was what runs
at commit, what runs elsewhere, and how tests that run git are isolated.

## Solution

- **At commit, the hook runs only fast checks that don't run the repo's code.**
  `.githooks/pre-commit` runs `npm run check:commit`: formatting
  (`format:check`), the doc lint (`lint:docs`) and the typecheck (`typecheck`).
  `lint:docs` runs `git check-ignore` in this repo, which is the repo the hook's
  variables point at, so it's safe there. `tsc` only reads the source and
  doesn't run git, and the workspaces export their `src/*.ts` directly, so it
  needs no build first. The hook no longer clears git's variables, since nothing
  it runs needs that.
- **`npm run check` and CI run everything.** `npm run check` runs
  `check:commit`, then the tests. CI runs it on pushes to `main` and on pull
  requests, and agent sessions run it before pushing, as each brief's
  verification asks.
- **Tests that run git use a hermetic environment.** Every test that runs git,
  directly, through code under test, or through a child process, builds its
  environment from an allowlist instead of from `process.env`: `PATH`, a
  temporary `HOME`, and `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` set to
  `/dev/null`. It adds anything else only when it needs it. No `GIT_*` variable,
  `~/.gitconfig`, or setting such as `commit.gpgsign` or `core.hooksPath` can
  change what the test does, wherever it's run from: a terminal, CI, a git hook,
  or an agent session.
- **Each place that needs the environment has its own small helper.**
  `tools/implement/test/git-env.ts` and `scripts/test/git-env.ts` each export
  `gitTestEnv`, with a unit test. There's no helper shared across npm
  workspaces.
- **Production code respects the environment it's given.** `implement` runs from
  a systemd timer and the review server from the user's shell, never inside a
  git hook. `cliGit` takes its base environment as an argument, defaulting to
  `process.env`, so a test can pass its hermetic one in. It doesn't filter
  anything itself.

## Tradeoffs

Benefits:

- A commit can't change the repo it's made in, from a main checkout or a linked
  worktree.
- Tests behave the same wherever they're run, and don't pick up the user's git
  config.
- Commits are faster, which matters most for agent sessions that commit often.

Costs:

- A commit can break the tests. That's caught by `npm run check` before pushing,
  or by CI, rather than at commit.
- A commit with type errors is blocked, even a work-in-progress one.
  `git commit --no-verify` gets around it.
- Each test that runs git has to remember to use the helper. A test that doesn't
  is only safe as long as nothing runs it inside a hook.

## Follow-up design choices

- When the review server starts running git, its tests need the same kind of
  helper, in its own npm workspace.
- Whether a pre-push hook, or another local gate, should run the tests.
