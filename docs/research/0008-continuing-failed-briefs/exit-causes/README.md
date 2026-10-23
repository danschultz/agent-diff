# What makes an agent session settle, and what each cause leaves behind

Research 0008 experiment. Claude Code 2.1.308. Question: when a `claude --bg`
agent session stops being listed by `claude agents --json` (the daemon logged
`bg settled <id> (<reason>)`), can `implement` tell why?

Everything here was observed with throwaway haiku agent sessions started with
`implement`'s flags
(`--bg --remote-control <name> --name <name> --permission-mode auto --settings <file>`),
except the parts marked "binary", which come from the strings in the `claude`
binary, not from docs.

## Run it

```sh
./run.sh <case> [watch-seconds]     # prints a summary; cleans up after itself
KEEP=1 ./run.sh idle                # keep the scratch dir
DELAY=150 ./run.sh monitor 200      # DELAY: seconds the background work runs
```

Needs `claude` 2.1.308 on the `PATH`, Node 24, `tmux` (for `exit-attach`). It
starts the agent session in `$REPO/.claude/worktrees/ad8-exit-causes-<n>/` (a
plain directory, inside the repo so Claude Code trusts it; `REPO` and
`SCRATCH_ROOT` override), with hooks from `hook.mjs` for `SessionStart`,
`UserPromptSubmit`, `Notification`, `Stop`, `SubagentStop`, `StopFailure` and
`SessionEnd` writing to a log in that directory. After the cause it prints
snapshots of: `claude agents --json --all` and plain `claude agents --json`, the
selected `state.json` fields, the tail of `timeline.jsonl`, the types of the
last transcript entries, the hook log, and the new `daemon.log` lines for the
agent session. Then it runs `claude stop` and `claude rm` on it.

Cases: `idle`, `stop`, `bgbash`, `monitor`, `subagent`,
`kill-<KILL|TERM|HUP|INT>-<pid|replPid>[-idle]`, `badmodel`, `exit-resume`,
`exit-attach`. `pid` is the pty host in `~/.claude/daemon/roster.json` (a child
of the daemon); `replPid` is the REPL it runs, which is the `pid` in
`claude agents --json`. The scripts never signal the daemon.

## What settles an agent session

The daemon (`bg` handle) settles with one of three outcomes: `done`, `killed`,
`crashed` (logged as `bg settled <id> (<outcome>)`, `crashed` with
`: <detail>`). `agents --all` then shows a row with only `id` and `state`:
`done`, `stopped` (killed) or `failed` (crashed). From the binary:

- `done`: the pty host exits with code 0; or the daemon retires an idle agent
  session (its `state.json` is terminal or its tempo is idle, nothing queued, no
  background task in flight) after 1 hour, 8 hours when it has a Remote Control
  bridge, or 60 seconds when the machine is low on memory; or the worker reports
  done on its socket; or, when the daemon was about to respawn a worker, it
  finds `state.json` already terminal with no queued prompt.
- `killed`: the daemon itself stopped the worker (`claude stop`, reaping).
- `crashed`: three exits within 5 s of each spawn, an exit before init, 20
  respawns in a row, the working directory is gone, or the launcher failed.
- Any other non-zero exit or signal of the worker is not a settle. The daemon
  schedules a respawn (10 s backoff) and resumes the same conversation.

## Results

