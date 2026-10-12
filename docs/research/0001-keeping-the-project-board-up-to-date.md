# 0001: How should the project board stay up to date?

- Status: Proposed
- Date: 2026-10-12

## Question

Dan uses the GitHub project board
[danschultz/projects/3](https://github.com/users/danschultz/projects/3) to
see agentic work at a glance: which briefs are queued, which need input,
which are in review, and which are done. Today the board is updated by hand.
It should update itself with no human involvement
([#11](https://github.com/danschultz/agent-diff/issues/11)).

A good answer must:

- Move a brief on the board whenever its state changes, including changes
  made by `implement`, by its `Notification` hook, by an agent session, and
  by Dan.
- Add briefs to the board without anyone adding them.
- Recover from a missed update instead of leaving the board wrong.
- Add as few new credentials and moving parts as possible.

## Findings

### Brief state already lives in labels

[Decision 0014](../decisions/0014-implement-briefs-headlessly.md) makes the
`agent:*` labels the source of truth for a brief's state:

| Label | Set by |
| ----- | ------ |
| `agent:queued` | Dan, to queue a brief. |
| `agent:working` | `implement`, when it starts an agent session, and the hook, when Dan answers. |
| `agent:needs-input` | The `Notification` hook in `tools/implement/src/hook.ts`. |
| `agent:review` | The agent session, after opening its pull request. |
| `agent:failed` | `implement`, when an agent session exits without a pull request. |

"Done" isn't a label. A brief is done when its issue is closed, normally by
merging a pull request that says "Closes #N".

Every label change made by `implement` and its hook goes through `moveTo` in
`tools/implement/src/github.ts`. The agent session sets `agent:review`
itself with `gh issue edit`, so `moveTo` doesn't see every change.

### The board's Status can't follow labels by itself

- A board's columns come from a single select or iteration field, normally
  Status. Labels can't be board columns
  ([Changing the layout of a view](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/changing-the-layout-of-a-view)).
- Built-in workflows can set Status when an item is added, closed, or
  merged, close an issue when its Status changes, archive items, and add
  items that match a filter. None of them react to labels
  ([Using the built-in automations](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations)).
  "Item closed" and "Pull request merged" set Status to Done and are on by
  default.
- The auto-add workflow adds issues from a repo that match a filter such as
  `is:issue label:agent:queued`. It only acts when an issue is created or
  updated, not on issues that already match. GitHub Free allows 1 auto-add
  workflow and Pro allows 5
  ([Adding items automatically](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/adding-items-automatically)).

So the built-in workflows can add briefs and move them to Done, but
something else must set Queued, Working, Needs input, In review, and Failed.

### Setting Status needs a token with project scope

- Project items are updated through the GraphQL mutations
  `addProjectV2ItemById` and `updateProjectV2ItemFieldValue`, or through
  `gh project item-add` and `gh project item-edit`, which call them
  ([Automating Projects using Actions](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/automating-projects-using-actions),
  [`gh project item-edit`](https://cli.github.com/manual/gh_project_item-edit)).
  `item-edit` sets one field per call, using IDs for the project, item,
  field, and option, which `gh project field-list` and
  `gh project item-list` return.
- In GitHub Actions, `GITHUB_TOKEN` is scoped to the repo and can't access
  projects. A user-owned project needs a personal access token (classic)
  with the `project` scope, stored as a repo secret. The docs' GitHub App
  example is for organization projects.
- Checked on the server on 2026-10-12: the `gh` CLI is logged in as
  `danschultz` with the scopes `admin:public_key`, `gist`, `read:org`, and
  `repo`. `gh project view 3 --owner danschultz` fails with "missing
  required scopes [read:project]". So the board's current fields and
  columns couldn't be read for this research, and anything that writes to
  the board from the server first needs `gh auth refresh -s project`.

## Options

### A. Built-in workflows only

Turn on auto-add with `is:issue label:agent:queued`, and keep "Item closed"
and "Pull request merged" setting Done.

Benefits:

- No code and no new credentials.

Costs:

- Briefs only ever show as Todo or Done. Needs input and In review, the two
  states Dan most needs to see, never appear.

### B. A GitHub Actions workflow on label events

A workflow in `.github/workflows/` runs on `issues: [labeled, unlabeled,
closed, reopened]`, maps the issue's `agent:*` label to a Status, and sets
it with `gh project item-add` and `gh project item-edit`, authenticated by
a classic PAT with `project` scope.

Benefits:

- The board updates within seconds of any label change, from any source,
  including Dan changing labels by hand.
- Works when the server is down.

Costs:

- A second long-lived credential for Dan's account, stored in GitHub. A
  classic PAT with `project` scope reaches every project Dan owns, and
  classic PATs can't be limited to one project.
- Label changes made with `GITHUB_TOKEN` don't trigger workflows. That
  doesn't affect today's setup, since `implement` and agent sessions use
  Dan's token, but it would silently break if that changed.
- Missed or failed runs leave the board wrong until the next label change
  on that issue. There's nothing that reconciles.
- The state mapping lives in YAML, apart from the `LABELS` it mirrors in
  `tools/implement/src/config.ts`.

### C. `implement` sets Status when it moves a label

Extend `moveTo` so every label change also sets the board's Status.

Benefits:

- Immediate for changes `implement` and its hook make.
- Uses the server's existing `gh` login.

Costs:

- Misses changes made outside `moveTo`: the agent session setting
  `agent:review`, Dan queuing a brief, and issues closing. Prompts would
  have to tell agent sessions to update the board too, which is fragile.
- A failed board update has no retry.

### D. `implement` reconciles the board on every tick

Add a step to each tick that reads the briefs and the board, works out the
Status each brief should have from its labels and whether it's closed, and
fixes any item that differs. The built-in workflows still move closed items
to Done as a backstop.

Benefits:

- Catches every change regardless of who made it, because it compares
  end states instead of watching events.
- Repairs itself: a failed or missed update is fixed on the next tick, and
  so is a card Dan drags to the wrong column.
- Uses the server's existing `gh` login, so no secret is stored in GitHub.
- The mapping lives next to `LABELS`, and can be unit tested with the fake
  `GitHub` that `tick.test.ts` already uses.

Costs:

- Up to 2 minutes of delay, the same as briefs being picked up today.
- The board stops updating while the server is down. Nothing else moves
  briefs while it's down either, except Dan queuing or closing them.
- A few more `gh` calls per tick: one to list open issues with `agent:*`
  labels, one to list the board's items, and one per item that changed.
- Reconciling overwrites manual Status changes on briefs, so the board is
  for viewing, not for changing a brief's state.

## Proposal

Use option D, plus the built-in workflows for Done. Later, if 2 minutes is
too slow for Needs input, also call the sync from `moveTo` (option C), so
`implement`'s own changes show at once and the tick still catches the rest.

### Mapping

| Brief | Status |
| ----- | ------ |
| Open, `agent:queued` | Queued |
| Open, `agent:working` | Working |
| Open, `agent:needs-input` | Needs input |
| Open, `agent:review` | In review |
| Open, `agent:failed` | Failed |
| Closed | Done |

Failed gets its own column rather than sharing Needs input, because it
means the agent session has exited and Dan must re-queue or close the
brief, not answer a question. Open issues with no `agent:*` label, such as
drafts, are left alone.

### Implementation

1. **One-time setup, by Dan.**
   - Run `gh auth refresh -s project` on the server.
   - Give the board's Status field the options Queued, Working, Needs
     input, In review, Failed, and Done, and use Status as the board's
     column field.
   - Keep the "Item closed" and "Pull request merged" workflows on. Turn
     off "Item added to project", so it doesn't race the sync by setting a
     default Status.
2. **Configuration.** Add `IMPLEMENT_PROJECT`, such as `danschultz/3`, to
   `Config`. When it's unset, the sync step is skipped, so the board stays
   optional.
3. **GitHub access.** Add to the `GitHub` interface in
   `tools/implement/src/github.ts`:
   - `projectFields()`, from `gh project field-list --format json`, to look
     up the Status field and its option IDs by name. A missing option is
     logged once per tick, naming it, and the briefs that need it are
     skipped.
   - `projectItems()`, from `gh project item-list --format json` with a
     high `--limit`, giving each item's id, issue number, and Status.
   - `addProjectItem(issueUrl)`, from `gh project item-add`.
   - `setProjectStatus(itemId, optionId)`, from `gh project item-edit`.
4. **Sync step.** Add `syncBoard(deps)` in `tools/implement/src/board.ts`,
   called at the end of `tick` after `startQueued`, so it sees the labels
   that tick set. It:
   - Lists open issues in the repo with any `agent:*` label, and the
     board's items.
   - Adds a brief that isn't on the board, then sets its Status.
   - Sets the Status of each brief whose Status differs from the mapping.
   - Leaves closed issues to the built-in workflows, and items from other
     repos alone.
   - Runs inside `guard`, so a board failure is logged and never stops
     briefs from being started, resumed, or reaped.
5. **Tests.** Extend the fake `GitHub` in `tools/implement/test/` with an
   in-memory board, and test the mapping, adding missing briefs, skipping
   unchanged items, leaving other items alone, and handling a missing
   option.
6. **Docs.** Update `tools/implement/README.md` with the setup steps, and
   record a decision amending 0014 once the approach is accepted.

## Open questions

- **Column names.** Are Queued, Working, Needs input, In review, Failed,
  and Done the columns Dan wants? The board's current columns couldn't be
  read without the `read:project` scope.
- **Working and Failed.** Should Working and Failed be their own columns,
  or should Working stay in Queued and Failed show as Needs input?
- **Scope of the token.** Is Dan comfortable giving the server's `gh`
  login the `project` scope, which allows writing to every project Dan
  owns?
- **Other repos.** If `implement` takes briefs from more repos, as 0014's
  follow-up choices consider, should they share this board?
