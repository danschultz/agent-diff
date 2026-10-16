# 0029: Code is written test-first

- Status: Accepted
- Date: 2026-10-16

## Problem

Tests written after the code tend to check what the code already does, rather
than what it should do, and a test that has never failed may not test anything.
Agent sessions write most of the code in this repo, often unattended
([0014](0014-implement-briefs-headlessly.md)), so the tests are much of what Dan
relies on when reviewing their work.

## Solution

- **Every change is written test-first,** in every package, including
  `prototype/`, `scripts/`, and `tools/`, with no exceptions. The rule is
  [`.rules/testing.md`](../../.rules/testing.md), listed in `AGENTS.md`'s Rules
  table to be read when changing code or tests.
- **The steps:** write a failing test first, run it, and see it fail for the
  expected reason. Write the least code that makes it pass. Refactor with the
  tests passing.
- **A bug fix starts with a test that reproduces the bug.**
- **The test stack is unchanged.** Tests use the stack from
  [0026](0026-workspaces-typescript-7-and-test-stack.md): `node --test`,
  `@crustjs/testing`, and Playwright.

## Tradeoffs

Benefits:

- Every behavior has a test that has been seen to fail without it.
- Bug fixes come with a test that stops the bug coming back.
- Dan can read the tests to see what a change was meant to do.
- The [self-review](../glossary.md#self-review) sub-agent
  ([0030](0030-self-review-before-the-pull-request-opens.md)) has a clear rule
  to check changes against.

Costs:

- Changes take longer, including small ones and changes to `prototype/`, which
  isn't checked by `npm run check` or CI.
- Some changes, such as prompts or docs that code reads, are hard to test
  without testing their wording.
- Whether a test was written first can't be checked by a tool, only by the
  history of commits and what's reported in the pull request.

## Follow-up design choices

- None.
