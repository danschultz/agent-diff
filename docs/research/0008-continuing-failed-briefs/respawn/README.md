# respawn

Tries `claude respawn <id>` ("Restart a background session ... so it picks up
the current Claude binary") on an agent session whose worker was killed with
`SIGKILL`, and then tries to give it a prompt with
`claude --bg --resume <session-id> "<prompt>"`.

## What it shows

`./run.sh` (kill while the agent session is idle):

1. Starts a throwaway agent session with implement's start flags plus
   `--model haiku`, with hooks from a generated `settings.json` that log to
   `hooks.jsonl` in the scratch dir. Its first prompt gives a codeword, starts a
   15-minute background Bash command, writes `progress.txt` and ends the turn.
   It starts again until the agent session's `state` in `claude agents --json`
   is `done`, because the daemon restarts a worker killed while the state is
   `working` by itself (see `lib.sh`, `start_until_done`).
2. Kills the worker (`pid` and `replPid` from `~/.claude/daemon/roster.json`)
   with `SIGKILL`.
3. Runs `claude respawn <id>` and records whether it comes back, under which
   IDs, with which hooks and Remote Control, and whether it starts a turn.
4. Runs `claude --bg --resume <session-id> "<prompt>"` with a prompt that asks
   for the codeword, whether the background command is still running, and then
   creates `PR_OPENED`.

`MODE=midturn ./run.sh` kills the worker in the middle of a turn instead, and
records how the daemon restarts it without `claude respawn`.

It prints a short summary (continued yes/no, session ID same/different, codeword
remembered, hooks by session ID, background command state, first request usage)
and removes its agent sessions and scratch dir. Set `KEEP=1` to keep them.

## Needs

Claude Code 2.1.308 logged in, Node 24+, a running or startable Claude Code
daemon, `~/.claude/daemon/roster.json`. No `jq`, no npm dependencies. The
scratch dir is `.claude/worktrees/ad8-respawn-<N>/` in this repo (ignored by
git, trusted by Claude Code); override with `W`, `N`, `SCRATCH`, `MODEL`. It
never touches other agent sessions.

## Files

- `run.sh`: the experiment. `lib.sh`, `jsontool.mjs`, `hook-log.mjs`: helpers,
  the same in all three prototypes.

## Result on Claude Code 2.1.308 (haiku)

- `claude respawn <id>` works on an agent session whose worker was killed while
  idle: same short ID, session ID, name and Remote Control registration, with
  its saved options (`respawnFlags`: hooks from `--settings`, permission mode,
  model). It does not start a turn: the agent session comes back idle
  (`SessionStart` hook with `source: resume`, no `UserPromptSubmit`, no API
  request). Its background command was not stopped by the kill, but the
  respawned agent session is told it was stopped.
- `claude --bg --resume <session-id> "<prompt>"` after the respawn starts a copy
  ("session is already running"): new session ID, auto-generated name, no saved
  options, so no hooks and no Remote Control. The copy has the whole
  conversation and does the work. Without the respawn, the same command wakes
  the killed session "with its saved options".
- A worker killed in the middle of a turn is restarted by the daemon within
  about 13 seconds, without `claude respawn`, and is told "Continue from where
  you left off ... automatically restarted after its process exited
  unexpectedly".
