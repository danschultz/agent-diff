# 0033: Breaking changes are allowed during early development

- Status: Accepted
- Date: 2026-10-19

## Problem

agent-diff is in early development, with no users but Dan. Code that keeps
working with what earlier versions wrote or accepted, such as a config file
without a field that was added later, makes every change bigger, needs its own
tests, and stays after nobody needs it. Briefs and agent sessions need to know
whether to write it.

## Solution

- **Breaking changes are allowed** for the foreseeable future. A change doesn't
  need to keep working with files, API calls, or CLI usage from earlier
  versions.
- **No compatibility code.** Don't write fallbacks, conversions, or tests for
  what earlier versions wrote or accepted, unless a brief asks for them. For
  example, a config file without a token isn't valid, and is replaced like any
  other config file that isn't valid.
- **`AGENTS.md` says so,** so every agent session follows it.

## Tradeoffs

Benefits:

- Changes stay small, and the code only handles the current format of each file
  and API.
- Nothing needs removing later.

Costs:

- Updating can lose local state, such as the saved port, or need the user to
  start the review server again or open a new link.
- The policy has to change before anyone else depends on agent-diff.

## Follow-up design choices

- **When it ends.** What marks the end of early development, such as a first
  release, and what compatibility is promised after it.
