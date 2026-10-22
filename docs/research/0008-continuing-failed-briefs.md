# 0008: How can `implement` continue a brief whose agent session exited without a pull request?

- Date: 2026-10-22

## Question

When an [agent session](../glossary.md#agent-session) that `implement` started
exits without opening a pull request, the next tick sets `agent=failed` and adds
a note with the end of its output. The worktree and local branch are kept. The
only ways on today are queuing the brief again, which removes the worktree and
starts over from `origin/main`, throwing the work away, or Dan resuming the
agent session by hand.

Dan asked for research into how `implement` could continue such a brief instead,
picking up its kept worktree, branch and conversation, so Dan can decide how
`implement` handles failed briefs. The research covers:

- why these agent sessions exit early, and whether `implement` can tell the
  causes apart;
- each way of continuing an agent session that has exited, and what it keeps and
  loses: the conversation, the session ID, the name, Remote Control, the
  settings and hooks, and background tasks;
- keeping the agent session from exiting in the first place, such as with a
  `Stop` hook;
- who triggers continuing, and when;
- what the continued agent session is told;
- how continuing fits `implement`'s states.

It builds on how `implement` works today
([`tools/implement`](../../tools/implement/README.md), decisions
[0014](../decisions/0014-implement-briefs-headlessly.md),
[0028](../decisions/0028-the-project-defines-how-agent-sessions-work.md),
[0030](../decisions/0030-self-review-before-the-pull-request-opens.md),
[0034](../decisions/0034-briefs-are-aven-tasks.md) and
[0035](../decisions/0035-queued-briefs-wait-for-their-blockers.md)), but no
option is ruled out because of them. Each option says which decisions it would
change. Only Claude Code is covered.

## Findings

### How this was checked

- **Claude Code 2.1.308**, the version `implement` runs, logged in to Dan's
  claude.ai account, on the server `implement` runs on: 12 CPUs, 7.9 GB of
  memory and no swap. Node 26.11.1 ran the prototypes.
- **Two real failures** were read, without changing anything: their transcripts
  under `~/.claude/projects/`, `~/.claude/daemon.log`, their job files in
  `~/.claude/jobs/<short-id>/`, `~/.claude/history.jsonl`, the
  `implement.service` journal, and their notes in Aven. Their agent sessions
  weren't resumed or changed.
- **Throwaway agent sessions** were started with `implement`'s start flags,
  `--bg --remote-control <name> --name <name> --permission-mode auto --settings <file>`,
  plus `--model haiku` to keep turns cheap, in a clean environment as
  `implement`'s `cleanEnv` makes. Their settings file had hooks that log every
  `SessionStart`, `UserPromptSubmit`, `Notification`, `Stop`, `StopFailure`,
  `SubagentStop` and `SessionEnd` with its session ID. Each first prompt gave a
  codeword, started a 15-minute background Bash command, wrote `progress.txt`,
  and ended the [turn](../glossary.md#turn). "Opened a pull request" was a
  marker file, `PR_OPENED`.
- **Scratch directories** were plain directories under the worktree's
  `.claude/worktrees/`, which git ignores. Claude Code refuses to start an agent
  session in a directory it doesn't trust ("Workspace not trusted"), and that
  includes a scratch git repo, even inside the trusted repo. Accepting the trust
  prompt would have changed Dan's `~/.claude.json`, so the scratch directories
  weren't git repos.
- **Making an agent session exit.** Its process was killed with `SIGKILL`, as
  the OOM killer did to a real one, or stopped with `claude stop`. The daemon
  calls this process a worker. Its PIDs are in `~/.claude/daemon/roster.json`.
  The daemon itself was never signalled, since `implement`'s and this research's
  own agent sessions ran in it.
- **What's internal.** `~/.claude/daemon.log`, `~/.claude/daemon/roster.json`,
  `~/.claude/jobs/<short-id>/state.json` and `timeline.jsonl`, the transcript's
  entry types, and the settle reasons read from the `claude` binary aren't
  documented. They're cited as observed on 2.1.308, and may change in any
  release. What's documented is `claude --help` and the
  [hooks reference](https://code.claude.com/docs/en/hooks), read on 2026-10-22.

### Why the two failures exited

**The brief that became pull request #49, 2026-10-22.**

- It ran for 28 minutes, committed all its work, ran the checks, and was on
  verification step 4. It ran a Playwright script that took a screenshot, read
  the screenshot, and sent the next API request at 05:26:50.990. That
  `api-request` is the last entry from that run, with no reply, error, or
  `turn_duration` after it.
- `daemon.log` logged `bg settled 71feb53c (done)` at 05:26:55.173, then
  `idle 5s with no clients — exiting` and
  `shutting down (cause=idle_exit, ..., live_workers=0)`.
- `state.json` says `state: done`, but its `detail` is still the last working
  one ("code committed; updating ADRs 0013-0031 and README"), its `fan` lists
  the Playwright shell with no end, and `firstTerminalAt`, `lastTerminalAt` and
  `updatedAt` all equal the settle time. `timeline.jsonl` ends on a `working`
  line.
- It wasn't killed for memory: the journal has no OOM line, and the daemon's
  scope `implement-claude-04e1644e.scope` peaked at 1.6 GB.
- The exit-causes prototype reproduced this exactly by sending `SIGINT` to the
  worker during a turn: `settled (done)` 0.2 s later, the same `state.json` and
  `timeline.jsonl`, the transcript cut off mid-turn, a `SessionEnd` hook and no
  `Stop` hook. No other cause tried gave `(done)` in the middle of a turn. What
  sent the signal isn't recorded anywhere that was found. The last command, a
  Node script launching Chromium through Playwright, doesn't send signals
  itself.
- `implement` marked it failed at 05:28:50. Dan resumed it at 07:00 in a tmux
  pane, interactively:
  `claude --resume <session-id> --permission-mode auto --settings <implement's settings.json> --model claude-opus-5-5`.
  Claude Code added a synthetic assistant message, "No response requested.",
  after the unanswered request, then Dan's prompt. The agent session finished
  the verification steps, self-reviewed, and opened pull request #49 at 07:09.
  Its first request after resuming re-created 274k tokens of prompt cache and
  read 27k, since 93 minutes had passed and the cache's lifetime is 1 hour
  (`ephemeral_1h` in the usage).
- While it ran interactively, every tick logged
  `claude stop exited with 1: No job matching 'undefined'`.
  `claude agents --json` lists an interactive agent session without a short ID,
  so `reap` found it by its session ID, saw the brief in `agent=review`, and
  called `claude stop` with no ID (journal, 07:12 to 07:18).

**The brief that became pull request #47, 2026-10-21.**

- Its last output, "The SDK sub-agent is running again. Still waiting on …", at
  05:38:58, was a normal end of turn while four background sub-agents ran. That
  doesn't end a `--bg` agent session (see below), and it stayed listed.
- At 05:42:00 the journal logged
  `implement-claude-cf87e5ba.scope: A process of this unit has been killed by the OOM killer`,
  then `Failed with result 'oom-kill'` with a 3.6 GB memory peak. That scope
  holds the daemon and every agent session in it. `daemon.log` logged
  `[supervisor] shutting down (cause=signal, uptime=4881s, leases=0, live_workers=2)`
  at the same second, with no `settled` line for either worker. `implement`
  marked the brief failed at 05:43:26.
- The next daemon start, at 06:05:56, logged
  `bg adopt: adopted=0 respawned=0 dead=2`: it found both workers dead and
  didn't restart them.
- At 06:05:57 Dan's own agent session ran a script that calls `implement`'s own
  `cliClaude().resume()`, that is
  `claude --bg --resume <session-id> "<prompt>"`, after moving the brief from
  `agent=failed` to `agent=working` and adding a note. The daemon logged
  `bg spawned 250172bf (fleet)`. The agent session kept its session ID and short
  ID, the transcript got a new `bridge_status` entry ("/remote-control is
  active"), and the `Notification` hook added three needs-input notes later, so
  Remote Control and the hooks worked after the resume. The four sub-agents were
  gone: their task notifications arrived as soon as it resumed. Its first
  request read 171k tokens from the prompt cache and created 1.3k, 27 minutes
  after its last request. It finished and opened pull request #47.
- It had hit the subscription's usage limit twice before, at about 04:41 and
  06:11, and Claude Code showed "You're now using usage credits". The agent
  session didn't exit then. It went on, on usage credits, and stopped to ask Dan
  because the brief's escalation criteria said to.

**An earlier failure, 2026-10-12**, for brief issue #10, was found in the
journal. The daemon started at 17:21:15 and then logged nothing more: no
`settled`, no `shutting down`. That fits the daemon being killed with
`implement.service`'s cgroup when the tick exited, which commit `2a025e2`, "fix
process scopes", fixed the same day by running `claude --bg` in its own systemd
scope.

### What ends a `claude --bg` agent session

The daemon "settles" an agent session when it stops hosting it for good, and
logs `bg settled <short-id> (<outcome>)`. The agent session then disappears from
`claude agents --json`, which is what `implement`'s `reap` sees, and
`claude agents --json --all` shows it with only its ID and `state`. From the
strings in the `claude` binary, the outcomes are `done`, `killed` and `crashed`.

| What happened                                                                                                            | Ends the agent session?                     | `daemon.log`                                                                        | Job files                                                                                    | Transcript                                                                                                                                                                       | Hooks                                                                          | Source               |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------- |
| The turn ends normally                                                                                                   | No. Listed as `status: idle`, `state: done` | Nothing                                                                             | `state: done`, `tempo: idle`; `timeline.jsonl` ends on `done`                                | Ends with `turn_duration`                                                                                                                                                        | `Stop`, then `Notification` (`idle_prompt`) 60 s later                         | Tried                |
| The turn ends while a background Bash command, Monitor or sub-agent runs                                                 | No. `status: busy`                          | Nothing                                                                             | `inFlight.tasks` > 0, an open `fan` item; `state` can be `done` or `working`                 | Normal; a new turn starts by itself when the work finishes                                                                                                                       | `Stop` each turn                                                               | Tried                |
| An API error (an invalid model)                                                                                          | No. `status: idle`, `state: failed`         | Nothing                                                                             | `state: failed`, `detail` holds the error                                                    | An assistant message flagged as an API error                                                                                                                                     | `StopFailure`, not `Stop`                                                      | Tried                |
| The usage limit, with usage credits on                                                                                   | No. It carries on, on credits               | Nothing                                                                             | Not read                                                                                     | Claude Code shows "You're now using usage credits"                                                                                                                               | Not logged                                                                     | Real transcript      |
| `claude stop`                                                                                                            | Yes, `(killed)`                             | `bg settled <id> (killed)`                                                          | `state: stopped`                                                                             | Cut off where it was                                                                                                                                                             | `SessionEnd`, no `Stop`                                                        | Tried                |
| `SIGINT` to the worker, during a turn                                                                                    | Yes, `(done)`, 0.2 s later                  | `bg settled <id> (done)`                                                            | `state: done`, last working `detail`, an open `fan` item; `timeline.jsonl` ends on `working` | Cut off mid-turn, no `turn_duration`                                                                                                                                             | `SessionEnd`, no `Stop`                                                        | Tried                |
| `SIGINT`, or `SIGKILL` of the REPL process, while idle                                                                   | Yes, `(done)`, 7 to 10 s later              | `bg settled <id> (done)`, sometimes only when the next `claude` command runs        | As after a normal end of turn                                                                | Normal end                                                                                                                                                                       | `SessionEnd` (`SIGINT`) or nothing (`SIGKILL`)                                 | Tried                |
| `SIGKILL`, `SIGTERM` or `SIGHUP` to the worker during a turn                                                             | No. The daemon restarts it about 13 s later | Nothing                                                                             | Same short ID, new PID, `attempt: 2` in `roster.json`                                        | A user message: "Continue from where you left off. Note: this session was automatically restarted after its process exited unexpectedly …"; the interrupted tool call runs again | `SessionEnd` (if the pty host died), then `SessionStart` with `source: resume` | Tried                |
| The whole daemon killed, such as by the OOM killer                                                                       | Yes, every agent session in it              | `shutting down (cause=signal, …, live_workers=N)`; next start `bg adopt: … dead=N`  | Left as last written                                                                         | Cut off wherever each one was                                                                                                                                                    | Not logged                                                                     | Real failure         |
| The daemon killed with the tick's cgroup (before 2026-10-12)                                                             | Yes, every agent session in it              | Nothing at all                                                                      | Not read                                                                                     | Not read                                                                                                                                                                         | Not logged                                                                     | Real failure         |
| An idle agent session retired: after 1 hour, after 8 hours with Remote Control, or after 60 s when memory is low         | Yes, `(done)`                               | `bg settled <id> (done)`; `bg: low memory (…) — retiring settled workers` seen once | Not read                                                                                     | Not read                                                                                                                                                                         | Not read                                                                       | Binary, one log line |
| `crashed`: three exits within 5 s of starting, 20 restarts in a row, the working directory gone, or the launcher failing | Yes, `(crashed)`                            | `bg settled <id> (crashed): <detail>`                                               | Not read                                                                                     | Not read                                                                                                                                                                         | Not read                                                                       | Binary               |

Also found:

- **The daemon doesn't exit while it hosts an agent session.** All 28
  `idle … exiting` lines in `daemon.log` are 5 s after the last worker settled,
  and every `cause=idle_exit` line has `live_workers=0`. Its idle exit follows
  an exit, it never causes one.
- **`/exit` doesn't end a `--bg` agent session.** Sent with
  `claude --bg --resume <id> "/exit"`, it starts a copy that stays alive. Typed
  in `claude attach`, it returns to the `claude agents` view.
- **Background processes outlive the worker.** A background Bash command's
  process is reparented to `systemd --user` and keeps running when the worker is
  killed. Every way of continuing then tells the agent session the command
  "didn't finish before the previous session ended" and marks it `stopped`.
  Sub-agents run inside the worker, and end with it.
- **The 8-hour retire applies to `implement`'s agent sessions**, since they all
  have Remote Control. One waiting in `agent=needs-input` for more than 8 hours
  would be retired, and the next tick would mark the brief failed. This is read
  from the binary only.

**Can `implement` tell the causes apart?** Today it only sees that the agent
session is no longer listed and that there's no pull request. It could tell more
from:

- `daemon.log`'s settle reason, which separates `claude stop` (`killed`) and
  repeated crashes (`crashed`) from the rest (`done`), and its `shutting down`
  lines, which show the daemon was killed. All internal.
- Whether the turn was cut off: `timeline.jsonl` ending on `working`, or the
  transcript not ending with `turn_duration`. Also internal.
- Hooks, which are documented: a `SessionEnd` after `UserPromptSubmit` with no
  `Stop` in between means the turn was cut off, `StopFailure` gives the API
  error type, and `SessionStart` with `source: resume` shows the daemon
  restarted a worker by itself. `implement`'s settings hook only `Notification`
  and `UserPromptSubmit` today.
- The journal, for an OOM kill of the daemon's scope.

A `(done)` after a finished turn, from a retire or an exit while idle, and a
`(done)` after a `SIGINT` mid-turn look the same in `daemon.log` and
`state.json`'s `state`. Only the turn's end tells them apart.

### Ways of continuing, and of keeping an agent session from exiting

Every option below was tried with a prototype in
[`0008-continuing-failed-briefs/`](0008-continuing-failed-briefs/), one
directory each, against a throwaway agent session whose worker was killed with
`SIGKILL` while idle. That's the state a brief is in when `implement` marks it
failed. Cost is the first request after continuing. The throwaway conversations
were about 53k tokens, almost all of it Claude Code's system prompt and tools,
with the prompt cache warm. The two real resumes above show the cost for a
conversation of a real brief.

| Option                                                                    | Stability                                                                              | Triggered by                                                 | Keeps the conversation                                                                       | Keeps the session ID                                    | Remote Control and hooks afterwards                                                                                                         | Background tasks                                                                                        | Cost                                                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `claude --bg --resume <session-id> "<prompt>"`, as the review resume      | Documented in `claude --help`; the saved options are internal                          | A command, so `implement`, Dan, or a script                  | Yes, same transcript                                                                         | Yes, and the same short ID and name                     | Yes: "woke session … with its saved options"; same `bridgeSessionId`, new `bridge_status`; hooks fire, `SessionStart` with `source: resume` | Told they "didn't finish" and `stopped`; the processes still run as orphans                             | 1.1k to 1.3k created, 52.6k read from cache; the real #47 resume read 171k                              |
| The same, with `implement`'s start flags passed again                     | Documented: "starts a copy … when"; the note says why                                  | A command                                                    | Yes, copied into a new transcript                                                            | No, a copy with a new session ID and short ID           | Hooks fire (`source: fork`); a new Remote Control session; same name; no `--model` saved                                                    | As above                                                                                                | Like a resume                                                                                           |
| `claude --bg --resume <session-id> --fork-session "<prompt>"`             | Documented flag                                                                        | A command                                                    | Yes, copied into a new transcript                                                            | No                                                      | No: no saved options, so no hooks and no Remote Control, and a generated name                                                               | As above                                                                                                | 1.1k created, 52.7k read                                                                                |
| Print mode, `claude -p --resume <session-id> "<prompt>"`                  | Documented                                                                             | A command; it blocks until the turn ends                     | Yes, same transcript                                                                         | Yes; the background agent session's entry stays `done`  | No Remote Control. Hooks fire only if `--settings` is passed again, with `--permission-mode` and `--model`                                  | As above                                                                                                | 2.1k created, 52.7k read                                                                                |
| Print mode, `claude -p --continue "<prompt>"`                             | Documented                                                                             | A command, run in the worktree                               | Only if it's the newest conversation in the directory: a second one there was picked instead | Yes, when it picks the right one                        | As print mode with `--resume`                                                                                                               | As above                                                                                                | As print mode                                                                                           |
| Interactive `claude --resume <session-id>` in a terminal, as Dan did      | Documented                                                                             | Dan, at a terminal                                           | Yes, same transcript                                                                         | Yes, but listed as `kind: interactive` with no short ID | No new Remote Control unless `--remote-control` is passed; hooks fire if `--settings` is passed again; `implement` can't `claude stop` it   | As above                                                                                                | 1.9k created, 52.8k read; the real #49 resume created 274k after 93 minutes                             |
| `claude attach <id>`, then a typed prompt                                 | Documented in `claude stop --help`; needs a terminal                                   | Dan; a script only through a pseudo-terminal such as tmux    | Yes                                                                                          | Yes, and the short ID and name                          | Yes: same `bridgeSessionId`, saved hooks fire; it stays a background agent session after the terminal closes                                | As above                                                                                                | 0.5k created, 52.3k read                                                                                |
| `claude respawn <id>`                                                     | Documented, for picking up a new binary                                                | A command                                                    | Yes, but it starts no turn                                                                   | Yes, and the short ID and name                          | Yes, with the saved options                                                                                                                 | As above                                                                                                | Nothing until a prompt. `claude --bg --resume` afterwards starts a copy with no hooks or Remote Control |
| The daemon's own restart of a worker that died during a turn              | Undocumented                                                                           | Automatic, about 13 s after `SIGKILL`, `SIGTERM` or `SIGHUP` | Yes; told it was "automatically restarted", and the interrupted call runs again              | Yes                                                     | Yes                                                                                                                                         | As above                                                                                                | 0.7k created, 51.9k read. It doesn't help after `SIGINT`, a killed daemon, or a kill while idle         |
| A new agent session in the kept worktree, with a summary prompt           | Documented flags only                                                                  | A command                                                    | No. The prompt carries files and the old last message                                        | No, a new session ID; the old name can be reused        | Yes, as for any start: a new Remote Control session, hooks with the new session ID                                                          | Unknown to it; it matched an unrelated `node` process                                                   | 13.5k created, 26k read in the toy test; a real brief also reads its context again                      |
| A `Stop` hook that blocks the end of a turn while there's no pull request | Documented, with `stop_hook_active`, `background_tasks` and a cap of 8 blocks in a row | Automatic, each time the main agent ends a turn              | Yes, the same turn goes on                                                                   | Yes                                                     | Yes, nothing restarts                                                                                                                       | Documented in its input: `background_tasks` lists them, so the hook can let the turn end while they run | 50k to 57k read from cache, 0.4k to 1k created, per block, on a 50k conversation                        |

No setting that keeps a `--bg` agent session alive was found in `claude --help`
or the hooks reference, so it has no row. The binary has undocumented
environment variables about idle agent sessions, listed in Gaps, which weren't
tried.

Details that apply to several options:

- **The saved options.** `~/.claude/jobs/<short-id>/state.json` has
  `respawnFlags`: `implement`'s start flags, with `--remote-control` but not its
  name, and `--model` set to the model the agent session started on, though
  `implement` doesn't pass `--model`. `claude --bg --resume` and
  `claude respawn` start the worker with them. So a continued agent session
  keeps the model it started with, even if `.claude/settings.json` has changed
  since, which
  [0028](../decisions/0028-the-project-defines-how-agent-sessions-work.md)
  relies on for new agent sessions. The prompt isn't saved.
- **An agent session that's still running gets a copy.** `claude --bg --resume`
  on an agent session that's listed, including one `claude respawn` brought back
  or one the daemon restarted by itself, prints
  `session <id> is already running in the background, so this started a copy as <new id>`.
  The copy has the conversation but no saved options, so no hooks and no Remote
  Control. `implement`'s `resume` already checks the agent session isn't running
  first.
- **A turn cut off mid-turn.** On `--resume` of an agent session stopped during
  a tool call, Claude Code adds a tool result,
  `[Tool call interrupted: the session ended before this call's result was recorded, ...]`,
  and a synthetic assistant message, "No response requested.", before the new
  prompt. The agent session sees where it stopped.
- **The prompt cache lasts an hour.** Resuming within an hour reads the whole
  conversation from the cache. After that, the first request writes it all to
  the cache again: 274k tokens for #49 after 93 minutes. Usage is counted
  against the subscription, which is what limits `implement`.

#### `claude --bg --resume`

This is what `implement` already does for reviews, and what continued #47. It
keeps everything `implement` relies on: the session ID in `state.json`, the
short ID `reap` stops it by, the name Dan sees in Remote Control, and the hooks
that report needs-input. Passing any start flag again makes a copy instead, as
`claude.ts` says. Stopping the agent session with `claude stop` first, as
`implement` does in review, gives the same result. It needs no terminal, and
returns as soon as the prompt is handed over.

#### `--fork-session`

The conversation is copied into a new agent session, but nothing else is. The
start flags would have to be passed again for the hooks, the name and Remote
Control, and `implement` would have to record the new session ID.

#### Print mode

Print mode reads the same transcript and writes to it, so a later
`claude --bg --resume` sees the print-mode turn. It ignores the saved options,
has no Remote Control, and blocks until the turn ends, which for a brief can be
an hour, longer than `implement`'s 5-minute command timeout. `--continue` picks
the newest conversation in the directory, and anything else that runs `claude`
in the worktree changes which one that is.

#### Interactive `--resume` and `claude attach`

Both need a terminal, so they suit Dan, not a timer. An interactive resume makes
an agent session `implement` can't manage: it has no short ID, so `reap` can't
stop it (seen with #49), and it ends when the terminal does. `claude attach`
brings back the background agent session itself, with its saved options, and it
keeps running after the terminal closes. A script can drive it through tmux, but
has to wait for the input box before typing, or the prompt is lost.

#### `claude respawn`

It restarts a dead worker with the saved options, idle. There's no way found to
then give it a prompt without a terminal: `claude --bg --resume` makes a copy,
and `claude attach` needs a terminal. The daemon's startup does the same kind of
thing for workers still alive (`adopted=N`), but not for dead ones
(`respawned=0 dead=N`).

#### A new agent session

The prototype builds the prompt from what `implement` can read without the old
conversation: the task, the files in the directory, and the old transcript's
last assistant text, with `lastAssistantText` from `claude.ts`. In a worktree,
`git log`, `git status` and the branch's pull request would add more. The new
agent session read `progress.txt`, didn't redo the finished step, and finished.
It loses whatever was only in the conversation, such as the codeword here, or
for a real brief, which verification steps passed, what self-review found, and
Dan's answers. It gets a new session ID, which `implement` would record, and can
reuse the old name while the old agent session is still listed as `done`.

#### A `Stop` hook

This keeps the turn from ending, rather than continuing after an exit. The
prototype's hook, in the settings file passed with `--settings`, allows the end
of the turn when the brief is done (`PR_OPENED` exists), when the agent session
is asking a question, or when `background_tasks` lists running work, which wakes
the agent session later anyway. Otherwise it blocks with
`{"decision":"block","reason":…}`, a reason saying what's left, up to a limit
per session ID, counted in a file.

- **It works.** Told to write a file and end its turn, the agent session was
  blocked once, then created `PR_OPENED`, and the next `Stop` was allowed. The
  same agent session, conversation and Remote Control carry on. If the reason
  doesn't say what finishing means, the agent session flails until the limit.
- **Loops.** The docs say `stop_hook_active` "is true when Claude Code is
  already continuing as a result of a stop hook", and that Claude Code ends the
  turn after 8 blocks in a row, a cap that resets on each tool call and is
  raised with `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`. Observed: `stop_hook_active`
  was false on the first `Stop` of a turn and true on every later one in that
  turn, even after tool calls, so checking it alone allows one block per turn. A
  hook set to block 20 times was overridden after 8 continuations. An agent
  session that won't finish was allowed to stop by the prototype's limit of 3,
  and stayed listed and idle, still without a pull request.
- **Needs input.** `implement`'s `Notification` hook sets `agent=needs-input`
  only on `idle_prompt`, 60 s after `Stop`, so the `Stop` hook can't read it.
  The agent session has to mark the question itself, such as with a file, or the
  hook has to guess. Of five runs without a marker, checking whether the last
  message ends with "?" was right once, let a finished agent session's closing
  "Let me know if you need anything else?" through, and missed three questions.
  The daemon's `state.json` already said `state: blocked` when `Stop` ran in
  every question run, but that's internal. No `agent_needs_input` notification
  reached the hooks.
- **Background work.** With a background command running, the hook saw
  `shell: running` in `background_tasks` and allowed the stop. When the command
  finished 45 s later, the daemon started a new turn, the agent session created
  `PR_OPENED`, and the next `Stop` was allowed.
- **Sub-agents.** They fire `SubagentStop`, not `Stop`, so a `Stop` hook doesn't
  block the `self-review` sub-agent.
- **Where it doesn't help.** `Stop` fires only when the main agent ends a turn.
  An API error fires `StopFailure`, whose output is ignored, and neither fires
  when the worker or the daemon is killed, which covers both real failures.
- **Gaming.** In one run, the agent session read the settings and the hook's
  script, and created the needs-input marker itself to end the loop.

### What the continued agent session is told

`resumePrompt` in [`prompts.ts`](../../tools/implement/src/prompts.ts) is about
a pull request review: the reviews, how to read their comments, addressing them,
rerunning the verification steps, pushing, waiting for CI, and moving the brief
back to review, plus the Aven, escalation and GitHub sections. A continue prompt
would share those last three sections. From the two real resumes and the
prototypes, it would also need:

- **That it exited before finishing, without a pull request**, and the cause
  when `implement` knows it, such as "the daemon was killed for memory" or "the
  turn was cut off".
- **That background work is gone.** Sub-agents ended with the worker, and
  background commands are marked stopped, though their processes may still run,
  such as a review server holding a port. Dan's prompt for #47 said "Those
  sub-agents are gone. Read their notes files outside the repo, and start new
  sub-agents only for what's still missing."
- **To check the state before going on**, since files may have changed after the
  last thing in the conversation: `git status`, `git log`, whether the branch is
  pushed, and whether a pull request exists. Claude Code's own restart message
  says the same: "Re-verify anything time-sensitive (branch state, running
  processes, prior partial work) before continuing."
- **What's left**, as the start prompt's "When you're done" list: the remaining
  verification steps, self-review (which
  [0030](../decisions/0030-self-review-before-the-pull-request-opens.md) says
  runs only before the first pull request), pushing, the draft pull request,
  waiting for CI, and moving the brief to review. A resumed agent session has
  the start prompt in its conversation already, so a short pointer to it is
  enough. A new agent session needs the whole start prompt, plus the work so
  far.
- **Not to redo finished work.** Dan's prompt for #49 named what to skip:
  "report what the page showed in step 4, run step 5's git grep, rerun npm run
  check …, then push the branch and open the pull request".
- **Any answer from Dan**, such as the latest note on the task, or a prompt Dan
  gives when triggering it.

### How continuing fits `implement`'s states

- **State.** The brief goes from `agent=failed` back to `agent=working`, as
  Dan's script for #47 did with `moveTo`. `implement` already keeps the session
  ID, worktree and branch of a failed brief, so `claude --bg --resume` needs
  nothing new in `state.json`. A retry limit would need a count per brief.
  Resetting `launchedAt` gives the agent session the 3-minute grace before
  `reap` counts it missing, as `resume` does for reviews.
- **Notes.** One saying it was continued, by whom, and which attempt it was, as
  Dan's script added for #47.
- **Concurrency.** A continued brief takes a slot, as a review resume does. It
  would come before queued briefs, as `resume` does today.
- **Failing again.** It's marked failed again with a new note. With a retry
  limit, the note would say the limit was reached.
- **Needs input.** An agent session waiting on Dan that's retired after 8 hours
  is marked failed although it was waiting. Continuing it, with Dan's answer as
  the prompt, is the same as answering it.
- **Being let go.** Queuing again, merging, closing or canceling works as today,
  and removes the worktree.

### Who triggers continuing

| Trigger                                                                   | Aven                                                                                 | `implement`'s state                                            | Timer                                 | Decisions it changes                                                                                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `implement`, on the tick that finds the agent session gone, up to N times | A note per attempt; `agent=failed` only once the limit is reached                    | An attempt count per brief, reset when it opens a pull request | None; continues within 2 minutes      | [0014](../decisions/0014-implement-briefs-headlessly.md) and [0034](../decisions/0034-briefs-are-aven-tasks.md): a failed agent session no longer always means `agent=failed` |
| Dan, by setting a new value such as `agent=continue`                      | A new `agent` value, read by the tick like `queued`; Dan's latest note as the prompt | None new                                                       | None; the next tick, within 2 minutes | 0014 and 0034: a new state                                                                                                                                                    |
| Dan, by queuing again with a flag, such as metadata `continue=yes`        | A second metadata key, removed once read                                             | None new                                                       | None                                  | 0034, which says a brief queued again after failing starts over from a fresh worktree                                                                                         |
| Dan, with an `implement continue <ref> [prompt]` command                  | None; the command moves the brief and adds the note                                  | Takes the tick's lock, as Dan's script for #47 did             | None; runs at once                    | 0014: a new way to start work outside the tick                                                                                                                                |
| Claude Code itself: a `Stop` hook, or the daemon's own restart            | Possibly a note when the hook blocks                                                 | A block count per agent session, for the hook                  | None                                  | 0028, if the hook counts as something running unattended needs; 0014, for the hook                                                                                            |

Each of these can use `claude --bg --resume` or a new agent session. A retry
from the tick can't ask Dan first, so it would continue agent sessions that
ended for a reason that will happen again, such as the daemon being killed for
memory while several briefs run, or a usage limit.

### Prototypes

In [`0008-continuing-failed-briefs/`](0008-continuing-failed-briefs/), run
against Claude Code 2.1.308 with Node 26.11.1. None has npm dependencies. Each
directory's README says how to run it and what it showed, and each `run.sh`
starts throwaway agent sessions with `--model haiku`, prints a summary, and
removes what it made.

| Directory                                                                  | What it tries                                                                                                              |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [`exit-causes/`](0008-continuing-failed-briefs/exit-causes/)               | Each cause above that could be caused by hand, and what it leaves in `daemon.log`, the job files, the transcript and hooks |
| [`common/`](0008-continuing-failed-briefs/common/)                         | Shared setup for the next four: start, wait until idle, kill or stop, and report                                           |
| [`bg-resume/`](0008-continuing-failed-briefs/bg-resume/)                   | `claude --bg --resume`, with and without the start flags, after a kill, a `claude stop`, and a kill mid-turn               |
| [`bg-fork/`](0008-continuing-failed-briefs/bg-fork/)                       | `claude --bg --resume --fork-session`                                                                                      |
| [`print-resume/`](0008-continuing-failed-briefs/print-resume/)             | `claude -p --resume` and `claude -p --continue`                                                                            |
| [`interactive-resume/`](0008-continuing-failed-briefs/interactive-resume/) | Interactive `claude --resume` in tmux                                                                                      |
| [`respawn/`](0008-continuing-failed-briefs/respawn/)                       | `claude respawn`, and the daemon's own restart after a kill mid-turn                                                       |
| [`attach/`](0008-continuing-failed-briefs/attach/)                         | `claude attach` driven through tmux                                                                                        |
| [`fresh-session/`](0008-continuing-failed-briefs/fresh-session/)           | A new agent session with a prompt built from the directory and the old last message                                        |
| [`stop-hook/`](0008-continuing-failed-briefs/stop-hook/)                   | A `Stop` hook that blocks the end of a turn without a pull request, with its limit, questions and background work          |

## Options

The approaches found, with their benefits and costs. They combine: a `Stop` hook
or the daemon's own restart keeps some agent sessions from exiting, and one of
the others continues the rest.

### Continue with `claude --bg --resume`

- **Benefits.**
  - Keeps the conversation, the session ID, the short ID, the name, Remote
    Control and the hooks, so `implement`'s `reap`, its hooks, and Dan's way of
    answering all work as before.
  - `implement` already runs it for reviews, and it's how #47 was continued.
  - Cheap within an hour of the last request, while the prompt cache holds.
  - Returns at once, and needs no terminal.
- **Costs.**
  - Relies on the saved options in `state.json`, which aren't documented. Only
    "continues that session in the background under the same ID" is.
  - Keeps the model the agent session started on, not the one in
    `.claude/settings.json` now.
  - After an hour, the first request writes the whole conversation to the cache
    again, 274k tokens for #49.
  - Starts a copy without hooks or Remote Control if the agent session is still
    running, so the caller has to check first.
  - Background commands and sub-agents from before are gone, and their processes
    may still be running.
  - The conversation carries whatever confused the agent session before, and
    grows toward compaction.

### Continue with `--fork-session` or the start flags again

- **Benefits.**
  - Keeps the conversation, in a new transcript, so the old one stays as it was.
- **Costs.**
  - A new session ID for `implement` to record.
  - With `--fork-session` alone, no hooks, no Remote Control, and a generated
    name. With the start flags again, a new Remote Control session.
  - Costs the same as `claude --bg --resume`, for nothing it needs.

### Continue in print mode

- **Benefits.**
  - Keeps the conversation and session ID, and the caller gets the reply as the
    command's output.
- **Costs.**
  - No Remote Control, so Dan can't answer the agent session while it runs.
  - Every start flag has to be passed again.
  - Blocks for the whole turn, longer than `implement`'s command timeout.
  - `--continue` can pick the wrong conversation.

### Continue by hand, with an interactive `--resume` or `claude attach`

- **Benefits.**
  - Dan sees the agent session and can steer it.
  - `claude attach` keeps everything, as `claude --bg --resume` does.
- **Costs.**
  - Needs Dan at a terminal, and is what happens today.
  - An interactive `--resume` makes an agent session `implement` can't stop, and
    without `--remote-control` and `--settings` it has no Remote Control or
    hooks.
  - A script can only use `claude attach` through a pseudo-terminal.

### Restart with `claude respawn`

- **Benefits.**
  - Brings the agent session back with its saved options, no terminal needed.
- **Costs.**
  - Starts no turn, and no way was found to then give it a prompt without a
    terminal.
  - Its help says it's for picking up a new binary.

### Rely on the daemon's own restart

- **Benefits.**
  - Already happens, for a worker that dies during a turn from `SIGKILL`,
    `SIGTERM` or `SIGHUP`, with the conversation and everything else, and the
    agent session is told to re-check its state.
- **Costs.**
  - Undocumented.
  - Doesn't happen after `SIGINT`, when the whole daemon is killed, or when the
    worker dies while idle, which covers both real failures.
  - `implement` can't see it happened without a `SessionStart` hook.

### Start a new agent session in the kept worktree

- **Benefits.**
  - Uses only documented flags, and the same start path as today.
  - Starts from a small conversation, without what confused the old one.
  - Works when the old conversation can't be resumed.
- **Costs.**
  - Loses what was only in the conversation: which verification steps passed,
    what self-review found, Dan's answers, the plan.
  - Reads the brief's context again, so the first requests cost more than a
    resume within the hour, and possibly less than one after it.
  - Needs a prompt builder that summarises the work so far.
  - A new session ID, and a new Remote Control session.

### Keep the agent session working with a `Stop` hook

- **Benefits.**
  - Documented, including the inputs a hook needs: `stop_hook_active`,
    `last_assistant_message` and `background_tasks`.
  - Nothing exits, so the conversation, session ID, Remote Control and hooks all
    stay, and there's no resume to trigger.
  - Each block costs one turn on a warm cache.
  - Catches an agent session that ends its turn without finishing, which the
    other options only deal with after the tick marks it failed.
- **Costs.**
  - Doesn't help when the worker or the daemon is killed, or on an API error,
    which is how both real failures ended.
  - Telling a question from giving up is a guess, unless the agent session marks
    its questions, and a wrong guess either blocks Dan's question or lets the
    agent session stop early.
  - Needs a block limit kept outside Claude Code, since `stop_hook_active` stays
    true for the rest of the turn, and Claude Code's own cap of 8 resets on each
    tool call.
  - The agent session can read the hook and work around it.
  - Adds a hook to `implement`'s settings, beyond the two
    [0028](../decisions/0028-the-project-defines-how-agent-sessions-work.md)
    lists.

### Who triggers it

- **`implement`, automatically, with a retry limit.**
  - Benefits: nobody has to notice. Within the hour, it's cheap.
  - Costs: continues agent sessions that ended for a reason that will happen
    again, such as memory or a usage limit, using usage each time. Needs a count
    in `state.json`. Changes what `agent=failed` means.
- **Dan, through Aven, with a new `agent` value or a flag on queuing.**
  - Benefits: Dan decides, from the failure note, and can add instructions in a
    note. Works from wherever Dan uses Aven.
  - Costs: waits for Dan, and the cache may expire meanwhile. A new state or key
    to document.
- **Dan, with an `implement continue` command.**
  - Benefits: runs at once, with a prompt Dan writes. It's the script Dan's
    agent session wrote for #47, made permanent.
  - Costs: needs a shell on the server.
- **Claude Code itself.** See the `Stop` hook and the daemon's own restart.

## Gaps

- **What was checked by hand** with the prototypes, on Claude Code 2.1.308:
  every option in the table, the causes marked "Tried", the saved options, the
  copy made when an agent session is running, the messages Claude Code adds on a
  continue, and the token usage of the first request after each.
- **What was only read in logs** of the real failures: the OOM kill of the
  daemon, the daemon killed with the tick's cgroup, `bg adopt` at startup, the
  usage limit with credits on, and the cost of resuming a real brief's
  conversation. Why the worker of #49 got a `SIGINT`, or whatever else gave it
  the same signature, wasn't found.
- **What was only read in the binary**, not run: the `crashed` outcome and its
  thresholds, and retiring idle agent sessions after 1 hour, 8 hours with Remote
  Control, or 60 s on low memory. The binary also has undocumented environment
  variables, such as `CLAUDE_CODE_PARKED_STOP_RETIRES` and
  `CLAUDE_CODE_IDLE_THRESHOLD_MINUTES`, whose effect wasn't checked.
- **Usage limits** can't be triggered on purpose, so how each option behaves
  when the limit is reached without credits is unknown. The docs say an API
  error such as a rate limit fires `StopFailure`, and the invalid-model test
  left the agent session idle with `state: failed`, which suggests a usage limit
  leaves it listed rather than exited. That's inferred, not checked.
- **A cold cache** wasn't measured with the prototypes: waiting 7 minutes didn't
  expire it, and an hour wasn't waited. The #49 resume gives one real number.
- **Killing the daemon**, an OOM kill of a single worker, `SIGQUIT`, and an
  upgrade restart weren't tried, since the daemon also ran real agent sessions.
- **Git.** The scratch directories weren't git repos, so a new agent session
  wasn't tried in a real worktree, and the "pull request" was a marker file.
- **Remote Control from Dan's side.** Whether each option's Remote Control
  session could be answered from the Claude app wasn't tried. Only its
  registration was checked, in `state.json` and the transcript.
- **The model.** Every throwaway agent session ran Haiku. Whether the results
  differ on Opus wasn't checked, apart from the two real resumes.
