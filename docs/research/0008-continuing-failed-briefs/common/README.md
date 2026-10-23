# Shared steps for the 0008 prototypes

The four option directories next to this one each run the same experiment
through `lib.sh`:

1. Start a throwaway agent session with implement's start flags
   (`--bg --remote-control <name> --name <name> --permission-mode auto --settings <file>`)
   plus `--model haiku`. The first prompt gives it a codeword, has it start a
   background command that runs for 15 minutes, write `progress.txt`, and end
   its turn.
2. Wait until it is idle, then record its short ID, session ID, whether
   `bridgeSessionId` is in `~/.claude/jobs/<short-id>/state.json`, and
   `respawnFlags`.
3. End its worker: `kill -9` of the claude process (`replPid` in
   `~/.claude/daemon/roster.json`), or `claude stop`.
4. The option's `run.sh` continues the agent session, then `ad8_report` prints
   what changed.

| File                     | What it does                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `lib.sh`                 | The steps above, and cleanup. The settings are environment variables, listed at the top of the file.                |
| `settings.template.json` | Hooks for `SessionStart`, `UserPromptSubmit`, `Notification`, `Stop` and `SessionEnd`, filled in by `lib.sh`.       |
| `hook.mjs`               | The hook command. Appends one JSON line (event, session ID, time, `stop_hook_active`) to a log file.                |
| `inspect.mjs`            | Summarises a transcript: entry types before and after the continue prompt, permission modes, bridge entries, usage. |
| `agents.mjs`             | Turns `claude agents --json` into tab-separated lines.                                                              |
| `jobstate.mjs`           | Reads `state.json` without printing the bridge session ID.                                                          |
| `roster.mjs`             | Reads a worker's PIDs from `~/.claude/daemon/roster.json`.                                                          |
| `printresult.mjs`        | Summarises `claude -p --output-format json`.                                                                        |

The scratch directory is `<repo>/.claude/worktrees/ad8-<option>-<n>`: a plain
directory, not a git repo, under a path the repo's `.gitignore` ignores and
Claude Code already trusts. Nothing the scripts print includes tokens, bridge
session IDs, or transcript text, except the agent session's last reply to the
codeword prompt.

These are throwaway experiments against Claude Code 2.1.308, not code to build
on. They start agent sessions in the daemon, which use usage.
