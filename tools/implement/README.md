# implement

Starts a headless [agent session](../../docs/glossary.md#agent-session) for each
brief written as a task in Aven, Dan's local task manager, and brings the work
back as a pull request on GitHub. The design is in
[decision 0014](../../docs/decisions/0014-implement-briefs-headlessly.md) and
[decision 0031](../../docs/decisions/0031-briefs-are-aven-tasks.md).

## How it works

A brief is a task in the Aven project `agent-diff`. Its description is the
brief, put in the start prompt as written, and no headings are required. How to
write one is in [`.rules/briefs.md`](../../.rules/briefs.md).

A brief's state is the task's `agent` metadata: `queued`, `working`,
`needs-input`, `review`, or `failed`. Dan queues a brief by setting
`agent=queued` on an open task, such as with
`aven edit <ref> --metadata agent=queued`. Notes on the task hold everything
`implement` reports: the pull request's URL, the end of the log when an agent
session fails, an error on start, and the question when an agent session needs
input.

Nothing on GitHub identifies the task. Branches are named
`brief/<slug>-<suffix>`, from the task's title and a short random suffix, and
the pull request has no "Closes" line. The agent session is told to keep the
task's ref out of branch names, commits, and pull requests.

A systemd user timer runs `implement tick` every 2 minutes. Each tick:

1. **Reaps.** For each brief it started, it reads the task, the pull request for
   the brief's branch, and `claude agents --json`:
   - The first time it sees the pull request, it adds a note with its URL to the
     task.
   - It **lets the brief go** when the pull request is merged or closed without
     merging, or when Dan sets the task to `done` or `canceled` or removes its
     `agent` metadata. Letting go stops the agent session if it's running,
     removes the worktree with `git worktree remove --force`, deletes the local
     branch, removes the `agent` metadata, and stops tracking the brief. A
     merged pull request also sets the task to `done`, and that's the only thing
     that does. A closed pull request leaves the task `active`. If Dan has
     already queued the brief again, `agent=queued` is kept, and it starts over.
   - Agent session exited without a pull request: sets `agent=failed` and adds a
     note with the end of its output. The worktree is kept until the brief is
     let go or queued again.
   - Agent session exited while working, after opening a pull request: sets
     `agent=review` and adds a note saying so.
   - Brief in `agent=review` and its agent session no longer working: stops the
     agent session with `claude stop <id>`. The conversation is kept.
2. **Resumes** a stopped agent session when Dan submits a new review on its pull
   request, with `claude --bg --resume <session-id> "<prompt>"`, and sets
   `agent=working`.
3. **Starts** queued briefs, up to the concurrency limit, oldest first. They're
   the open tasks in the project with `agent=queued`, from
   `aven list --project agent-diff --open --metadata agent=queued`, so tasks in
   other projects and `done` or `canceled` tasks are ignored. For each one,
   `implement` sets the task's status to `active` and `agent=working`, creates
   the worktree `.claude/worktrees/brief-<slug>-<suffix>` on the branch
   `brief/<slug>-<suffix>` from `origin/main`, then runs:

   ```sh
   claude --bg --remote-control brief-<slug>-<suffix> --name brief-<slug>-<suffix> \
     --permission-mode auto --settings <state>/settings.json "<prompt>"
   ```

   The task stays `active` until the brief is let go. A brief queued again after
   failing starts over from a fresh worktree.

4. **Prunes** worktrees deleted by hand, with `git worktree prune`.

`implement` doesn't pass `--model` or `--effort`. The model and effort come from
the project's [`.claude/settings.json`](../../.claude/settings.json), which
applies to every agent session in the repo
([decision 0028](../../docs/decisions/0028-the-project-defines-how-agent-sessions-work.md)).
`implement` adds only what running unattended needs: the brief's state in Aven,
the hooks, Remote Control, auto permission mode, and the prompt.

### What the agent session does

The prompts are in [`src/prompts.ts`](src/prompts.ts). They give the task's ref,
and say to read the brief with `aven context <ref>` and to change the task only
as the prompt says. A new agent session reads the brief's Context and the files
the change touches before editing, writes a short plan for a brief with more
than one step, and keeps the diff to the brief. When it's done
([decision 0030](../../docs/decisions/0030-self-review-before-the-pull-request-opens.md)):

1. It checks the acceptance criteria and runs the verification steps.
2. **Self-review.** Before pushing, it starts the `self-review`
   [sub-agent](../../docs/glossary.md#sub-agent), defined in
   [`.claude/agents/self-review.md`](../../.claude/agents/self-review.md), and
   gives it only the task's ref and the diff range against
   `origin/<base branch>`. The sub-agent reads the brief with `aven context`,
   runs no `aven` commands other than `aven context` and `aven show`, can't edit
   files, and returns findings. The agent session fixes the ones it agrees with,
   test-first, and reruns the verification steps. After substantial fixes, a
   second, new `self-review` sub-agent checks them, for at most 2 rounds.
3. It pushes and opens a draft pull request, with no "Closes" line, and a
   "Self-review" section listing every finding as fixed, declined with the
   reason, or still open.
4. **Waits for CI** with `gh pr checks <number> --watch`, fixing failures and
   pushing again, and moves the brief to review with
   `aven edit <ref> --metadata agent=review` only once the checks pass. If it
   can't make them pass, it asks Dan.

A resumed agent session addresses the pull request review, pushes, and waits for
CI the same way before moving the brief back to `agent=review`. It doesn't
self-review.

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
  permission, sets `agent=needs-input` and adds the agent session's last message
  to the task as a note, with how to answer. It does nothing when the brief is
  already in `agent=needs-input`, in `agent=review` (the agent session is idle
  because it's done), or being let go.
- **UserPromptSubmit:** when Dan answers, moves the brief from
  `agent=needs-input` back to `agent=working`. A tick does the same when it sees
  the agent session working again.

The hooks are told which `aven` to run through the settings file. Agent sessions
and their hooks keep `AVEN_DB` from `implement`'s environment, so they all use
the same Aven database.

The prompt also tells the agent session to send Dan a push notification when it
stops to ask.

## Setup

On the server, in the main checkout of this repo:

```sh
cd tools/implement
node src/main.ts setup     # checks the GitHub repo's settings
node src/main.ts install   # writes and starts implement.service and implement.timer
loginctl enable-linger "$USER"
```

Needs Node 24 or later, git, the `gh` CLI logged in with repo scope (git uses
its credentials too), Claude Code logged in with Dan's claude.ai account (Remote
Control doesn't work with an API key), and `aven` with the project `agent-diff`
in its default database. `setup` warns if the repo doesn't delete head branches
after merge; turn that on with `gh repo edit --delete-branch-on-merge`.

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
| `IMPLEMENT_AUTHOR`        | The `gh` user. Only this user's pull request reviews are handed on.  |
| `IMPLEMENT_WORKTREES_DIR` | `<repo dir>/.claude/worktrees`. Must be a folder Claude Code trusts. |
| `IMPLEMENT_STATE_DIR`     | `~/.local/state/implement`                                           |
| `IMPLEMENT_BASE_BRANCH`   | `main`                                                               |
| `IMPLEMENT_CONCURRENCY`   | `2`                                                                  |
| `IMPLEMENT_CLAUDE`        | `~/.local/bin/claude`                                                |
| `IMPLEMENT_AVEN`          | `~/.local/bin/aven`                                                  |
| `IMPLEMENT_AVEN_PROJECT`  | `agent-diff`. Passed to `aven list` explicitly, never inferred.      |

## Commands

```sh
node src/main.ts tick [--dry-run]   # one tick; --dry-run only logs what it would change
node src/main.ts status             # tracked briefs, their state in Aven, and their agent sessions
npm test
npm run typecheck
```

`aven` runs against its default database. Set `AVEN_DB` to try `implement`
against a scratch database instead, such as one made with
`aven --db <temp file> project create agent-diff`.

State lives in `<state dir>/state.json`. For each brief it started, keyed by the
task's ID, it holds the task's ref when last seen, the branch, worktree, agent
session name and id, which reviews have been handed over, and the pull request's
URL once it's been noted on the task. The task holds everything else:

```json
{
  "briefs": {
    "5M82H2Q7HAF8PAXJ": {
      "taskId": "5M82H2Q7HAF8PAXJ",
      "ref": "AD-5M82",
      "repo": "danschultz/agent-diff",
      "title": "Take briefs from Aven instead of GitHub issues",
      "branch": "brief/take-briefs-from-aven-instead-of-github-3f9a2c",
      "worktree": "/home/dan/agent-diff/.claude/worktrees/brief-take-briefs-from-aven-instead-of-github-3f9a2c",
      "sessionName": "brief-take-briefs-from-aven-instead-of-github-3f9a2c",
      "sessionId": "0b7c2f1e-6a4d-4c8e-9f3a-2d5e8b1c7a90",
      "launchedAt": 1792468800000,
      "handledReviewIds": ["PRR_kwDOexample"],
      "pullRequestUrl": "https://github.com/danschultz/agent-diff/pull/44"
    }
  }
}
```

## Migrating briefs from GitHub issues

Before [decision 0031](../../docs/decisions/0031-briefs-are-aven-tasks.md),
briefs were GitHub issues, and `state.json` keyed them by issue number, such as
`"26"`. `implement` doesn't read those entries, so each brief still being
tracked is moved to Aven by hand once, when the change is deployed. Its agent
session keeps its conversation, so the next pull request review resumes it.

1. Stop the timer, wait until `systemctl --user is-active implement.service` no
   longer says `active`, so no tick is running, and pull `main` in the main
   checkout. Keep a copy of `state.json`:

   ```sh
   systemctl --user stop implement.timer
   git -C <repo dir> pull
   cp ~/.local/state/implement/state.json ~/.local/state/implement/state.json.bak
   ```

2. For each entry in `state.json` whose pull request is still open, create a
   task in `agent-diff` with the issue's title and body, status `active`, and
   `agent=review`, and add a note with the issue and pull request URLs. Then
   read the task's ID from `aven show --json`:

   ```sh
   n=26
   gh issue view "$n" --json body -q .body |
     aven add "$(gh issue view "$n" --json title -q .title)" --project agent-diff \
       --status active --metadata agent=review --description-stdin
   # aven add prints the task's ref, such as AD-5M82.
   aven note AD-5M82 "Migrated from <issue URL>. Pull request: <pull request URL>"
   aven show AD-5M82 --json   # its "id", such as 5M82H2Q7HAF8PAXJ
   ```

   A brief whose pull request is merged or closed doesn't need a task. Remove
   its worktree and local branch by hand, and leave it out of `state.json`.

3. Re-key its `state.json` entry from the issue number to the task's ID, in the
   format above. Keep `repo`, `title`, `branch`, `worktree`, `sessionName`,
   `sessionId`, `launchedAt`, and `handledReviewIds` as they are. Replace
   `"issue"` with `"taskId"` and `"ref"`, and add `"pullRequestUrl"`, since step
   2 already noted it on the task. This entry:

   ```text
   "26": {
     "issue": 26,
     "repo": "danschultz/agent-diff",
     "branch": "brief/26-<slug>",
     ...
   }
   ```

   becomes:

   ```text
   "5M82H2Q7HAF8PAXJ": {
     "taskId": "5M82H2Q7HAF8PAXJ",
     "ref": "AD-5M82",
     "repo": "danschultz/agent-diff",
     "branch": "brief/26-<slug>",
     ...
     "pullRequestUrl": "<pull request URL>"
   }
   ```

4. Remove the `agent:*` labels from the issue:

   ```sh
   gh issue edit "$n" --remove-label agent:review
   ```

5. Check that `node tools/implement/src/main.ts status`, run from the main
   checkout, lists each brief with `active, agent=review`, then start the timer:

   ```sh
   systemctl --user start implement.timer
   ```

Migrated briefs keep their branch names, `brief/N-<slug>`, and their pull
requests' "Closes #N", so merging still closes the issue, and `implement` sets
the task to `done`. The `agent:*` labels are no longer used, and can be deleted
from GitHub once no issue has them.
