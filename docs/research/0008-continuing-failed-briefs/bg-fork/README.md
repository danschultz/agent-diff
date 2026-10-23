# Prototype: `claude --bg --resume <session-id> --fork-session`

Continues a brief's agent session, after its worker was killed, with
`claude --bg --resume <session-id> --fork-session "<prompt>"`. The conversation
is copied into a new agent session with a new session ID and short ID. Tried
with Claude Code 2.1.308.

## Run it

Needs `claude` 2.1.308 or later with the daemon, `node` 24 or later, `git`, and
a clean checkout of the repo (the scratch directory goes under
`.claude/worktrees/`).

```sh
./run.sh
```

It starts `ad8-bg-fork-1` with `--model haiku`, waits until it is idle, kills
its worker with `SIGKILL`, runs the command above, waits for the new agent
session to write `PR_OPENED`, prints a summary, and removes everything it made.
Set `AD8_NOTES=<file>` to also append the output to a file, `AD8_MODE=stop` to
stop the first agent session with `claude stop` instead of killing it, and see
`../common/lib.sh` for the other settings.

## What it showed

- Continued: yes. The new agent session answered the codeword, and wrote
  `PR_OPENED`.
- The session ID and short ID are new. The original agent session stays in
  `claude agents --json --all` as `done`, with its transcript unchanged.
- No note is printed, unlike `--resume` without `--fork-session`.
- Settings are not carried over: `respawnFlags` in the new agent session's
  `state.json` is `[]`, so the `--settings` file's hooks did not fire at all (no
  `SessionStart`, no `UserPromptSubmit`, no `Stop` in the hook log). implement's
  `Notification` and `UserPromptSubmit` hooks would not run.
- No Remote Control: no `bridgeSessionId`, no `bridge_status` entry.
- The name is not kept: the new agent session gets a generated title, such as
  "pr_opened test marker".
- The permission mode (`auto`) and the model (haiku, not the default Opus) were
  kept, because they come from the conversation, not from `respawnFlags`.
- The background command, started by the original agent session, kept running as
  an orphan. Claude Code told the new agent session it was `stopped`, but a
  check found the process.
- First request after continuing: about 1.1k cache-creation tokens and 52.7k
  cache-read tokens. The conversation was small and the prompt cache warm.

To keep the settings, name and Remote Control, the start flags would have to be
passed again, which makes the fork a new agent session in every way that matters
to implement. The tool would also have to record the new session ID.
