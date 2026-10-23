# 0020: CLI commands are noun then verb

- Status: Accepted
- Date: 2026-10-15

## Problem

[0011](0011-api-core-with-cli-client.md) and
[0017](0017-crust-builds-the-cli.md) leave the CLI's command set open. Sketches
of it mixed styles: `agent-diff review` fetched a review, while
`agent-diff review progress <id>` used `review` as a group of commands, and
`agent-diff new-session` put the verb first. Mixed styles make names hard to
guess, and make some commands ambiguous. In `agent-diff review progress`,
`progress` could be a command or an argument.

## Solution

Every command is a noun followed by a verb, then its arguments and flags:
`agent-diff <noun> <verb>`. The commands so far:

| Command                                                            | What it does                                                     | Decision                                      |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------- |
| `agent-diff server start`, `stop`, `status`                        | Starts or stops the review server, or says whether it's running. | [0019](0019-cli-does-not-start-the-server.md) |
| `agent-diff session new <working-dir>...`                          | Starts a session and prints its ID.                              | [0018](0018-agents-list-open-comments.md)     |
| `agent-diff session add <session-id> <working-dir>...`             | Adds working directories to a session.                           | [0018](0018-agents-list-open-comments.md)     |
| `agent-diff session show <session-id>`                             | Shows a session, its working directories, and comment counts.    | [0018](0018-agents-list-open-comments.md)     |
| `agent-diff session list`                                          | Lists sessions and their IDs.                                    | [0018](0018-agents-list-open-comments.md)     |
| `agent-diff session archive <session-id>`                          | Archives a session.                                              | [0018](0018-agents-list-open-comments.md)     |
| `agent-diff session delete <session-id> [--yes]`                   | Permanently deletes a session, after confirmation.               | [0018](0018-agents-list-open-comments.md)     |
| `agent-diff comment list <session-id> [--working-directory <dir>]` | Lists a session's open comments, overall comments first.         | [0018](0018-agents-list-open-comments.md)     |
| `agent-diff comment addressed <comment-id>`                        | Marks a comment addressed.                                       | [0018](0018-agents-list-open-comments.md)     |

Crust supports nested commands like these (0017). 0017's code example, with
`startCommand` and `reviewCommand`, comes from research written before this
command set and doesn't follow it.

## Tradeoffs

Benefits:

- Names are predictable. Knowing the nouns, an agent or a human can guess the
  commands.
- Help can group commands by noun.
- A command is never confused with an argument.
- New actions are added as new verbs under an existing noun.

Costs:

- Every command is at least two words, so commands are longer to type.
- Some actions don't fit a noun neatly and need a name chosen for them.
- Some verbs read as states rather than actions, such as `comment addressed`.

## Follow-up design choices

- **Registration.** The command agents and harnesses use to register an agent
  and its parent ([0004](0004-agent-tree-is-an-input.md)), once the open
  question in the README about registration is settled.
- **Turns.** The command agents or harnesses use to report turn boundaries, once
  the open question in the README about turns is settled.
- **Hook commands.** How the `hook` commands in 0017's research example fit the
  noun-then-verb pattern.
