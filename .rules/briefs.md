# Writing briefs

A brief is a task for an [agent session](../docs/glossary.md#agent-session) that
`implement` starts unattended. Briefs are tasks in the Aven project
`agent-diff`, and the task's description is the brief, given to the agent
session as written. See [0031](../docs/decisions/0034-briefs-are-aven-tasks.md)
and [`tools/implement/README.md`](../tools/implement/README.md).

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
