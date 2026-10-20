# 0031: Briefs are Aven tasks, and only pull requests stay on GitHub

- Status: Accepted
- Date: 2026-10-20

## Problem

`implement` took briefs from GitHub issues, held their state in `agent:*`
labels, and reported on the issue with comments
([0014](0014-implement-briefs-headlessly.md)). A workflow cleared the labels
when an issue closed ([0015](0015-closing-a-brief-clears-its-labels.md)). Dan
tracks work in Aven, a local task manager, so briefs lived in a second place,
and writing a brief meant filling in a GitHub issue form with required fields.

What needed deciding was where briefs and their state live, what stays on
GitHub, how `implement` knows a brief is finished when there's no issue to
close, and how the briefs already on GitHub move over.

## Solution

- **A brief is a task in the Aven project `agent-diff`.** Its description is put
  in the start prompt as written. A new rule,
  [`.rules/briefs.md`](../../.rules/briefs.md), gives the headings, taken from
  the old issue template, with the same required fields: Goal, Acceptance
  criteria, and Verification. It says agent sessions create briefs with
  `aven add --project agent-diff --description-stdin`. A queued brief that's
  missing a required field, or has it empty, isn't started: `implement` removes
  `agent=queued` and adds a note listing what's missing. `implement` no longer
  checks who wrote the brief, since only Dan's database holds briefs.
- **State is the task's `agent` metadata**: `queued`, `working`, `needs-input`,
  `review`, or `failed`, changed at the same points the labels were. Dan queues
  a brief by setting `agent=queued` on an open task, and agent sessions set it
  only when Dan asks. When `implement` starts a brief, it sets the task's status
  to `active`, and it stays `active` until the brief is let go.
- **Notes replace comments.** Everything `implement` and its hooks commented on
  an issue becomes an `aven note` on the task: the end of the log when an agent
  session fails, an agent session that exited after opening a pull request, an
  error on start, and the question when an agent session needs input. When
  `implement` first sees a brief's pull request, it adds a note with the pull
  request's URL. Nothing is written to GitHub issues.
- **Pull requests, pull request reviews, and CI stay on GitHub**, and resuming
  an agent session on a pull request review works as before. `IMPLEMENT_AUTHOR`
  still decides whose reviews count.
- **Aven refs stay off GitHub.** A ref identifies Dan's local task, so it never
  appears in a branch name, commit, pull request title, or pull request body.
  Branches are `brief/<slug>-<suffix>`, where the slug comes from the task's
  title and the suffix is a random verb-noun pair, such as `chase-otter`, that's
  easy to remember and not derived from the task. The worktree and agent session
  name follow the branch. The pull request has no "Closes" line, and the prompts
  tell the agent session to keep the ref and the task's ID out of branch names,
  commits, and pull requests.
- **The task's ID is the identity.** `state.json` is keyed by the stable ID from
  `aven --json` output, not by the ref, since a ref's project prefix changes
  when the task moves project. The ref is kept only for prompts, logs, and
  `status`, and refreshed each tick.
- **Letting a brief go.** `implement` stops the agent session, removes the
  worktree, deletes the local branch, removes the `agent` metadata, and stops
  tracking the brief when any of these happens:
  - The pull request is merged. The task is also set to `done`, and this is the
    only case that sets `done`.
  - The pull request is closed without merging. The task stays `active`.
  - Dan sets the task to `done` or `canceled`.
  - Dan removes the `agent` metadata.

  A failed brief's worktree is kept until one of those happens, or until the
  brief is queued again, which starts over from a fresh worktree. If Dan has
  already queued the brief again when it's let go, `agent=queued` is kept, so it
  starts over.

- **Agent sessions use `aven`.** The prompts give the task's ref, and say to
  read the brief with `aven context <ref>` and to move it to review with
  `aven edit <ref> --metadata agent=review`. The `self-review` sub-agent
  ([0030](0030-self-review-before-the-pull-request-opens.md)) is given the ref
  instead of an issue number, reads the brief with `aven context`, and runs no
  `aven` commands other than `aven context` and `aven show`.
- **Configuration.** `IMPLEMENT_AVEN` sets the `aven` binary,
  `~/.local/bin/aven` by default, like `IMPLEMENT_CLAUDE`.
  `IMPLEMENT_AVEN_PROJECT` sets the project, `agent-diff` by default, and
  `implement` passes it to `aven list` rather than relying on Aven inferring it
  from the current directory. Tasks are read and changed by ID, which `aven`
  accepts as a ref.
- **What's removed.** The GitHub issue functions in `tools/implement`, the
  `setup` command's labels, the `clear-labels` command, the issue template
  `.github/ISSUE_TEMPLATE/brief.yml`, and the workflow
  `.github/workflows/clear-agent-labels.yml`, which replaces
  [0015](0015-closing-a-brief-clears-its-labels.md).
- **The briefs on GitHub are migrated by hand** at deploy time, following the
  steps in [`tools/implement/README.md`](../../tools/implement/README.md). Each
  one with an open pull request becomes an `active` task with `agent=review`,
  and its `state.json` entry is re-keyed to the task's ID, keeping its agent
  session so the next review resumes it. `implement` doesn't read entries keyed
  by issue number. Migrated briefs keep their branch names and their pull
  requests' "Closes #N", so merging still closes the issue.

`aven list --json` has no metadata or description, so `implement` lists queued
tasks with `--metadata agent=queued`, then reads each with
`aven show <id> --full --json`. Each tracked brief is read the same way, as
issues were read one at a time before. This was checked on aven 0.1.50. Tests
run the real `aven` against a scratch database when it's installed, and are
skipped otherwise, as in CI, where captured output and a fake `aven` cover it.

## Tradeoffs

Benefits:

- Briefs live with the rest of Dan's work, and Dan can write, queue, and follow
  them in Aven, including from the Aven TUI.
- Nothing about Dan's local tasks reaches GitHub.
- Letting a brief go is decided in one place, on each tick, so no GitHub Actions
  workflow is needed, and closing a pull request without merging no longer
  leaves a brief in a stale state.
- `state.json` survives a task moving project.

Costs:

- Dan isn't alerted on GitHub any more. Until a notification is designed, Dan
  sees changes by looking at Aven, apart from the agent session's push
  notification when it asks.
- Aven isn't synced here, so briefs can only be written and queued on the server
  that runs `implement`.
- Required fields are only checked when a brief is queued, not when it's
  written, since Aven has no form to enforce them.
- Pull requests no longer link back to their brief, so the link only exists in
  the task's notes.
- Letting a brief go now depends on `implement` running. While it's stopped, a
  merged brief's task stays `active`.
- `implement` depends on `aven`'s `--json` output, which may change.

## Follow-up design choices

- **Notifications.** How Dan is told a brief needs input, failed, or is ready
  for review, such as an attention label in Aven.
- **Sync.** Whether briefs can be written and queued from another machine
  through Aven sync.
- **State in Aven.** Whether `state.json` should move into the task's metadata.
- **Aven TUI commands.** Whether queuing, re-queuing, and letting go of a brief
  should be custom commands in the Aven TUI.
