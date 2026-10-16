# Writing code test-first

Every change to code is written test-first, in every package, including
`prototype/`, `scripts/`, and `tools/`. The only exception is performance fixes,
below. See [0029](../docs/decisions/0029-code-is-written-test-first.md).

## Steps

1. Write a failing test for the behavior you're adding or changing.
2. Run it, and see it fail for the expected reason, such as a missing function
   or a wrong result, not a typo or a broken import.
3. Write the least code that makes it pass.
4. Refactor with the tests passing.

A bug fix starts with a test that reproduces the bug, and fails until the bug is
fixed.

## Performance fixes

A performance fix doesn't need a failing test first, because tests that check
timing are flaky in CI. Write one when the cost can be checked without timing,
such as a scaling test that counts queries, or a test with a timeout that a
catastrophically backtracking regex would fail. See
[`.rules/performance.md`](performance.md).

## Test stack

Use the test stack from
[0026](../docs/decisions/0026-workspaces-typescript-7-and-test-stack.md):

- `node --test` for `scripts/`, `tools/`, and each npm workspace.
- `@crustjs/testing` for CLI commands, run in-process.
- Playwright, in `e2e/`, for the whole path through the review UI.