| Cause (case)                                                       | Settled?                        | `daemon.log`                                                 | `agents --json --all`              | `state.json` / `timeline.jsonl`                                                                                                                                                                | Hooks                                                                  | Transcript end                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Normal end of turn (`idle`, 150 s)                                 | No                              | nothing                                                      | `status: idle, state: done`, pid   | `state: done`, `tempo: idle`, `inFlight` all 0, `firstTerminalAt` set; timeline gets a `done` line with the reply                                                                              | `Stop`, then `Notification` idle_prompt after 60 s                     | assistant text, `stop_hook_summary`, `turn_duration`                                                                   |
| Background Bash running at end of turn (`bgbash`)                  | No (180 s)                      | nothing                                                      | `status: busy, state: done`        | `state: done`, `inFlight.tasks: 1, kinds: [local_bash]`, `fan` has a `shell` item with no `doneAt`; when it ends, the daemon feeds the agent a new turn by itself (`UserPromptSubmit`, `Stop`) | `Stop` per turn                                                        | normal                                                                                                                 |
| Monitor running (`monitor`, 150 s)                                 | No                              | nothing                                                      | `status: busy, state: working`     | `state` stays **working** after the turn ended, `tempo: idle`, `inFlight.tasks: 1, kinds: [monitor]`, `fan` `monitor` item; the monitor line starts a new turn                                 | `Stop`, idle_prompt, then new turn                                     | normal                                                                                                                 |
| Background sub-agent running (`subagent`, 150 s)                   | No                              | nothing                                                      | `status: busy, state: working`     | `state: working`, `tempo: idle`, `fan` has an `agent` item and a `shell` item; a new turn starts when it finishes                                                                              | `Stop`, `SubagentStop` (parent's id)                                   | normal                                                                                                                 |
| API error: invalid model (`badmodel`)                              | No                              | nothing                                                      | `status: idle, state: failed`, pid | `state: failed`, `detail` = the error text; timeline `failed` line                                                                                                                             | **`StopFailure`**, not `Stop`                                          | assistant text flagged as an API error, then `turn_duration`                                                           |
| `claude stop` while working (`stop`)                               | Yes, `(killed)`                 | `bg settled <id> (killed)`                                   | `state: stopped`, no pid           | `state: stopped`, `detail: stopped`, unfinished `fan` item, `firstTerminalAt` slightly before `updatedAt`                                                                                      | `SessionEnd` (reason other), no `Stop`                                 | stops mid-turn (assistant `tool_use`, then bookkeeping)                                                                |
| SIGINT to REPL or pty host, working (`kill-INT-*`)                 | Yes, `(done)`, 0.2 s later      | `bg settled <id> (done)`                                     | `state: done`, no pid              | `state: done`, **`detail` still the last working detail**, unfinished `fan` item, `firstTerminalAt == lastTerminalAt == updatedAt` == settle time; timeline's last line is `working`           | `SessionEnd` (reason other), no `Stop`                                 | stops mid-turn, no `tool_result`, no `turn_duration`                                                                   |
| SIGINT while idle (`kill-INT-replPid-idle`)                        | Yes, `(done)`, about 7 s later  | `bg settled <id> (done)`                                     | `state: done`, no pid              | like a normal end of turn                                                                                                                                                                      | `SessionEnd`                                                           | normal end                                                                                                             |
| SIGKILL to REPL while idle (`kill-KILL-replPid-idle`)              | Yes, `(done)`, about 10 s later | `bg settled <id> (done)` only                                | `state: done`, no pid              | like a normal end of turn (daemon saw the terminal `state.json` and did not respawn)                                                                                                           | none new (`Stop` earlier)                                              | normal end                                                                                                             |
| SIGKILL to REPL or pty host, working (`kill-KILL-*`)               | No: respawned after about 13 s  | **nothing**                                                  | still `busy/working`, **new pid**  | `state: working`; the interrupted tool call runs again                                                                                                                                         | `SessionEnd` (pty host kill only), then `SessionStart` source `resume` | meta user message "Continue from where you left off ... automatically restarted after its process exited unexpectedly" |
| SIGTERM or SIGHUP to REPL or pty host, working (`kill-TERM/HUP-*`) | No: respawned after about 13 s  | **nothing**                                                  | still `busy/working`, new pid      | as above                                                                                                                                                                                       | `SessionEnd`, `SessionStart` (resume)                                  | same meta message                                                                                                      |
| `/exit` via `claude --bg --resume <sid> "/exit"` (`exit-resume`)   | No                              | nothing for the original; the copy only logs `claimed-spare` | original unchanged; a copy appears | the copy does not exit either                                                                                                                                                                  | none for the original                                                  | the copy ran `/exit` as a local command                                                                                |
| `/exit` typed in `claude attach` (`exit-attach`)                   | No                              | nothing                                                      | unchanged, `idle/done`             | unchanged                                                                                                                                                                                      | none                                                                   | unchanged; the terminal shows the `claude agents` dashboard                                                            |

Known from before, not redone: a real OOM kill of the whole daemon scope logged
`[supervisor] shutting down (cause=signal, ..., live_workers=2)`, and the next
daemon start logged `bg adopt: adopted=0 respawned=0 dead=2`.

## The `(done)` that appeared on its own

`(done)` means the REPL or its pty host exited with code 0, or the daemon
retired an idle agent session. Here SIGINT to either process reproduces it
exactly, mid-turn: the real case had the transcript end with an `api-request` 4
s before the settle, no error, `state: done` with an unfinished `fan` shell
item, and `firstTerminalAt` equal to the settle time. A graceful shutdown on
SIGINT is the only way found to get `(done)` in the middle of a turn. Who sent
the signal in the real case is not known. `/exit`, `claude attach`,
`claude --bg --resume ... /exit`, and background work never settled anything.

## Can `implement` tell the causes apart?

Yes for some, no for others.

- Still listed: working (`status: busy`), waiting on background work (`busy`
  with `inFlight.tasks > 0` or an unfinished `fan` item; `state` can say `done`
  or `working`), finished (`idle`/`done`), failed on an API error (`idle`/
  `failed`, `StopFailure` hook). None of these needs continuing, except
  `failed`.
- Respawned after SIGKILL, SIGTERM or SIGHUP: never leaves the listing and
  `daemon.log` says nothing. Only `SessionStart` with source `resume` (if
  `implement` adds that hook) or the "automatically restarted" message in the
  transcript shows it happened.
- Settled: `daemon.log` has the reason. `(killed)` is `claude stop` (or reaping)
  and `state: stopped`. `(done)` is ambiguous: it can follow a finished turn
  (retire, or an exit while idle) or a SIGINT mid-turn. To tell them apart:
  - the hook log: a `SessionEnd` after a `UserPromptSubmit` with no `Stop` in
    between means the turn was cut off; `implement`'s settings today only hook
    `Notification` and `UserPromptSubmit`, so it has nothing to see;
  - `timeline.jsonl`: last line `working` means cut off, `done` means finished;
  - the transcript: ends with `turn_duration` (finished) or with an assistant
    `tool_use`/`api-request` (cut off);
  - `state.json` alone: no, `state: done` in both cases; but `fan` items without
    `doneAt` and a `detail` that was never replaced show a cut-off turn.
- `(crashed)` could not be provoked here (it needs 3 fast crashes or 20
  respawns); the reason is only from the binary.

## Gaps

- A usage limit cannot be triggered on purpose, so what it leaves is unchecked.
- The idle retire after 1 h, 8 h or on low memory is from the binary, not run.
- Not checked: SIGQUIT, an out-of-memory kill of a single worker, a daemon
  upgrade restart, and `(crashed)`.
- The daemon never exited while an agent session was idle but alive: all 11
  `cause=idle_exit` lines in `daemon.log` have `live_workers=0`, the latest 5 s
  after the last worker settled. The daemon was not stopped for this.
