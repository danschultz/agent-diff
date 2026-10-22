# attach

Tries `claude attach <id>` on an agent session whose worker was killed with
`SIGKILL`. `claude stop`'s help says "resume it later with
`claude attach <id>`". `attach` needs a terminal, so `run.sh` drives it in its
own tmux server (`tmux -L ad8-attach`) with `send-keys`.

## What it shows

`./run.sh`:

1. Starts a throwaway agent session as in `respawn/` (same helpers; it also
   starts again until the `state` is `done`), kills its worker with `SIGKILL`,
   and checks it is gone from `claude agents --json`.
2. Runs `claude attach <id>` in a detached tmux pane, waits for the input box,
   and types the prompt (codeword, whether the background command still runs,
   then create `PR_OPENED`).
3. Presses Left to leave to the agent view, then kills the tmux server, and
   checks the agent session is still listed and running.
4. Prints a short summary: same session ID and short ID, listed again, hooks by
   session ID, Remote Control (`bridgeSessionId`, `bridge_status` entries),
   usage of the first request after the prompt.

Set `KEEP=1` to keep the agent session and scratch dir.

## Needs

Claude Code 2.1.308 logged in, Node 24+, `tmux`. No `jq`. A script can only use
`attach` through a pseudo-terminal such as tmux, and has to wait for the screen
("/rc connecting..." first) before it types. The scratch dir is
`.claude/worktrees/ad8-attach-<N>/` in this repo; override with `W`, `N`,
`SCRATCH`, `MODEL`.

## Files

- `run.sh`: the experiment. `lib.sh`, `jsontool.mjs`, `hook-log.mjs`: helpers,
  the same in all three prototypes.

## Result on Claude Code 2.1.308 (haiku)

- `claude attach <id>` on an agent session whose worker was killed brings it
  back as a background agent session: same short ID, session ID, name and Remote
  Control session, hooks from its saved `--settings` loaded (`SessionStart` with
  `source: resume`), listed in `claude agents --json` again. It is idle until a
  prompt is typed.
- A prompt typed with `tmux send-keys` runs at once, with the whole conversation
  (codeword remembered).
- Left leaves to the agent view. After the terminal is gone the agent session is
  still listed and alive, so a pseudo-terminal is only a viewer.
- Typing too early loses the prompt: wait for `SessionStart` (resume) and the
  input box before sending keys.
