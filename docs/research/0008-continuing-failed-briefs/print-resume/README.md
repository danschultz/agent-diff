# Prototype: print mode, `claude -p --resume <session-id>`

Continues a brief's agent session, after its worker was killed, in print mode:
`claude -p --resume <session-id> "<prompt>"`. It then checks
`claude -p --continue`, and that a later `claude --bg --resume` of the same
session ID sees the print-mode turn. Tried with Claude Code 2.1.308.

## Run it

Needs `claude` 2.1.308 or later with the daemon, `node` 24 or later, `git`, and
a clean checkout of the repo (the scratch directory goes under
`.claude/worktrees/`).

```sh
./run.sh
```

It starts `ad8-print-resume-1` with `--model haiku`, waits until it is idle,
kills its worker with `SIGKILL`, then:

1. runs
   `claude -p --output-format json --resume <session-id> --permission-mode auto --settings <file> --model haiku "<prompt>"`
   in the scratch directory;
2. runs `claude -p --continue` with only that conversation in the directory;
3. starts a second conversation in the directory (the decoy), and runs
   `claude -p --continue` again;
4. runs `claude --bg --resume <session-id>` and asks what it remembers.

It prints a summary and removes everything it made. `AD8_NOTES=<file>` also
appends the output to a file. See `../common/lib.sh` for the other settings.

## What it showed

- Continued: yes. The codeword was remembered and `PR_OPENED` was written.
- Print mode keeps the session ID, and writes to the same transcript file. The
  agent session's short ID, name and `state.json` are untouched: it stays `done`
  in `claude agents --json --all`, with no live process, and
  `claude agents --json` doesn't list the print-mode process afterwards.
- It reads none of the saved options (`respawnFlags`). The command had to pass
  `--permission-mode auto` and `--settings` again, and `--model` too (Claude
  Code's default is Opus; whether print mode restores the conversation's model
  without `--model` wasn't tried, to avoid running Opus). With them, hooks fire
  (`SessionStart` with source `resume`, `UserPromptSubmit`, `Stop`, and
  `SessionEnd`, all with the same session ID) and the permission mode is `auto`.
- No Remote Control: print mode adds no `bridge_status` entry. The old
  `bridgeSessionId` stays in `state.json`, but no process holds it.
- `--continue` picks the most recently modified conversation for the directory.
  With one conversation there, it picked the right one. After a second
  conversation was started in the same directory, it picked that one and said
  the codeword was `UNKNOWN`. In a brief's worktree, anything that runs `claude`
  there, such as a review or a sub-process, changes the answer.
- A `claude --bg --resume <session-id>` afterwards woke the same agent session
  with its saved options, and it answered that an earlier message said "Your
  agent session exited before you finished": it sees the print-mode turn. Same
  short ID, same session ID, same bridge.
- First request after continuing: about 2.1k cache-creation tokens and 52.7k
  cache-read tokens (print mode's own summary counts two requests: 2.3k and
  107k). The conversation was small and the prompt cache warm.
- Print mode waits for the turn to finish, so the caller gets the reply as the
  command's output, but the process blocks for the whole turn.
