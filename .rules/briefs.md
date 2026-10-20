# Writing briefs

A brief is a task for an [agent session](../docs/glossary.md#agent-session) that
`implement` starts unattended. Briefs are tasks in the Aven project
`agent-diff`, and the task's description is the brief, given to the agent
session as written. See [0031](../docs/decisions/0031-briefs-are-aven-tasks.md)
and [`tools/implement/README.md`](../tools/implement/README.md).

## Headings

None of these is required. Use the ones the brief needs, as `###` headings, in
this order:

| Heading             | What it's for                                                                    |
| ------------------- | -------------------------------------------------------------------------------- |
| Goal                | The outcome to deliver.                                                          |
| Out of scope        | A hard boundary. Needing to cross it is a reason to escalate.                    |
| Context             | Background, links, and files to read first.                                      |
| Acceptance criteria | Each one is checked and reported as met or not met in the pull request.          |
| Verification        | Steps the agent session runs. Their results are reported in the pull request.    |
| Escalation criteria | Situations where the agent session stops and asks Dan instead of deciding alone. |
| Notes               | Anything else.                                                                   |

## Creating a brief

Create the task in `agent-diff`, passing the project explicitly, with the
description on standard input:

```sh
aven add "Add a --version flag" --project agent-diff --description-stdin <<'BRIEF'
### Goal

`agent-diff --version` prints the version.
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
