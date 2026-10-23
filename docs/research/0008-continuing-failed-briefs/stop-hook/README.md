# Stop hook: keep an agent session from ending without a pull request

Tested on Claude Code 2.1.308, 2026-10-22, with haiku.

`implement` could add a `Stop` hook to the settings file it passes with
`--settings`. When the agent session tries to end its turn and the brief has no
pull request yet, the hook blocks the stop with a reason, and Claude Code starts
another turn in the same agent session. This prototype is that hook, plus
scripts that run throwaway agent sessions to check how it behaves.

## Files

| File                     | What it does                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stop-hook.mjs`          | The hook. Node, no dependencies. On `Stop` it applies the policy below. On every other event it registered for, it only appends a JSON line to the log.                  |
| `settings.template.json` | Hooks for `SessionStart`, `UserPromptSubmit`, `Notification`, `Stop`, `SubagentStop`, `StopFailure` and `SessionEnd`, all running `stop-hook.mjs`. `run.sh` fills it in. |
| `run.sh <case>`          | Starts a throwaway `claude --bg` agent session with implement's start flags and `--model haiku`, waits, prints the results, and cleans up.                               |
| `usage.mjs`              | Summarises a transcript: entry kinds, and each API response's `usage`, marked by which block it follows. Prints no message text.                                         |

## Run it

```sh
./run.sh 1          # one case, about 1 minute
KEEP=1 ./run.sh 2   # keep the scratch directory and agent session to look at
MAX_BLOCKS=5 HOOK_OPTS="--daemon-blocked on" ./run.sh 3c
```

Needs `claude` 2.1.308 and Node 24+. Scratch directories are plain directories
under `<repo>/.claude/worktrees/ad8-stop-hook-<case>-<n>`, which git ignores and
Claude Code already trusts. Each case starts one haiku agent session. Several
cases can run at once.

Cases (each prints the hook log, `claude agents` state, `state.json` and the
transcript summary):

| Case | Agent session is told to...                                                                       |
| ---- | ------------------------------------------------------------------------------------------------- |
| 1    | write `step1.txt` and end its turn; the task also needs `PR_OPENED` (stands for the pull request) |
| 2    | write `step1.txt`, never create `PR_OPENED`, end its turn                                         |
| 2c   | like 2 and use no tools afterwards; run with `MAX_BLOCKS=20 HOOK_OPTS="--question off"`           |
| 3a   | create `NEEDS_INPUT`, then end its turn with a question                                           |
| 3b   | end its turn with a question ending in `?`, no marker                                             |
| 3c   | end its turn with a request that isn't phrased as a question, no marker                           |
| 3d   | finish step 1, ending with the courtesy question "Let me know if you need anything else?"         |
| 3e   | ask a question, then add a sentence that doesn't end in `?`                                       |
| 3f   | end with a line `Needs input: ...`                                                                |
| 4    | start a 45 s background command, end its turn; create `PR_OPENED` when told it finished           |
| 5    | create `PR_OPENED`, end its turn                                                                  |
| 6    | run a foreground sub-agent, then create `PR_OPENED`                                               |

## The policy

`stop-hook.mjs --log <file> [--max-blocks 3] [--question on|off] [--background input|jobstate|off] [--daemon-blocked on|off]`.
On `Stop`, the first rule that matches wins:

1. `PR_OPENED` exists in the agent session's `cwd`: allow (`pr`).
2. `NEEDS_INPUT` exists: allow (`needs-input`).
3. The last assistant message ends with `?`: allow (`question`).
4. `--daemon-blocked on` and the job's `state.json` says `state: "blocked"`:
   allow (`daemon-blocked`). Off by default: it reads daemon internals.
5. Background work is still running: allow (`background`). By default this reads
   `background_tasks` in the hook input. `--background jobstate` reads
   `inFlight` and `fan` in `~/.claude/jobs/<short-id>/state.json` instead.
6. This agent session has already been blocked `--max-blocks` times, counted in
   `<cwd>/.stop-hook/blocks-<session_id>`: allow (`limit`).
7. Otherwise count the block and print
   `{"decision":"block","reason":"No pull request yet. Finish the remaining verification steps, self-review, push and open the draft pull request, or ask Dan if you are blocked."}`.

`SubagentStop` is only logged, never blocked.

## What the docs say (2026-10-22, https://code.claude.com/docs/en/hooks)

- `Stop` "runs when the main Claude Code agent has finished responding. Does not
  run if the stoppage occurred due to a user interrupt. API errors fire
  `StopFailure` instead."
- Input, besides `session_id`, `transcript_path`, `cwd`, `permission_mode`,
  `prompt_id`, `effort`, `scratchpad_dir`: `stop_hook_active`,
  `last_assistant_message`, `background_tasks` and `session_crons`.
  `stop_hook_active` "is `true` when Claude Code is already continuing as a
  result of a stop hook. Check this value or process the transcript to avoid
  blocking on a condition that will never resolve." The docs recommend
  `last_assistant_message` over reading the transcript, which may lag.
- `background_tasks` entries have `id`, `type` (`shell`, `subagent`, `monitor`,
  `workflow`, `teammate`, `cloud session`, `MCP task`), `status`, `description`,
  and `command` for shells. The docs say the arrays let a hook tell "session is
  done" from "session is paused waiting for background work to wake it back up".
- Blocking: print `{"decision":"block","reason":"..."}` and exit 0, or exit 2
  with the reason on stderr. `hookSpecificOutput.additionalContext` also
  continues the conversation and is labelled "Stop hook feedback" instead of a
  hook error.
- Loops: "Claude Code applies an 8-consecutive-continuation cap: after stop
  hooks have continued the turn eight times in a row, Claude Code overrides the
  next block and ends the turn. The count resets each time Claude calls a tool."
  The cap is raised with `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`.
- `SubagentStop` runs when a sub-agent finishes, with `agent_id`, `agent_type`,
  `agent_transcript_path`, `last_assistant_message`. Blocking it keeps the
  sub-agent running. It also fires for internal agents (prompt suggestions,
  `/btw`).
- `StopFailure` "runs instead of `Stop` when the turn ends due to an API error".
  Its output and exit code are ignored. `error` is one of `rate_limit`,
  `overloaded`, `authentication_failed`, `oauth_org_not_allowed`,
  `account_on_hold`, `billing_error`, `invalid_request`, `model_not_found`,
  `server_error`, `max_output_tokens`, `cloud_credential_error`, `unknown`. The
  docs say nothing specific about usage limits.

The observations below agree with the docs. Nothing contradicted them.

## Results

All with `--max-blocks 3` unless noted. "Extra turns" are the API responses
after a block (the agent's reply to the block reason, including tool calls).

| Case              | What happened                                                                                                                                                                                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                 | Stop 1 blocked. The agent session continued, created `PR_OPENED`, and Stop 2 was allowed (`pr`). 1 block, 2 extra responses, 5 to 7 s from block to the next `Stop`. Without the marker named in the prompt, the agent didn't know what to do and was blocked 3 times (first trial): the reason has to say what finishing means.       |
| 2                 | Blocked 3 times, then allowed (`limit`) on the fourth `Stop`. The agent session ends idle with `state: "done"` or `"blocked"` (the daemon's reading of its last message), no `PR_OPENED`, hook log shows no further `Stop`. It stays alive and resumable.                                                                              |
| 2 with 12 blocks  | The agent worked out from the settings file that `NEEDS_INPUT` ends the loop, created it after 7 blocks, and was allowed. An agent can read the hook script.                                                                                                                                                                           |
| 2c with 20 blocks | `?` check off, so only Claude Code's own cap applies. The hook said block 9 times (`blocks_so_far` 0 to 8). Claude Code continued 8 times and ignored the ninth block: 9 `Stop` events, then the turn ended, state `done`/`idle`. The `?` check on: the agent asked a question on the third try and was allowed.                       |
| 3a                | `NEEDS_INPUT` created by the agent before asking: allowed at once (`needs-input`). `Notification` `idle_prompt` came 60 s later.                                                                                                                                                                                                       |
| 3b                | Question ending in `?`, no marker: allowed (`question`).                                                                                                                                                                                                                                                                               |
| 3c                | Request without `?`, no marker: blocked 3 times, then `limit`. The agent answered each block with "I'm blocked, I need the color". With `--daemon-blocked on`: allowed at once.                                                                                                                                                        |
| 3d                | Courtesy question "anything else?" after finishing: allowed (`question`). A false positive; the daemon's `state` also became `blocked`.                                                                                                                                                                                                |
| 3e                | Question followed by "I will wait for your answer.": blocked once (a false negative), then the agent's reply ended in `?` and was allowed.                                                                                                                                                                                             |
| 3f                | `Needs input: ...` line, no `?`: `state` was `blocked` at the first `Stop`. The hook blocked 3 times (`?` check only), allowed at once with `--daemon-blocked on`.                                                                                                                                                                     |
| 4                 | First `Stop` allowed (`background`): `background_tasks` had `shell:running`. The agent session stayed `working` (`state.json` `tasks: 1`). About 45 s later the daemon started a new turn by itself (`UserPromptSubmit`, a `<task-notification>` user entry), the agent created `PR_OPENED`, and the second `Stop` was allowed (`pr`). |
| 5                 | `PR_OPENED` created: allowed at once, 0 blocks.                                                                                                                                                                                                                                                                                        |
| 6                 | `SubagentStop` fired once (`agent_type: general-purpose`, same `session_id`) and was not blocked. The main agent's `Stop` was blocked 3 times, then allowed once `PR_OPENED` existed. No `Stop` ever carried an `agent_id`.                                                                                                            |

### `stop_hook_active` across repeated blocks

`false` on the first `Stop` of a turn, `true` on every later `Stop` in the same
turn, however many blocks and tool calls came between, even after the agent ran
tools and `PR_OPENED` appeared (case 6). It goes back to `false` when a new turn
starts (case 4: the turn the daemon started after the background command
finished). So it can't be the loop guard alone: "block only if not
`stop_hook_active`" would allow one block per turn. Count blocks in a file keyed
by `session_id`, as the hook does. Claude Code's own cap of 8 consecutive
continuations is a second guard, observed in 2c.

### What the hook receives on `Stop`

`background_tasks, cwd, effort, hook_event_name, last_assistant_message, permission_mode, prompt_id, scratchpad_dir, session_crons, session_id, stop_hook_active, transcript_path`.
No `agent_id` or `agent_type` on the main agent's `Stop`.

### How the block shows up

In the transcript, a block is a meta user entry carrying the reason, an
`attachment` of type `hook_blocking_error`, and a `system` entry
`stop_hook_summary`. The daemon's `timeline.jsonl` and `state.json` stay
`working` or show `done` between blocks; it doesn't settle.

### Cost of the extra turns

Each extra turn re-reads the whole context from the prompt cache. With haiku's
roughly 50k-token start (system prompt, tools, skills), an extra turn costs
about 50k to 57k `cache_read_input_tokens` (growing about 0.7k per turn), 0.4k
to 1k `cache_creation_input_tokens`, 150 to 660 `output_tokens` and 2
`input_tokens`. Measured over all responses after the first block:

| Case                            | Blocks | Responses | `cache_read` | `cache_creation` | `output` |
| ------------------------------- | ------ | --------- | ------------ | ---------------- | -------- |
| 1 (finishes after 1 block)      | 1      | 2         | 101,941      | 1,086            | 594      |
| 2                               | 3      | 3         | 158,261      | 2,008            | 1,060    |
| 3c                              | 3      | 3         | 122,474      | 2,364            | 1,173    |
| 6                               | 3      | 5         | 270,049      | 5,001            | 1,428    |
| 2 with 12 blocks (stopped at 7) | 7      | 9         | 496,314      | 8,647            | 3,751    |
| 2c, cap reached                 | 8      | 8         | 431,939      | 3,911            | 1,190    |

A block costs seconds (4 to 8 s per extra turn) and cache reads, with no fresh
input. Blocks come within seconds of the turn, so the prompt cache is always
warm for them. Bigger models cost more per cache read; a real brief's context is
larger than these.

### Detecting that the agent session is asking a question

- Marker file: needs the agent to create it before asking; `implement`'s
  `Notification` hook can't set it in time. `idle_prompt` fires 60 s after each
  `Stop` (seen in 3a, 3b, 3c, 4 and 2c: 08:05:33 `Stop`, 08:06:33
  `idle_prompt`), so when the `Stop` hook runs, a brief's `agent=needs-input`
  from that hook doesn't exist yet. No `agent_needs_input` notification reached
  the hooks in any case.
- `last_assistant_message` ends with `?`: right in 3a, 3b and 3d (a false
  positive: a closing courtesy question), wrong in 3c, 3e (first reply) and 3f
  (a request or a marker line without `?`). Cheap, but a haiku agent often ends
  a message with a statement after its question. An agent that is blocked and
  told to ask Dan usually ends with a `?` the second or third time.
- The daemon's own reading (internals): before the `Stop` hook runs, the daemon
  has already set `state.json` `state` to `blocked` (and `tempo: blocked`) for
  3a, 3b, 3c, 3d, 3e and 3f, and `done` for 1, 2 (first replies), 4 and 5. The
  hook can read it from `~/.claude/jobs/<short-id>/state.json`, found by
  matching `sessionId`. It is a regex heuristic in the binary (`trailing-q`,
  `awaiting-user`, `ask-verb`, and marker lines `Needs input: ...`,
  `Blocked: ...`, `I'm blocked: ...`, `Failed: ...`, `Result: ...`), so it has
  the same kind of false positives as the `?` check (3d), but it also catches
  3c, 3e and 3f. A brief that tells the agent to end a question with a
  `Needs input: <what>` line makes it dependable. It is not documented and may
  change.
