# Prototype: interactive `claude --resume`

Continues a brief's agent session, after its worker was killed, the way Dan did
by hand: an interactive (not `--bg`)
`claude --resume <session-id> --permission-mode auto --settings <file>` in a
terminal. The terminal is a tmux server on its own socket,
`tmux -L ad8-interactive-resume`, and the prompt is typed with `tmux send-keys`.
Tried with Claude Code 2.1.308.

## Run it

Needs `claude` 2.1.308 or later with the daemon, `node` 24 or later, `git`,
`tmux`, and a clean checkout of the repo (the scratch directory goes under
`.claude/worktrees/`).

```sh
./run.sh
```

It starts `ad8-interactive-resume-1` with `--model haiku`, waits until it is
idle, kills its worker with `SIGKILL`, starts the interactive `claude --resume`
in tmux, types the prompt, waits for `PR_OPENED`, prints a summary, and exits
the agent session with `/exit`. It then kills its tmux server and removes
everything it made. No `--model` is given to the interactive `claude`, as in
Dan's command: the script stops if the header shows Opus, Claude Code's default.
`AD8_NOTES=<file>` also appends the output to a file; `AD8_TMUX_SOCKET` changes
the socket name. See `../common/lib.sh` for the other settings.

## What it showed

- Continued: yes. The codeword was remembered and `PR_OPENED` was written.
- Same session ID and transcript file. The name (`ad8-interactive-resume-1`) and
  permission mode (`auto`) are kept. The model is kept too: the header showed
  Haiku without `--model`.
- Hooks from `--settings` fired, with the same session ID: `SessionStart`
  (source `resume`), `UserPromptSubmit`, `Stop`, and `SessionEnd` (reason
  `prompt_input_exit`) on `/exit`.
- Remote Control is not registered again. `--remote-control` wasn't passed, and
  the transcript got no new `bridge_status` entry. The old `bridgeSessionId` is
  still in the background agent session's `state.json`, which no longer has a
  process.
- `claude agents --json` lists the interactive agent session, with
  `kind: "interactive"`, a PID, `status: idle`, no short ID, and the same
  session ID. `--all` lists it next to the old background entry, which stays
  `done`, so two entries share one session ID. `claude stop`, `claude attach`
  and implement's `running()` can't address it by short ID.
- Claude Code showed "Background shell command didn't finish before the previous
  session ended" on start, though the process was still running.
- After the turn Claude Code asked "Teach auto mode about your environment?".
  Escape dismisses it without changing any setting. A person has to be at the
  terminal for that, and for the trust and resume prompts.
- First request after continuing: about 1.9k cache-creation tokens and 52.8k
  cache-read tokens. The conversation was small and the prompt cache warm.
