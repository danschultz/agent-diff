# 0039: Work is planned into vertical slices as Aven epics, and written as decision, research, and build briefs

- Status: Accepted
- Date: 2026-10-22

## Problem

Dan plans work with an [agent session](../glossary.md#agent-session) and turns
it into briefs that `implement` runs unattended
([0014](0014-implement-briefs-headlessly.md),
[0034](0034-briefs-are-aven-tasks.md)). How that happens has only been agreed in
conversation: how the next piece of work is chosen, how a feature is split into
briefs, what each brief contains, and how briefs depend on each other. Each
agent session that plans starts from nothing, so the process drifts, and design
choices can be left for a build brief to make on its own.

Planning and writing a brief are separate. Planning decides what to build and in
what order. Writing a brief turns one item of a plan, or a one-off request such
as a bug fix, into a brief.

## Solution

### Planning

- **Choosing what's next.** When Dan asks what to work on next, the agent
  session reads the README's open questions and to-dos, Aven's open tasks and
  epics in `agent-diff`, and what merged recently. It recommends one thing with
  its reasons, and lists the alternatives briefly.
- **Vertical slices.** A feature is split into build briefs that each deliver
  one thing end to end, through every layer it touches: storage, the API, the
  CLI, and the [review UI](../glossary.md#review-ui). The first slice is the
  smallest version of the whole flow. A later slice that touches something built
  earlier also updates it, such as a [diff mode](../glossary.md#diff-mode) slice
  that shows comments in each diff mode.
- **Three kinds of brief.**
  - A **decision brief** records design Dan has agreed, as one or more
    decisions. It only changes docs.
  - A **research brief** investigates a question that can't be settled by
    talking it through, and records findings following
    [`.rules/research.md`](../../.rules/research.md).
  - A **build brief** builds to the decisions it names. It records no decision
    of its own, and escalates when it would need a choice those decisions don't
    cover.

  The agent session that plans doesn't open documentation pull requests itself.
  Agreed design reaches the repo through decision briefs.

- **Dependencies.** Each build brief depends, with `aven dep add`, on the
  decision briefs it builds to and on the slices it builds on
  ([0035](0035-queued-briefs-wait-for-their-blockers.md)). A brief that changes
  glossary terms waits for any brief already renaming terms in the same files.
- **Waves.** Briefs are grouped into waves that can run together, at most two at
  a time, because more burns through Dan's usage limit. A dependency only means
  waiting for that brief, not for the whole wave.
- **Plans are Aven epics.** Each feature gets an epic in `agent-diff` with its
  briefs added. The epic's description holds the wave table, naming written
  briefs by ref and planned ones by title, plus notes on what's already agreed
  for briefs not written yet. Plans live in Aven because Aven refs never appear
  on GitHub ([0034](0034-briefs-are-aven-tasks.md)).
- **Briefs are written just in time.** Only the next waves are written. Later
  briefs stay as notes in the epic until the earlier slices have taught
  something.
- **Writing the briefs.** Each brief in the next waves is written by following
  the steps for writing one brief below.

### Writing one brief

- **Interviewing Dan.** Before writing a brief, the agent session asks about
  every choice the decisions don't settle:
  - Each question offers options with the recommended one first, and says why.
  - New or changed terms need Dan's agreement, following
    [`.rules/glossary.md`](../../.rules/glossary.md).
  - Output wording the agent session made up, such as CLI output, is shown to
    Dan before the brief is queued.
  - What Dan agrees goes into the brief as "design choices agreed with Dan".
- **Writing it.** The brief follows the template for its kind.
- **Creating it.** The brief is added to Aven with its dependencies, and added
  to its epic when it's part of a plan. It isn't queued until Dan asks. A brief
  that's replaced is canceled, has `agent=queued` removed, and gets a note
  naming what replaced it.

### Where it's written

- **[`.rules/planning.md`](../../.rules/planning.md)** holds the planning steps.
  It points to [`.rules/briefs.md`](../../.rules/briefs.md) for writing each
  brief, rather than repeating those steps. `AGENTS.md`'s Rules table lists it
  "When the user asks what to work on next, or to plan a feature into briefs."
  The row for `.rules/briefs.md`, "When the user asks for a brief", stays.
- **`.rules/briefs.md`** holds the steps for writing one brief, and a section on
  the three kinds of brief, with a template for each under the headings it
  already lists, saying what goes in each heading. The templates are based on
  the briefs written so far:
  - **Decision brief.**
    - Goal: the decisions to record, and that it only writes docs.
    - Out of scope: code, designing anything not listed, and changing earlier
      decisions beyond the amendments listed.
    - Context: what to read first, then "These are the design choices agreed
      with Dan. Record them as written.", grouped by decision. Then sections for
      the effect on earlier decisions, terms, tradeoffs to include, and
      follow-up design choices to include.
    - Acceptance criteria: decision files with the next free numbers and every
      template section, every listed choice recorded, index rows, amendment
      notes, the README's Decisions list, glossary changes, and `npm run check`.
    - Verification: `npm run check`, and a list in the pull request mapping each
      Context heading to the section that records it.
    - Escalation criteria: a choice contradicts an accepted decision, the
      glossary, or the README, or writing needs a term or a choice that isn't
      listed.
  - **Research brief.**
    - Goal: the question, so Dan can decide, recorded following
      `.rules/research.md`.
    - Out of scope: choosing an option, changes outside the research doc and its
      prototypes, and changes to Dan's own configuration.
    - Context: leads to check, marked as not findings, and the things that
      matter for comparing options. It says when the research should ignore
      earlier decisions so they don't bias it.
    - Acceptance criteria: the doc follows the template, has a comparison table
      with no cell left "not checked", options were tried by hand where they can
      be, sources are cited with dates and versions, it makes no recommendation,
      and new terms are proposed in the pull request.
    - Verification: rerun the prototypes, check `git status` has nothing outside
      `docs/research/`, and `npm run check`.
    - Notes: renumber if another research doc lands first, and hand options to
      [sub-agents](../glossary.md#sub-agent) to keep the agent session's context
      small.
  - **Build brief.**
    - Goal: the feature end to end, and the decisions it builds to.
    - Out of scope: the later slices by name, new dependencies other than those
      listed, and changing what a decision decided.
    - Context: what to read first, including the code whose patterns to follow,
      then the choices agreed with Dan for this brief, grouped by layer:
      storage, API, CLI, review UI. Then the dependencies allowed, each pinned.
    - Acceptance criteria: each behavior, plus the tests the repo expects: CLI
      commands in-process and in a child process, Playwright for the review UI,
      the token test for every new procedure, `gitTestEnv`, and the sizes in
      [`.rules/performance.md`](../../.rules/performance.md).
    - Verification: `npm run check`, `npm run test:e2e`, and a hand check with
      `XDG_STATE_HOME` set to a temporary directory, reporting the commands'
      output and attaching screenshots of the review UI.
    - Escalation criteria: a decision can't be followed as written, a new
      dependency or router library seems needed, or an uncovered choice would
      change the CLI's output for agents, the API, or what the review UI shows.
    - Notes: synchronous queries
      ([0022](0022-node-sqlite-plain-sql-and-dbmate.md)), and which other brief
      may run at the same time and change the same files, so the agent session
      rebases.
- **Two project skills**, each thin: it says when to use it, and tells the agent
  session to read and follow its rule, so the process is written in one place.
  The model may also use each on its own when Dan's request matches.
  - **`/plan-work`**, in
    [`.claude/skills/plan-work/SKILL.md`](../../.claude/skills/plan-work/SKILL.md),
    follows `.rules/planning.md`. It's for when Dan asks what to work on next,
    or to plan a feature. It uses `/create-brief` for each brief it writes.
  - **`/create-brief`**, in
    [`.claude/skills/create-brief/SKILL.md`](../../.claude/skills/create-brief/SKILL.md),
    follows `.rules/briefs.md`. It's for when Dan asks for a brief, on its own
    or as part of a plan.

### Effect on earlier decisions

- **[0028](0028-the-project-defines-how-agent-sessions-work.md): amended.** The
  project defines agent sessions through `.claude/settings.json`,
  `.claude/agents/`, `.rules/`, and now `.claude/skills/` for skills Dan runs by
  name. A skill holds no process of its own, and points at the rules.

Reviewing brief pull requests, and how changes to them are asked for, are left
out of this process for now.

## Tradeoffs

Benefits:

- Every agent session that plans follows the same steps, and design is agreed
  before code is written.
- Small slices keep pull requests reviewable, and let Dan use agent-diff sooner.
- Plans and briefs live together in Aven, so a plan can name its briefs by ref.
- Templates make briefs consistent, and `implement` already rejects briefs
  missing a required heading.
- Build briefs that escalate on uncovered choices keep design decisions with
  Dan, rather than with an agent session running unattended.
- The skills hold no steps, so changing the process is a change to one rule, in
  a reviewed commit, as with any other rule
  ([0028](0028-the-project-defines-how-agent-sessions-work.md)).

Costs:

- More briefs, so more `implement` runs, self-reviews, and CI runs per feature.
- Decision briefs add a round trip before building starts.
- Plans in Aven aren't visible on GitHub, so the pull requests for a feature
  don't show how they fit together.
- Templates can turn into boilerplate that's copied without thought.
- Writing briefs just in time means a plan's later waves are only notes, and can
  change after Dan has seen them.
- The skills depend on Claude Code's skill format and on the model choosing to
  use them, which may change. Agent sessions in other harnesses only get the
  rules, through `AGENTS.md`.

## Follow-up design choices

- **Changes to brief pull requests.** How changes to a brief's pull request are
  asked for, and how the epic is updated after a brief merges.
- **Reading epics.** Whether `implement` reads epics, for example to report a
  feature's progress.
- **Limiting running briefs.** Whether the at-most-two limit on running briefs
  belongs in `implement` rather than in the plan.
