# implement

Starts a headless [agent session](../../docs/glossary.md#agent-session) for each
brief written as a task in Aven, Dan's local task manager, and brings the work
back as a pull request on GitHub. The design is in
[decision 0014](../../docs/decisions/0014-implement-briefs-headlessly.md) and
[decision 0034](../../docs/decisions/0034-briefs-are-aven-tasks.md).

## How it works

A brief is a task in the Aven project `agent-diff`. Its description is the
brief, put in the start prompt as written. It uses the headings in
[`.rules/briefs.md`](../../.rules/briefs.md), the same as the old issue
template's fields, and Goal, Acceptance criteria, and Verification are required.

A brief's state is the task's `agent` metadata: `queued`, `working`,
`needs-input`, `review`, `failed`, or `retry`. Dan queues a brief by setting
`agent=queued` on an open task, such as with
`aven edit <ref> --metadata agent=queued`, and retries a failed one by setting
`agent=retry`
([decision 0042](../../docs/decisions/0042-dan-retries-a-failed-brief-by-resuming-its-agent-session.md)).
Notes on the task hold everything `implement` reports: the pull request's URL,
the end of the log when an agent session fails, an error on start or retry, a
retry, and the question when an agent session needs input.

Nothing on GitHub identifies the task. Branches are named
`brief/<slug>-<suffix>`, from the task's title and a short random hex suffix,
such as `brief/add-a-version-flag-3f9a2c`, and the pull request has no "Closes"
line. The agent session is told to keep the task's ref out of branch names,
commits, and pull requests.

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
   - Agent session exited without a pull request: sets `agent=failed` and adds
     the failure note, and records the note's ID in `state.json` as
     `failureNoteId`. The worktree and the conversation are kept until the brief
     is let go or queued again. The note says:

     ```text
     The agent session exited without opening a pull request. Its worktree `<worktree>` and conversation are kept.

     - To resume the agent session where it stopped, add a note with anything it should know, then set `agent=retry`.
     - To start over from a fresh worktree, set `agent=queued`.

     End of the agent session's output:

     <the end of its output, in a fenced block>
     ```

     A brief in `agent=failed` or `agent=retry` whose agent session is gone is
     left alone.

   - Agent session exited while working, after opening a pull request: sets
     `agent=review` and adds a note saying so.
   - Brief in `agent=review` and its agent session no longer working: stops the
     agent session with `claude stop <id>`. The conversation is kept.
2. **Resumes** a stopped agent session when Dan submits a new review on its pull
   request, with `claude --bg --resume <session-id> "<prompt>"`, and sets
   `agent=working`.
3. **Retries** briefs Dan set to `agent=retry`, each using a concurrency slot,
   after review resumes and before queued briefs start. For each brief it's
   tracking in `agent=retry`:
   - Its agent session is running, or was launched too recently to be listed:
     it's left alone until it exits, and the tick logs
     `<ref>: retry set while its agent session is running; waiting for it to exit`.
   - No free slot: it stays in `agent=retry` for a later tick, and the tick logs
     `<ref>: retry waiting for a free concurrency slot`.
   - No session ID: sets `agent=failed` with the note
     ``Couldn't retry this brief: `implement` has no session ID for its agent session, so it can't resume it. The worktree `<worktree>` is kept. Set `agent=queued` to start over.``
   - Otherwise: sets `agent=working`, runs
     `claude --bg --resume <session-id> "<retry prompt>"`, resets `launchedAt`,
     so the agent session gets the same grace period as a new one, and adds the
     note
     ``Retried: resumed the agent session `<session name>` where it stopped, with <N> note(s) added since it failed.``,
     or "with no notes added since it failed." If the command fails, it sets
     `agent=failed` with the note
     `Couldn't retry this brief: resuming its agent session failed:`, the error
     in a fenced block, and
     ``The worktree `<worktree>` is kept. Set `agent=retry` to try again, or `agent=queued` to start over.``

   Each note that sets `agent=failed`, including the one when an agent session
   can't start, has its ID recorded as `failureNoteId`. A retried brief that
   exits again without a pull request is marked failed again, with a new failure
   note, and can be retried again. `implement` never retries a brief by itself.

   Open tasks in the project with `agent=retry` that `implement` isn't tracking,
   from `aven list --project agent-diff --open --metadata agent=retry`, have the
   `agent` metadata removed and get the note
   ``There's nothing to retry: `implement` has no worktree or agent session for this brief. Set `agent=queued` to start it.``

4. **Starts** queued briefs, up to the concurrency limit, oldest first. They're
   the open tasks in the project with `agent=queued`, from
   `aven list --project agent-diff --open --metadata agent=queued`, so tasks in
   other projects and `done` or `canceled` tasks are ignored. A brief missing a
   required field has `agent=queued` removed and gets a note listing what's
   missing. Then the tasks each brief depends on, its blockers, are checked
   ([decision 0035](../../docs/decisions/0035-queued-briefs-wait-for-their-blockers.md)).
   They're listed in `aven show --full --json` under `dependencies.depends_on`,
   and can be any task, in any project. Only a `done` blocker counts, unlike
   Aven, which counts `canceled` and deleted ones as resolved:
   - A brief with a `canceled` or deleted blocker has `agent=queued` removed and
     gets a note naming each one, with the `aven dep remove <ref> <blocker ref>`
     command that removes it, saying to set `agent=queued` again after.
   - A brief with any other blocker that isn't `done` waits. It keeps
     `agent=queued`, gets no note, and uses no concurrency slot, and the tick
     logs `<ref>: waiting on <blocker refs>`. The briefs after it take the free
     slots.

   Each tick reaps before it starts briefs, so the tick that sets a blocker to
   `done` when its pull request merges starts the brief it was blocking, from an
   `origin/main` that has the blocker's changes. A brief never starts from
   another brief's branch, and dependencies added after a brief starts don't
   affect it. For each brief that can start, `implement` sets the task's status
   to `active` and `agent=working`, creates the worktree
   `.claude/worktrees/brief-<slug>-<suffix>` on the branch
   `brief/<slug>-<suffix>` from `origin/main`, then runs:

   ```sh
   claude --bg --remote-control brief-<slug>-<suffix> --name brief-<slug>-<suffix> \
     --permission-mode auto --settings <state>/settings.json "<prompt>"
   ```

   The start prompt lists the brief's blockers, if it has any, with their refs
   and titles. It says they're done, and that the agent session can read them
   with `aven context <ref>` but mustn't change them or put their refs on
   GitHub.

   The task stays `active` until the brief is let go. A brief queued again after
   failing starts over from a fresh worktree.

5. **Prunes** worktrees deleted by hand, with `git worktree prune`.

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

A retried agent session is told that it exited before finishing, without opening
a pull request, and that `implement` doesn't know why; that background commands
and sub-agents from before are gone, though background commands' processes may
still be running; and to check `git status`, `git log`, whether the branch is
pushed, and whether a pull request exists before going on. It then finishes
what's left of the start prompt's "When you're done" steps without redoing
finished work, self-review included, since no pull request is open yet. The
prompt passes on every note added to the task after the failure note, oldest
first, as instructions from Dan, or says there are none. When the failure note
isn't on the task, such as when Dan set `agent=retry` while the agent session
was still running, so it was never marked failed, the prompt says so and tells
the agent session to read the latest notes with `aven context <ref>`. Notes have
no author, so any note added after the failure note is passed on, whoever added
it. `aven` times notes to the second and orders notes from the same second by
ID, so a note added in the same second as the failure note may fall on either
side of it. The retry prompt ends with the same Aven, escalation and GitHub
sections as the other prompts.

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
and the `self-review` sub-agent run `aven` from their `PATH`, which `implement`
limits to Node's folder, `~/.local/bin`, `/usr/local/bin`, `/usr/bin`, and
`/bin`, so `IMPLEMENT_AVEN` should be the `aven` found there. Agent sessions and
their hooks keep `AVEN_DB` from `implement`'s environment, so they all use the
same Aven database.

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
| `IMPLEMENT_AVEN`          | `~/.local/bin/aven`. Agent sessions run the `aven` on their `PATH`.  |
| `IMPLEMENT_AVEN_PROJECT`  | `agent-diff`. Passed to `aven list` explicitly, never inferred.      |

## Commands

```sh
node src/main.ts tick [--dry-run]   # one tick; --dry-run only logs what it would change
node src/main.ts status             # tracked briefs, their state in Aven, and their agent sessions,
                                    # then queued briefs waiting on blockers, with the blockers that aren't done
npm test
npm run typecheck
```

`aven` runs against its default database. Set `AVEN_DB` to try `implement`
against a scratch database instead, such as one made with
`aven --db <temp file> project create agent-diff`.

`test/aven-real.test.ts` runs the real `aven` (`IMPLEMENT_AVEN`, or
`~/.local/bin/aven`) against a scratch database, config, and home folder in a
temporary folder, so it never touches the host's tasks. It's skipped when `aven`
isn't installed, as in CI, where `test/aven.test.ts` covers parsing with output
captured from `aven` and the arguments with a fake.

State lives in `<state dir>/state.json`. For each brief it started, keyed by the
task's ID, it holds the task's ref when last seen, the branch, worktree, agent
session name and id, which reviews have been handed over, the pull request's URL
once it's been noted on the task, and the ID of the note added when the brief
was last marked failed. The task holds everything else:

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
      "pullRequestUrl": "https://github.com/danschultz/agent-diff/pull/44",
      "failureNoteId": "VEQT3DM4D94Z4RS6"
    }
  }
}
```

## Migrating briefs from GitHub issues

Before [decision 0034](../../docs/decisions/0034-briefs-are-aven-tasks.md),
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
