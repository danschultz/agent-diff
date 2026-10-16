# 0028: The project defines how agent sessions work, and `implement` adds only what running unattended needs

- Status: Accepted
- Date: 2026-10-16

## Problem

Dan's own [agent sessions](../glossary.md#agent-session) in this repo and the
agent sessions `implement` starts ([0014](0014-implement-briefs-headlessly.md))
should work the same way: the same model, the same effort level, the same
[sub-agents](../glossary.md#sub-agent), and the same rules for writing code. If
each one picks these up from wherever it runs, such as a user's settings or an
alias that moves to a new model, they drift apart, and a change to how code gets
written happens without a review.

## Solution

- **`.claude/settings.json` is committed** with `"model": "claude-opus-5-5"` and
  `"effortLevel": "high"`, and nothing else. It applies to every agent session
  in this repo, Dan's own too. The model is the full model ID, not an alias such
  as `opus`, so it only changes through a commit. Claude Opus 5.5 defaults to
  `medium` effort, so the effort is set explicitly.
- **Sub-agent definitions live in `.claude/agents/`.**
- **Rules for how to work live in `.rules/`**, listed in `AGENTS.md`'s Rules
  table.
- **`implement` adds only what running unattended needs:** the `agent:*` labels,
  the `Notification` and `UserPromptSubmit` hooks in
  `tools/implement/settings.json`, Remote Control, auto permission mode, and the
  brief prompt. It doesn't pass `--model` or `--effort`, so its agent sessions
  get both from `.claude/settings.json`.

This was checked on Claude Code 2.1.301. A new agent session in a worktree sent
`claude-opus-5-5` with `high` effort, and `medium` in a folder without the
project's settings. A project `settings.json` with another full model ID changed
the model in the agent session's `init` event.

## Tradeoffs

Benefits:

- Changing the model, the effort level, a sub-agent, or a rule is a reviewed
  commit, and applies to every agent session at once.
- Dan's own agent sessions behave like the ones `implement` starts, so what Dan
  sees locally is what `implement` produces.
- `implement` stays small: its options are only about running unattended.

Costs:

- Dan's own agent sessions in this repo always start on this model and effort,
  unless Dan overrides them with `/model`, `--model`, or `--effort`.
- Moving to a new model takes a commit, even for a small upgrade.
- `high` effort costs more and is slower than the default.
- An environment variable such as `CLAUDE_EFFORT` overrides `effortLevel`.
  `implement` runs `claude` with a clean environment, so its agent sessions
  aren't affected, but Dan's own may be.

## Follow-up design choices

- **Creating and setting up worktrees.** How new worktrees are created and set
  up, for both Dan's agent sessions and `implement`'s. A project-defined
  `WorktreeCreate` hook used through Claude Code's `--worktree` flag, with an
  `npm run setup` script that installs dependencies, was discussed and deferred.
  `implement` still creates its worktrees itself.
- **`implement`'s own settings.** Whether `implement` should keep its own
  `settings.json` for its hooks, or move them elsewhere.
