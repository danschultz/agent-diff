# Writing briefs

A brief is a task for an [agent session](../docs/glossary.md#agent-session) that
`implement` starts unattended. Briefs are tasks in the Aven project
`agent-diff`, and the task's description is the brief, given to the agent
session as written. See [0031](../docs/decisions/0034-briefs-are-aven-tasks.md)
and [`tools/implement/README.md`](../tools/implement/README.md).

## Writing a brief

To write a brief, use the
[`/create-brief`](../.claude/skills/create-brief/SKILL.md) skill, which holds
the steps and a template for each kind of brief. To choose what to work on next,
or plan a feature into briefs, use
[`/plan-work`](../.claude/skills/plan-work/SKILL.md). See
[0039](../docs/decisions/0039-work-is-planned-into-briefs.md).

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
