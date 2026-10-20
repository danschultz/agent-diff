# 0014: Briefs on GitHub are implemented by headless agent sessions

- Status: Accepted, amended by
  [0015](0015-closing-a-brief-clears-its-labels.md),
  [0030](0030-self-review-before-the-pull-request-opens.md), and
  [0031](0031-briefs-are-aven-tasks.md)
- Date: 2026-10-12

> Amended by [0015](0015-closing-a-brief-clears-its-labels.md): a GitHub Actions
> workflow removes a brief's `agent:*` labels when its issue is closed, and
> closing a pull request without merging leaves its issue open.
>
> Amended by [0030](0030-self-review-before-the-pull-request-opens.md): before
> pushing, the agent session has a `self-review` sub-agent review its diff,
> fixes the findings it agrees with, and lists every finding in the pull
> request. After pushing, when started or resumed, it waits for CI to pass
> before moving the brief to `agent:review`.
>
> Amended by [0031](0031-briefs-are-aven-tasks.md): briefs are tasks in the Aven
> project `agent-diff` instead of GitHub issues, with the same required fields,
> checked when a brief is queued, and no author check. Their state is the task's
> `agent` metadata instead of labels, and `implement` adds notes to the task
> instead of commenting on an issue. Branches are `brief/<slug>-<suffix>`, with
> a random suffix, and pull requests have no "Closes" line, so nothing on GitHub
> identifies the task. A brief is let go when its pull request is merged, which
> sets the task to `done`, or closed, or when Dan sets the task to `done` or
> `canceled` or removes its `agent` metadata. Pull requests, pull request
> reviews, and CI stay on GitHub.

## Problem

Dan wants to delegate well-defined tasks on this repo without supervising a
terminal. The idea is to write up the work on GitHub and have agent sessions do
it unattended on a headless server, each in its own git worktree, with the
output coming back to GitHub as a pull request.

Agent sessions running unattended still get blocked: they hit a question only
Dan can answer, or an action that needs Dan's approval. Dan needs to know when
that happens and be able to answer from a phone or laptop.

## Solution

- **Briefs are GitHub issues.** Dan writes a brief from the issue template
  `.github/ISSUE_TEMPLATE/brief.yml`, which has these fields:

  | Field               | Required | How the agent session uses it                                                    |
  | ------------------- | -------- | -------------------------------------------------------------------------------- |
  | Goal                | Yes      | The outcome to deliver.                                                          |
  | Out of scope        | No       | A hard boundary. Needing to cross it is a reason to escalate.                    |
  | Context             | No       | Background, links, and files to read first.                                      |
  | Acceptance criteria | Yes      | Checked one by one, and each is reported as met or not met in the pull request.  |
  | Verification        | Yes      | Steps the agent session runs, with their results reported in the pull request.   |
  | Escalation criteria | No       | Situations where the agent session stops and asks Dan instead of deciding alone. |
  | Notes               | No       | Anything else.                                                                   |

  A queued brief that's missing a required field is sent back with a comment
  listing what's missing.

- **Labels hold the state.** A brief moves through the labels `agent:queued`,
  `agent:working`, `agent:needs-input`, `agent:review`, and `agent:failed`. Dan
  queues a brief by adding `agent:queued`, so drafts are never picked up. Only
  briefs written by Dan are accepted.
- **`implement` runs on a headless server.** `implement` is a tool in this repo
  under `tools/implement/`, written in Node 24 TypeScript and using the `gh`
  CLI. A systemd user timer runs one tick every 2 minutes, with a concurrency
  limit (2 by default). Each tick:
  - **Starts** queued briefs. For each one, it creates a git worktree on a
    branch named `brief/N-<slug>` from `origin/main`, in a folder Claude Code
    already trusts. An agent session can't start in a folder that isn't trusted,
    and no one is there to accept the trust prompt. Then it starts a new agent
    session with `claude --bg --remote-control`, auto permission mode, and hooks
    loaded from `tools/implement/settings.json`.
  - **Resumes** a brief's agent session in the same worktree when its pull
    request gets a "changes requested" pull request review, by running
    `claude --bg --resume <session-id> "<prompt>"` with no other options. The
    agent session keeps the options it was started with, including Remote
    Control. Passing any other option starts a copy with a new id instead. The
    agent session addresses the comments, reruns the verification, and pushes.
  - **Reaps** agent sessions that have exited. If a brief still has no pull
    request, it's marked `agent:failed`, with the end of the agent session's log
    as a comment. If a brief is in `agent:review`, its agent session is stopped,
    and the conversation is kept so it can be resumed later. When a brief's pull
    request is merged or closed, or a brief in `agent:failed` has its issue
    closed, its worktree is removed with `git worktree remove` and its local
    branch is deleted.
  - **Prunes** worktrees that were deleted by hand, by running
    `git worktree prune` so git forgets them.