- A fourth way, not tried: the prompt tells the agent to create the marker, or
  to run a command that sets `agent=needs-input`, before it asks.

### Detecting background work

- `background_tasks` in the hook input (documented): `shell:running` in case 4.
  Types seen: `shell`. The docs list `subagent`, `monitor`, `workflow` too; only
  `shell` was tested here. The array is empty when nothing runs. The docs say it
  is absent when the task registry can't be reached, and the hook then falls
  through to blocking.
- `~/.claude/jobs/<short-id>/state.json` `inFlight.tasks` and `fan` entries
  without `doneAt` (daemon internals): `tasks=1 kinds=local_bash fan=shell` in
  case 4, the same answer. `--background jobstate` uses it.
- While a background command runs, `state.json` `state` is `working`, so the
  `claude agents` state alone also says the agent session isn't done.
- After the command ended, the daemon woke the agent session and `Stop` fired
  again with `background_tasks` empty; with no `PR_OPENED` the hook would block
  then.

### Sub-agents

`Stop` does not fire for sub-agents; `SubagentStop` does (case 6), with
`agent_id`, `agent_type` and the parent's `session_id`. Registering the hook
only under `Stop`, as `implement` would, can't block the self-review sub-agent.
`SubagentStop` entries in `settings.json` here only log.

### Not tested

- Usage limits and `StopFailure`: not triggered (no usage limit was hit). An
  invalid model was seen to fire `StopFailure` instead of `Stop` by the
  `exit-causes` experiment. The binary maps `billing_error` to `state: blocked`
  ("usage limit reached") and `rate_limit` to `blocked` ("rate limited"), so a
  `Stop` hook never sees those turns.
- User interrupts: `exit-causes` saw `SessionEnd` and no `Stop` after SIGINT.
- `additionalContext` instead of `decision: block`, and exit code 2: not run;
  the docs say they share the loop protections.
- Whether a real brief's agent session, with a long context and a real
  pull-request step, behaves like these haiku agents.

## What this shows about the option

- It works with the documented hook API and `--settings`, with no new flags, and
  keeps the agent session, its conversation and Remote Control. No resume is
  involved.
- It only covers agent sessions that reach `Stop` without a pull request. It
  does nothing for a worker or daemon that's killed, or for a turn ended by an
  API error (`StopFailure`).
- An agent session that is really blocked uses a turn per block, about 50k
  cache-read tokens each for these small contexts, and answers "I'm blocked".
  With a limit, it still ends without a pull request, so the brief can still
  fail.
