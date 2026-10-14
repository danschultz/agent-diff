# implement

Starts a headless [agent session](../../docs/glossary.md#agent-session) for each
brief written as a GitHub issue, and brings the work back as a pull request. The
design is in
[decision 0014](../../docs/decisions/0014-implement-briefs-headlessly.md).

## How it works

Dan writes a brief from the issue template
[`.github/ISSUE_TEMPLATE/brief.yml`](../../.github/ISSUE_TEMPLATE/brief.yml) and
adds the `agent:queued` label. A systemd user timer runs `implement tick` every
2 minutes. Each tick:

1. **Reaps.** For each brief it started, it checks the issue, the pull request
   for the brief's branch, and `claude agents --json`:
   - Pull request merged or closed, or issue closed without a pull request:
     stops the agent session if it's running, removes the worktree with
     `git worktree remove --force`, and deletes the local branch.
   - Agent session exited without a pull request: moves the brief to
     `agent:failed` and comments the end of its output. The worktree is kept
     until the issue is closed.
   - Brief in `agent:review` and its agent session no longer working: stops the
     agent session with `claude stop <id>`. The conversation is kept.
2. **Resumes** a stopped agent session when Dan submits a new review on its pull
   request, with `claude --bg --resume <session-id> "<prompt>"`, and moves the
   brief back to `agent:working`.
3. **Starts** queued briefs, up to the concurrency limit. A brief not written by
   Dan, or missing a required field, has `agent:queued` removed and gets a
   comment saying why. Otherwise `implement` creates the worktree
   `.claude/worktrees/brief-N-<slug>` on the branch `brief/N-<slug>` from
   `origin/main`, then runs:

   ```sh
   claude --bg --remote-control brief-N-<slug> --name brief-N-<slug> \
     --permission-mode auto --settings <state>/settings.json "<prompt>"
   ```

4. **Prunes** worktrees deleted by hand, with `git worktree prune`.

`implement` doesn't clear labels when it finishes with a brief. The workflow
[`clear-agent-labels.yml`](../../.github/workflows/clear-agent-labels.yml) runs
`implement clear-labels <issue>` when an issue is closed, whether by a merged
pull request or by hand. That removes every `agent:*` label from the issue and
leaves other labels alone. It needs only `gh` and the repo, so it runs in the
workflow with `IMPLEMENT_REPO` set and `GH_TOKEN` from the workflow's token. A
pull request closed without merging leaves its issue open with its labels, until
Dan closes the issue or queues it again
([decision 0015](../../docs/decisions/0015-closing-a-brief-clears-its-labels.md)).

`claude` runs from `~/.local/bin/claude` with a clean environment, so wrappers
and variables from whatever ran `implement` don't change its options.

`claude --bg` hands each agent session to a shared Claude Code daemon, and
starts the daemon if it isn't running. `implement` runs `claude --bg` in its own
systemd scope (`implement-claude-<id>.scope`, from
`systemd-run --user --scope`). Otherwise the daemon would be in
`implement.service`'s cgroup, and systemd would kill it, with every agent
session it hosts, when the tick exits. The scope goes away when the daemon
exits, which it does once no agent sessions are left. If the daemon is already
running, for example because Dan started a background session from a terminal,
new agent sessions join it wherever it runs, and end if it's killed.

`implement` and the agent sessions it starts reach GitHub over HTTPS with `gh`'s
credentials, set through git's environment variables. SSH needs an agent that's
only there while Dan is logged in, and stalls inside an agent session's sandbox.
The repo's own config is unchanged, so Dan's own sessions keep using SSH.

Every command `implement` runs times out after 5 minutes, and git never prompts,
so a stuck fetch fails the tick instead of blocking every later one.

### Hooks

The settings file passed to agent sessions is [`settings.json`](settings.json)
with the hook command filled in. It's only passed to agent sessions `implement`
starts, so Dan's own agent sessions never run these hooks.

- **Notification:** when the agent session is waiting for an answer or for
  permission, moves the brief to `agent:needs-input` and comments the agent
  session's last message on the issue, with how to answer. It does nothing when
  the brief is already in `agent:needs-input`, or in `agent:review` (the agent
  session is idle because it's done).
- **UserPromptSubmit:** when Dan answers, moves the brief from
  `agent:needs-input` back to `agent:working`. A tick does the same when it sees
  the agent session working again.

The prompt also tells the agent session to send Dan a push notification when it
stops to ask.

## Setup

On the server, in the main checkout of this repo:

```sh
cd tools/implement
node src/main.ts setup     # creates the agent:* labels
node src/main.ts install   # writes and starts implement.service and implement.timer
loginctl enable-linger "$USER"
```

Needs Node 24 or later, git, the `gh` CLI logged in with repo scope (git uses
its credentials too), and Claude Code logged in with Dan's claude.ai account
(Remote Control doesn't work with an API key). `setup` warns if the repo doesn't
delete head branches after merge; turn that on with
`gh repo edit --delete-branch-on-merge`.

`install` uses the `node` it's run with, and the timer runs this checkout's
code, so pulling `main` updates it. Logs go to
`journalctl --user -u implement.service`.

### Configuration

Set these in the environment when running `install`, and they're written into
the service:

| Variable                  | Default                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `IMPLEMENT_REPO_DIR`      | The main checkout that contains this tool                            |
| `IMPLEMENT_REPO`          | The checkout's GitHub repo                                           |
| `IMPLEMENT_AUTHOR`        | The `gh` user. Only this user's briefs and reviews are accepted.     |
| `IMPLEMENT_WORKTREES_DIR` | `<repo dir>/.claude/worktrees`. Must be a folder Claude Code trusts. |
| `IMPLEMENT_STATE_DIR`     | `~/.local/state/implement`                                           |
| `IMPLEMENT_BASE_BRANCH`   | `main`                                                               |
| `IMPLEMENT_CONCURRENCY`   | `2`                                                                  |
| `IMPLEMENT_CLAUDE`        | `~/.local/bin/claude`                                                |

## Commands

```sh
node src/main.ts tick [--dry-run]   # one tick; --dry-run only logs what it would change
node src/main.ts status             # tracked briefs and their agent sessions
node src/main.ts clear-labels <n>   # remove the agent:* labels from issue n
npm test
npm run typecheck
```

State lives in `<state dir>/state.json`: for each brief it started, the branch,
worktree, agent session name and id, and which reviews have been handed over.
Labels on GitHub hold everything else.
