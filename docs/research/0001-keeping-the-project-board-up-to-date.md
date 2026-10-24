# 0001: How should the project board stay up to date?

- Date: 2026-10-12

## Question

Dan uses the GitHub project board
[danschultz/projects/3](https://github.com/users/danschultz/projects/3) to see
agentic work at a glance: which briefs are queued, which need input, which are
in review, and which are done. Today the board is updated by hand. It should
update itself with no human involvement
([#11](https://github.com/danschultz/agent-diff/issues/11)).

The options are compared on whether they:

- Move a brief on the board whenever its state changes, including changes made
  by `implement`, by its `Notification` hook, by an agent session, and by Dan.
- Add briefs to the board without anyone adding them.
- Recover from a missed update instead of leaving the board wrong.
- Add new credentials or moving parts.

## Findings

### Brief state already lives in labels

[Decision 0014](../decisions/0014-implement-briefs-headlessly.md) makes the
`agent:*` labels the source of truth for a brief's state:

| Label               | Set by                                                                        |
| ------------------- | ----------------------------------------------------------------------------- |
| `agent:queued`      | Dan, to queue a brief.                                                        |
| `agent:working`     | `implement`, when it starts an agent session, and the hook, when Dan answers. |
| `agent:needs-input` | The `Notification` hook in `tools/implement/src/hook.ts`.                     |
| `agent:review`      | The agent session, after opening its pull request.                            |
| `agent:failed`      | `implement`, when an agent session exits without a pull request.              |

"Done" isn't a label. A brief is done when its issue is closed, normally by
merging a pull request that says "Closes #N".

Every label change made by `implement` and its hook goes through `moveTo` in
`tools/implement/src/github.ts`. The agent session sets `agent:review` itself
with `gh issue edit`, so `moveTo` doesn't see every change.

### The board's Status can't follow labels by itself

- A board's columns come from a single select or iteration field, normally
  Status. Labels can't be board columns
  ([Changing the layout of a view](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/changing-the-layout-of-a-view)).
- Built-in workflows can set Status when an item is added, closed, or merged,
  close an issue when its Status changes, archive items, and add items that
  match a filter. None of them react to labels
  ([Using the built-in automations](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations)).
  "Item closed" and "Pull request merged" set Status to Done and are on by
  default.
- The auto-add workflow adds issues from a repo that match a filter such as
  `is:issue label:agent:queued`. It only acts when an issue is created or
  updated, not on issues that already match. GitHub Free allows 1 auto-add
  workflow and Pro allows 5
  ([Adding items automatically](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/adding-items-automatically)).

So the built-in workflows can add briefs and move them to Done, but something
else must set Queued, Working, Needs input, In review, and Failed.

### Setting Status needs a token with project scope

- Project items are updated through the GraphQL mutations `addProjectV2ItemById`
  and `updateProjectV2ItemFieldValue`, or through `gh project item-add` and
  `gh project item-edit`, which call them
  ([Automating Projects using Actions](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/automating-projects-using-actions),
  [`gh project item-edit`](https://cli.github.com/manual/gh_project_item-edit)).
  `item-edit` sets one field per call, using IDs for the project, item, field,
  and option, which `gh project field-list` and `gh project item-list` return.
- In GitHub Actions, `GITHUB_TOKEN` is scoped to the repo and can't access
  projects. A user-owned project needs a personal access token (classic) with
  the `project` scope, stored as a repo secret. The docs' GitHub App example is
  for organization projects.
- Checked on the server on 2026-10-12: the `gh` CLI is logged in as `danschultz`
  with the scopes `admin:public_key`, `gist`, `read:org`, and `repo`.
  `gh project view 3 --owner danschultz` fails with "missing required scopes
  [read:project]". So the board's current fields and columns couldn't be read
  for this research, and anything that writes to the board from the server first
  needs `gh auth refresh -s project`.

## Options

### A. Built-in workflows only

Turn on auto-add with `is:issue label:agent:queued`, and keep "Item closed" and
"Pull request merged" setting Done.

Benefits:

- No code and no new credentials.

Costs:

- Briefs only ever show as Todo or Done. Needs input and In review, the two
  states Dan most needs to see, never appear.

### B. A GitHub Actions workflow on label events

A workflow in `.github/workflows/` runs on
`issues: [labeled, unlabeled, closed, reopened]`, maps the issue's `agent:*`
label to a Status, and sets it with `gh project item-add` and
`gh project item-edit`, authenticated by a classic PAT with `project` scope.

Benefits:

- The board updates within seconds of any label change, from any source,
  including Dan changing labels by hand.
- Works when the server is down.

Costs:

- A second long-lived credential for Dan's account, stored in GitHub. A classic
  PAT with `project` scope reaches every project Dan owns, and classic PATs
  can't be limited to one project.
- Label changes made with `GITHUB_TOKEN` don't trigger workflows. That doesn't
  affect today's setup, since `implement` and agent sessions use Dan's token,
  but it would silently break if that changed.
- Missed or failed runs leave the board wrong until the next label change on
  that issue. There's nothing that reconciles.
- The state mapping lives in YAML, apart from the `LABELS` it mirrors in
  `tools/implement/src/config.ts`.

### C. `implement` sets Status when it moves a label

Extend `moveTo` so every label change also sets the board's Status.

Benefits:

- Immediate for changes `implement` and its hook make.
- Uses the server's existing `gh` login.

Costs:

- Misses changes made outside `moveTo`: the agent session setting
  `agent:review`, Dan queuing a brief, and issues closing. Prompts would have to
  tell agent sessions to update the board too, which is fragile.
- A failed board update has no retry.

### D. `implement` reconciles the board on every tick

Add a step to each tick that reads the briefs and the board, works out the
Status each brief should have from its labels and whether it's closed, and fixes
any item that differs. The built-in workflows can still move closed items to
Done.

Benefits:

- Catches every change regardless of who made it, because it compares end states
  instead of watching events.
- Repairs itself: a failed or missed update is fixed on the next tick, and so is
  a card Dan drags to the wrong column.
- Uses the server's existing `gh` login, so no secret is stored in GitHub.
- The mapping lives next to `LABELS`, and can be unit tested with the fake
  `GitHub` that `tick.test.ts` already uses.

Costs:

- Up to 2 minutes of delay, the same as briefs being picked up today.
- The board stops updating while the server is down. Nothing else moves briefs
  while it's down either, except Dan queuing or closing them.
- A few more `gh` calls per tick: one to list open issues with `agent:*` labels,
  one to list the board's items, and one per item that changed.
- Reconciling overwrites manual Status changes on briefs, so the board is for
  viewing, not for changing a brief's state.

### Choices shared by B, C, and D

Options B, C, and D all set Status from labels, so each needs:

- **A mapping from labels to Status.** For example:

  | Brief                     | Status      |
  | ------------------------- | ----------- |
  | Open, `agent:queued`      | Queued      |
  | Open, `agent:working`     | Working     |
  | Open, `agent:needs-input` | Needs input |
  | Open, `agent:review`      | In review   |
  | Open, `agent:failed`      | Failed      |
  | Closed                    | Done        |

  `agent:failed` could share Needs input instead, but the two need different
  things from Dan: a failed brief's agent session has exited, so Dan re-queues
  or closes it rather than answering a question. Open issues with no `agent:*`
  label, such as briefs still being written, don't need a Status.

- **Status options on the board** that match the mapping, with Status as the
  board's column field.
- **A token with the `project` scope.** For C and D, that's
  `gh auth refresh -s project` on the server. The scope allows writing to every
  project Dan owns.
- **The "Item added to project" workflow turned off**, if it's on, so it doesn't
  race the sync by setting a default Status. "Item closed" and "Pull request
  merged" can stay on to set Done.

### What option D would change in `implement`

- **Configuration.** A setting such as `IMPLEMENT_PROJECT=danschultz/3` in
  `Config`. With it unset, the sync step is skipped.
- **GitHub access.** New methods on the `GitHub` interface in
  `tools/implement/src/github.ts`, wrapping `gh project field-list` (to find the
  Status field and option IDs by name), `gh project item-list`,
  `gh project item-add`, and `gh project item-edit`.
- **A sync step** at the end of `tick`, after `startQueued`, so it sees the
  labels that tick set. It lists open issues with `agent:*` labels and the
  board's items, adds briefs that are missing, and sets Status where it differs
  from the mapping. It runs inside `guard`, so a board failure is logged and
  doesn't stop briefs from being started, resumed, or reaped.
- **Tests** using the fake `GitHub` in `tools/implement/test/`, extended with an
  in-memory board.

Option C would add the same GitHub methods but call them from `moveTo`. C and D
can be combined, so `implement`'s own changes show at once and the tick catches
the rest.

## Gaps

- **The board's current setup.** Its fields, Status options, and enabled
  workflows couldn't be read, because the server's `gh` token lacks the
  `read:project` scope.
- **GitHub plan.** Whether Dan's account is on Free or Pro, which limits
  auto-add workflows to 1 or 5, wasn't checked.
- **Other repos.** If `implement` takes briefs from more repos, as decision
  0014's follow-up choices consider, each option would need to handle items from
  several repos. This wasn't looked into.
