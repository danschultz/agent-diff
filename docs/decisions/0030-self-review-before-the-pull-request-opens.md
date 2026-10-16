# 0030: Agent sessions started by `implement` self-review before opening a pull request, and wait for CI

- Status: Accepted
- Date: 2026-10-16

## Problem

`implement`'s [agent session](../glossary.md#agent-session) checks the brief's
acceptance criteria and runs its verification steps, then opens a draft pull
request and moves the brief to `agent:review`
([0014](0014-implement-briefs-headlessly.md)). Nothing reviews its diff before
Dan does. An agent session reviewing its own changes tends to approve its own
choices, since its reasoning and shortcuts are still in context. And a pull
request can reach Dan with failing CI, because nothing waits for it.

## Solution

- **A `self-review` [sub-agent](../glossary.md#sub-agent).**
  `.claude/agents/self-review.md` defines it, with `claude-opus-5-5` and `high`
  effort in its frontmatter, matching `.claude/settings.json`
  ([0028](0028-the-project-defines-how-agent-sessions-work.md)). Its tools are
  `Bash` and `Read`, so it has no `Edit`, `Write`, or `NotebookEdit`. It needs
  `Bash` to run `git diff` and `gh issue view`, and its instructions say not to
  change anything. It isn't called a reviewer, since the
  [reviewer](../glossary.md#reviewer) is the human.
- **It's given only the brief's issue number and the diff range** against
  `origin/<base branch>`, not the implementing agent session's summary or
  reasoning. It starts with an empty context, so it sees only what a human
  would: the brief, the rules, and the diff. Its reading stays in its own
  context, and only its findings come back.
- **What it does.** It reads `AGENTS.md`, the rules, the brief, the diff, and
  the code around it. It checks correctness, the brief's acceptance criteria and
  out of scope boundary, the rules (including test-first,
  [0029](0029-code-is-written-test-first.md)), performance, code quality, and
  whether the diff stays within the brief. It returns findings, each with a
  location, how serious it is, and why.
- **Performance is judged against agent-diff's sizes.** A new rule,
  [`.rules/performance.md`](../../.rules/performance.md), is in `AGENTS.md`'s
  Rules table, so the implementing agent session reads it too. It treats Big-O
  as one input, not the whole measure: a cost counts only when the work grows
  faster than it should, n is large in practice, and the code runs often. It
  sets the sizes to design for (about 50 working directories in a
  [review session](../glossary.md#review-session), 10,000 files in a working
  directory, 50,000 lines in one file's diff, 500 comments, and thousands of
  file-system events a second), and calls out agent-diff's own risks:
  synchronous `node:sqlite` queries blocking the event loop, recomputing
  everything on one file-system event, hand-written LCS diffs, and re-rendering
  the review UI. The sub-agent rates exponential work, worse-than-linear work on
  a hot path, and unbounded reads as `high`, avoidable linear work, N+1 queries,
  unbatched events, and serial `await`s as `medium`, and doesn't report
  constant-factor tweaks or work over something that stays small.
- **Rounds.** After checking the acceptance criteria and running the
  verification steps, and before pushing, the agent session starts the
  `self-review` sub-agent. It fixes the findings it agrees with, test-first, and
  reruns the verification steps. If the fixes were substantial, it starts a
  second, new `self-review` sub-agent, given the first round's findings and how
  each was handled. There are at most 2 rounds.
- **Reporting.** The pull request body gets a "Self-review" section listing
  every finding as fixed, declined with the reason, or still open. Findings
  still open don't block the pull request.
- **Only before the pull request first opens.** A resumed agent session, after
  Dan's pull request review, doesn't self-review.
- **Waiting for CI.** After pushing, both when starting and when resumed, the
  agent session waits for the pull request's checks with
  `gh pr checks <number> --watch`, fixes failures and pushes again, and moves
  the brief to `agent:review` only once they pass. If it can't make them pass,
  it escalates.
- **Exploring first.** The agent session reads the brief's Context and the files
  the change touches before editing, and writes a short plan before starting a
  brief with more than one step.
- **Small diffs.** The agent session matches the surrounding code, keeps the
  diff to the brief, and leaves unrelated code alone.

The implementing agent session stays the
[main agent](../glossary.md#main-agent), so escalating through Remote Control
and resuming after Dan's pull request reviews work as in
[0014](0014-implement-briefs-headlessly.md).

This was checked on Claude Code 2.1.301. A new agent session listed
`self-review` among its agents, and when it started the sub-agent, the
sub-agent's requests used `claude-opus-5-5` with `high` effort, even when the
agent session ran with `--effort low`, and offered only `Bash` and `Read`.

## Tradeoffs

Benefits:

- Pull requests reach Dan with a review already done by an agent that didn't
  write the code, and with what it found and how each finding was handled.
- The sub-agent's reading doesn't fill the implementing agent session's context.
- Pull requests reach Dan with CI passing, or with a question about why it
  can't.
- Escalation and resuming are unchanged, because the implementing agent session
  is still the main agent.

Costs:

- Each brief takes longer and uses more tokens: one or two more reviews, and
  waiting for CI.
- The sub-agent can still change files through `Bash`. Only its instructions
  stop it.
- The implementing agent session decides which findings it agrees with, so it
  can still decline a good one. The "Self-review" section shows Dan what it
  declined and why.
- Fixes made after Dan's pull request review aren't self-reviewed.
- The sizes in `.rules/performance.md` are estimates. Too small, and real
  bottlenecks pass. Too large, and the sub-agent pushes optimizations against
  keeping code simple.

## Follow-up design choices

- **Self-review when resumed.** Whether a resumed agent session should
  self-review its fixes to Dan's pull request review.
- **Rebasing first.** Whether the agent session should rebase on
  `origin/<base branch>` before opening the pull request.
