# Writing briefs

A brief is a task for an [agent session](../docs/glossary.md#agent-session) that
`implement` starts unattended. Briefs are tasks in the Aven project
`agent-diff`, and the task's description is the brief, given to the agent
session as written. See [0031](../docs/decisions/0034-briefs-are-aven-tasks.md)
and [`tools/implement/README.md`](../tools/implement/README.md).

## Steps

Writing a brief turns one item of a plan, or a one-off request such as a bug
fix, into a brief. Planning, which decides what to build and in what order,
follows [`.rules/planning.md`](planning.md).

1. **Interview Dan.** Before writing the brief, ask Dan about every choice that
   accepted decisions don't settle:
   - Give each question options, with the one you recommend first, and say why.
   - Get Dan's agreement to new or changed terms, following
     [`.rules/glossary.md`](glossary.md).
   - Show Dan any output wording you made up, such as CLI output, before the
     brief is queued.
   - Write what Dan agrees into the brief's Context as design choices agreed
     with Dan.
2. **Write it.** Use the [headings](#headings), following the template for its
   [kind](#kinds-of-brief).
3. **Create it.** Add it to Aven, following
   [Creating a brief](#creating-a-brief), with its
   [dependencies](#depending-on-another-brief). When it's part of a plan, add it
   to the plan's epic. Don't queue it until Dan asks. When a brief replaces
   another, [cancel the old one](#replacing-a-brief).

## Headings

Write the brief under these `###` headings, in this order. Goal, Acceptance
criteria, and Verification are required. Use the others when the brief needs
them:

| Heading             | Required | What it's for                                                                    |
| ------------------- | -------- | -------------------------------------------------------------------------------- |
| Goal                | Yes      | The outcome to deliver.                                                          |
| Out of scope        | No       | A hard boundary. Needing to cross it is a reason to escalate.                    |
| Context             | No       | Background, links, and files to read first.                                      |
| Acceptance criteria | Yes      | Each one is checked and reported as met or not met in the pull request.          |
| Verification        | Yes      | Steps the agent session runs. Their results are reported in the pull request.    |
| Escalation criteria | No       | Situations where the agent session stops and asks Dan instead of deciding alone. |
| Notes               | No       | Anything else.                                                                   |

When a queued brief is missing a required heading, or it's empty, `implement`
doesn't start it. It removes `agent=queued` and adds a note to the task listing
what's missing.

## Kinds of brief

Every brief is one of three kinds. Each template below uses the headings above,
in their order, and says what goes under each one. Replace the text in angle
brackets, and leave out the optional headings a brief doesn't need.

### Decision brief

A decision brief records design Dan has agreed, as one or more decisions,
following [`.rules/decisions.md`](decisions.md). It only changes docs.

```markdown
### Goal

<The decisions to record, one line each, and that the brief only writes docs.>

### Out of scope

- Code.
- Designing anything not listed below.
- Changing what an earlier decision decided, beyond the amendments listed below.

### Context

Read first:

- <The docs, decisions, and research the decisions build on.>

These are the design choices agreed with Dan. Record them as written.

#### <Decision title>

- <Each choice for this decision.>

#### Effect on earlier decisions

- **<NNNN>: <amended or superseded>.** <What changes.>

#### Terms

- <Terms to add or change in the glossary, as agreed with Dan.>

#### Tradeoffs to include

- Benefits: <...>
- Costs: <...>

#### Follow-up design choices to include

- <Questions the decisions leave open.>

### Acceptance criteria

- A decision file for each decision, with the next free number on `main`, that
  follows the template in `.rules/decisions.md` with every section filled in.
- Every choice listed under Context is recorded.
- Each decision has a row in `docs/decisions/README.md`, and the README's
  Decisions list has a line for it.
- Each amended or superseded decision has its new status, a note at the top, and
  an updated index row.
- The glossary changes listed under Terms are made, following
  `.rules/glossary.md`.
- `npm run check` passes.

### Verification

1. Run `npm run check` and report the result.
2. In the pull request, list each heading under Context and the section that
   records it.

### Escalation criteria

- A choice contradicts an accepted decision, the glossary, or the README, beyond
  the amendments under Effect on earlier decisions and the changes under Terms.
- Writing a decision needs a term or a design choice that isn't listed above.

### Notes

- <Other decision briefs that may be open at the same time. Use the next free
  decision number on `main`, and renumber if another lands first.>
```

### Research brief

A research brief investigates a question that can't be settled by talking it
through, so Dan can decide. It records findings following
[`.rules/research.md`](research.md), and doesn't choose an option.

```markdown
### Goal

<The question, and what Dan needs to decide from the answer.> Record the
findings following `.rules/research.md`.

### Out of scope

- Choosing an option.
- Changes outside the research doc and its prototypes.
- Changes to Dan's own configuration.

### Context

<Leads to check, such as tools, docs, or approaches. Say they're leads, not
findings.>

<What matters when comparing options, such as platforms, limits, or the workflow
they must fit.>

<When earlier decisions shouldn't bias the research, say to ignore them.>

### Acceptance criteria

- The research doc follows the template in `.rules/research.md`, with the next
  free number on `main`, and a row in `docs/research/README.md`.
- It has a table comparing the options, with no cell left "not checked".
- Options were tried by hand where they can be, with the commands and their
  output.
- Sources are cited with dates and versions.
- It makes no recommendation.
- New terms are proposed in the pull request, not added to the glossary.
- `npm run check` passes.

### Verification

1. Rerun the prototypes, and report their output.
2. Check that `git status` shows nothing changed outside `docs/research/`.
3. Run `npm run check` and report the result.

### Notes

- If another research doc lands first, renumber this one.
- Hand each option to a sub-agent, to keep the agent session's context small.
```

### Build brief

A build brief builds one vertical slice of a feature to the decisions it names.
It records no decision of its own, and escalates when it would need a choice
those decisions don't cover.

```markdown
### Goal

<The feature this slice delivers, end to end.> Build to <the decisions it
builds to>.

### Out of scope

- <The later slices, by name.>
- New dependencies other than those listed under Context.
- Changing what a decision decided.

### Context

Read first:

- <The decisions it builds to, and the docs and rules that apply.>
- <The code whose patterns to follow.>

These are the design choices agreed with Dan for this brief.

#### Storage

- <...>

#### API

- <...>

#### CLI

- <...>

#### Review UI

- <...>

#### Dependencies

- <Each dependency allowed, pinned to a version.>

### Acceptance criteria

- <Each behavior the slice delivers.>
- CLI commands are tested in-process with `@crustjs/testing`, and in a child
  process against a real review server.
- The review UI is tested with Playwright, in `e2e/`.
- Every new API procedure has a test that it rejects calls without the token.
- Tests that run git use the environment from `gitTestEnv`.
- It performs at the sizes in `.rules/performance.md`.
- `npm run check` passes.

### Verification

1. Run `npm run check` and `npm run test:e2e`, and report the results.
2. With `XDG_STATE_HOME` set to a temporary directory, run <the commands> by
   hand and report their output, and attach screenshots of the review UI to the
   pull request.

### Escalation criteria

- A decision can't be followed as written.
- A new dependency or a router library seems needed.
- A choice the decisions don't cover would change the CLI's output for agents,
  the API, or what the review UI shows.

### Notes

- `node:sqlite` queries are synchronous (0022), so every query blocks the review
  server's event loop.
- <Other briefs that may run at the same time and change the same files. If one
  merges first, rebase onto it.>
```

## Creating a brief

Create the task in `agent-diff`, passing the project explicitly, with the
description on standard input:

```sh
aven add "Add a --version flag" --project agent-diff --description-stdin <<'BRIEF'
### Goal

Add a `--version` flag to the `agent-diff` CLI.

### Acceptance criteria

- `agent-diff --version` prints the version from `package.json`.

### Verification

Run `npx agent-diff --version`, and check it prints the version.
BRIEF
```

Report the ref `aven add` prints. Keep the ref out of commits, pull requests,
and anything else on GitHub.

When the brief is part of a plan, add it to the plan's epic, following
[`.rules/planning.md`](planning.md#the-plan-is-an-aven-epic):

```sh
aven epic add <ref> <epic ref>
```

## Queuing a brief

`implement` starts a brief once its task has `agent=queued`. Set it only when
Dan asks, since a brief Dan hasn't asked to queue is a draft:

```sh
aven edit <ref> --metadata agent=queued
```

## Depending on another brief

When a brief can only start once another task is finished, such as another brief
whose changes it builds on, make it depend on that task:

```sh
aven dep add <ref> <blocker ref>
```

The blocker can be any task, in any project. `implement` leaves a queued brief
waiting until every task it depends on is `done`, so a brief depending on
another brief starts once that brief's pull request is merged. If a blocker is
`canceled` or deleted, `implement` removes `agent=queued` and adds a note saying
to remove the dependency with `aven dep remove <ref> <blocker ref>`. See
[0035](../docs/decisions/0035-queued-briefs-wait-for-their-blockers.md).

## Replacing a brief

When a new brief replaces one that isn't done, cancel the old one, remove its
`agent=queued`, and add a note naming the brief that replaces it:

```sh
aven edit <old ref> --status canceled --remove-metadata agent
aven note <old ref> "Replaced by <new ref>."
```
