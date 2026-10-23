# Prototype: `claude --bg --resume <session-id>`

Continues a brief's agent session, after its worker was killed, with
`claude --bg --resume <session-id> "<prompt>"` and no other flags, exactly as
`resume()` in `tools/implement/src/claude.ts` does for reviews. A second variant
passes implement's start flags again, since `claude.ts` says that starts a copy
with a new ID. Tried with Claude Code 2.1.308.

## Run it

Needs `claude` 2.1.308 or later with the daemon, `node` 24 or later, `git`, and
a clean checkout of the repo (the scratch directory goes under
`.claude/worktrees/`).

```sh
./run.sh               # no other flags
./run.sh startflags    # also --remote-control --name --permission-mode --settings
AD8_MODE=stop ./run.sh # the first agent session is stopped with `claude stop`, not killed
AD8_MODE=midturn-stop ./run.sh # stopped while a foreground command runs
AD8_MODE=midturn ./run.sh      # killed while a foreground command runs
AD8_GAP=420 ./run.sh   # wait 7 minutes before continuing
```

Each starts `ad8-bg-resume-<n>` with `--model haiku`, waits until it is idle,
ends its worker, continues it, waits for `PR_OPENED`, prints a summary, and
removes everything it made. `AD8_NOTES=<file>` also appends the output to a
file. See `../common/lib.sh` for the other settings.

## What it showed

Killed while idle, then `claude --bg --resume <session-id> "<prompt>"`:

- It prints
  `note: woke session <id> with its saved options (--remote-control, --name, --permission-mode, --settings, --model).`
  and continues the same agent session: same session ID, short ID, name and
  transcript file. The turn works: the codeword was remembered and `PR_OPENED`
  was written.
- The saved options come from `respawnFlags` in
  `~/.claude/jobs/<short-id>/state.json`, which has implement's flags plus the
  model (`--model haiku` here, and the default model for a real brief). So the
  hooks from `--settings` fire (`SessionStart` with source `resume`,
  `UserPromptSubmit`, `Stop`, all with the same session ID), the permission mode
  is still `auto`, and the model is still haiku.
- Remote Control: `bridgeSessionId` is unchanged, and the transcript gets a new
  `bridge_status` entry saying `/remote-control` is active.
- `claude agents --json` doesn't list the dead worker, and `--all` shows it as
  `done` with no `status`. After the resume it is listed again as the same short
  ID.
- Nothing is logged in `~/.claude/daemon.log` when the worker is killed while
  idle. A `bg settled <short-id> (done)` line appears when the next `claude`
  command runs.
- The background command is not killed with the worker: the process kept running
  as an orphan. Claude Code tells the agent session its task "didn't finish
  before the previous session ended" and marks it `stopped`, so the agent
  sessions disagreed with `pgrep`.
- First request after continuing: about 1.1k to 1.3k cache-creation tokens and
  52.6k cache-read tokens. The same with a 7-minute gap before continuing, so
  the prompt cache outlived 5 minutes. The conversation was small.

After `claude stop` instead of a kill (what implement does for reviews), the
result is the same, plus a `SessionEnd` hook (reason `other`) when it stops, a
`bg settled <short-id> (killed)` line in the daemon log, and `bridge-session`
entries in the transcript.

With implement's start flags passed again (`./run.sh startflags`):

- It prints
  `note: background session <id> keeps its own saved options, so the flags you passed started a copy as <new id>.`
  So `claude.ts`'s comment is still true.
- The copy has a new session ID and short ID, and a new transcript that contains
  the conversation so far. The hooks fire (`SessionStart` with source `fork`),
  and the name is the same, but its `bridgeSessionId` is new, and `respawnFlags`
  has no `--model`. The original agent session stays `done`. Both are listed
  under the same name.

Killed while a foreground command runs (`AD8_MODE=midturn`): the daemon restarts
the worker by itself within about 15 seconds (`attempt: 2` in
`~/.claude/daemon/roster.json`, a `SessionStart` hook with source `resume`, and
a `SessionEnd` first if the pty host is the process that was killed). It adds a
tool result `Exit code 137`, then a user message: "Continue from where you left
off. Note: this session was automatically restarted after its process exited
unexpectedly; the user has not sent a new message since the restart. Re-verify
anything time-sensitive (branch state, running processes, prior partial work)
before continuing." The restarted agent session carries on. A
`claude --bg --resume` sent then, while it works, prints
`session <id> is already running in the background, so this started a copy as <new id>`,
and the copy has no hooks, no Remote Control and a generated name.

Stopped while a foreground command runs (`AD8_MODE=midturn-stop`): the daemon
doesn't restart it. On `--resume`, Claude Code adds a tool result
`[Tool call interrupted: the session ended before this call's result was recorded, ...]`
and a synthetic assistant message `No response requested.` before the new
prompt, then continues as above.
