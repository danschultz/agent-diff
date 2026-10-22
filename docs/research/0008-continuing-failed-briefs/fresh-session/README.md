# fresh-session

Starts a new agent session in the kept scratch dir (standing in for the
worktree) of one that exited, with a prompt that summarises the task and the
work so far, without the old conversation.

## What it shows

`./run.sh`:

1. Starts a throwaway agent session as in `respawn/` (same helpers), kills its
   worker with `SIGKILL`.
2. `build-prompt.mjs` builds the prompt from only what `implement` can read
   without the old conversation: the scratch dir's files (names, sizes, and
   small files inline), the old transcript's last assistant text (it imports
   `lastAssistantText` from `tools/implement/src/claude.ts`), and `task.txt`,
   the task description. A real worktree would also give `git status`, `git log`
   and `git diff --stat`; the scratch dirs aren't git repos.
3. Starts a new agent session with implement's start flags
   (`--bg --remote-control <name> --name <name> --permission-mode auto --settings <file>`,
   plus `--model haiku`), using the same name as the dead one.
4. Prints a short summary: did it do the remaining work without redoing finished
   steps, was the codeword unknown (it must be), new session ID, name, Remote
   Control, hooks by session ID, first request usage next to the old session's
   first request.

Set `KEEP=1` to keep the agent sessions and scratch dir.

## Needs

Claude Code 2.1.308 logged in, Node 24+. No `jq`, no npm dependencies. The
scratch dir is `.claude/worktrees/ad8-fresh-session-<N>/` in this repo; override
with `W`, `N`, `SCRATCH`, `MODEL`. `AD8_REPO` overrides the repo root
`build-prompt.mjs` imports `claude.ts` from.

## Files

- `run.sh`, `build-prompt.mjs`, `task.txt`: the experiment. `lib.sh`,
  `jsontool.mjs`, `hook-log.mjs`: helpers.

## Result on Claude Code 2.1.308 (haiku)

- The new agent session read `progress.txt`, did not redo finished steps, did
  the rest and created `PR_OPENED`.
- It doesn't know the codeword (`CODEWORD_IS=unknown`), because that was only in
  the old conversation.
- New session ID and short ID. The same `--name` and `--remote-control` name
  were accepted while the dead agent session still existed. A new Remote Control
  session is registered. Hooks fire with the new session ID only.
- First request: about 13.5k tokens of cache creation plus the shared 26k prefix
  read from cache, against about 1.2k of creation and 52k read for resuming a
  53k-token conversation while the cache was warm.
- The agent can't tell which running process is the previous agent session's
  background command; it matched an unrelated `node` process.