- **Each brief gets a new agent session.** The agent session reads `AGENTS.md`
  and treats the brief as an agreed task. It commits, pushes the branch, and
  opens a draft pull request containing:
  - "Closes #N".
  - The acceptance criteria as a checklist.
  - The verification results.

  Then it moves the brief to `agent:review`.

- **Agent sessions escalate instead of guessing.** An agent session stops and
  asks Dan when any of these is true:
  - An escalation criterion applies.
  - The work would cross the out of scope boundary.
  - The acceptance criteria can't all be met.
  - Auto mode won't allow an action.
- **Dan is alerted, then steps in through Remote Control.** When an agent
  session is waiting for Dan, Dan is alerted two ways:
  - A `Notification` hook sets `agent:needs-input` and comments the question on
    the issue. The hook applies only to agent sessions started by `implement`,
    not to Dan's own.
  - The agent session sends a push notification through the Claude app.

  Dan answers in the Claude app, on claude.ai/code, or over SSH with
  `claude attach`.

  This was tested on Claude Code 2.1.287. A background agent session with Remote
  Control received a message from Dan's phone and replied, and Dan got a push
  notification. After being stopped and resumed, the agent session reconnected
  to the same Remote Control session.

- **GitHub deletes merged branches.** The repo has "Automatically delete head
  branches" turned on, so `implement` never deletes remote branches.
- **`implement` runs `claude` directly, with a clean environment.** Wrappers
  such as cmux's `claude` shim add their own options, which makes resuming start
  a copy.
- **The server is authenticated as Dan.** Claude Code is logged in with Dan's
  claude.ai account, because Remote Control needs account auth rather than an
  API key. The `gh` CLI has repo scope.

## Tradeoffs

Benefits:

- Delegating is fully asynchronous. Dan writes a brief and comes back to a pull
  request.
- Tools Dan already uses, GitHub and the Claude app, are the whole interface, on
  both phone and laptop.
- Each brief's work is isolated in its own worktree and branch.
- A resumed agent session keeps its context across pull request reviews.
- `implement` polls GitHub, so the server needs no public ingress.
- Worktrees are kept while they're useful: for resuming while a pull request is
  open, and for inspecting a failure until Dan closes the issue.
- The required brief fields make every pull request report what was checked and
  how it was verified.

Costs:

- Polling adds up to 2 minutes before a brief or pull request review is picked
  up.
- The server holds Dan's GitHub and Claude credentials.
- Auto mode relies on a classifier to decide which actions need approval.
- An agent session waiting for input still uses a concurrency slot.
- It depends on Claude Code features, such as background sessions and Remote
  Control, that may change.
- Pull request reviews happen on GitHub, not in agent-diff's review UI.
- Removing a worktree ends any chance of resuming its agent session.
- GitHub deletes branches only when a pull request is merged, so branches of
  pull requests closed without merging stay until deleted by hand.

## Follow-up design choices

- **Trusting worktrees.** Whether trusting the folder that holds the worktrees
  also trusts each worktree inside it, or each one has to be trusted.
- **Approving actions remotely.** Whether an action auto mode won't allow
  reaches Dan's phone as a request Dan can approve, or only as a question.
- **Reviewing in agent-diff.** Whether pull request reviews should eventually
  move into agent-diff's review UI, so the tool reviews its own work.
- **More repos.** Whether `implement` should take briefs from repos other than
  agent-diff.
- **More alerts.** Whether alerts should also go to Slack.
- **Server OS.** The server's OS isn't decided yet. This decision assumes Linux
  with systemd, and macOS would use launchd instead.
