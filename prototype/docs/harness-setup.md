# Trying the feedback loop with a real agent

None of these changes have been made for you. Each one is a file or setting
outside the prototype that you'd change to try the loop with Claude Code,
Cursor, cmux, or tmux. Undo them by removing what you added.

The examples use the prototype's absolute path:

```sh
AD=/Users/danschultz/Development/demos/agent-diff/prototype/bin/agent-diff
```

Hooks call `bin/agent-diff` by absolute path, so nothing needs to change on
your `PATH`. If the agent's shell doesn't have Node 26 on its `PATH`, set
`AGENT_DIFF_NODE` to a Node 26 binary in the environment the agent runs in.

All hooks exit 0 and print nothing when no review server is running, so
leaving them installed is harmless.

## How the pieces fit

1. Hooks register the [agent session](../../docs/glossary.md#agent-session)
   when it starts, using the harness's ID for it (Claude Code's
   `session_id`, Cursor's `conversation_id`) and the workspace it's in.
2. At the start of each turn, the hooks tell the review server the agent is
   busy, and the server records a turn snapshot if the workspace is in an
   open review session.
3. When you submit a review, the server sends a notification to each
   registered agent session on that workspace. If the agent session is
   mid-turn, the notification is held.
4. At the end of a turn, the Stop hook checks for feedback. If there is
   some, Claude Code keeps going with the notification as its instructions,
   and Cursor submits it as a follow-up message. Without a hook that can do
   that, the server types the notification into the agent's terminal through
   cmux or tmux.
5. The agent runs `agent-diff feedback`, addresses the comments, and the
   review UI updates as it edits.

## Claude Code

Add hooks to the settings of the repo you're reviewing, in
`.claude/settings.local.json` (not committed), or to `~/.claude/settings.json`
for every repo:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "/Users/danschultz/Development/demos/agent-diff/prototype/bin/agent-diff hook claude SessionStart" }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "/Users/danschultz/Development/demos/agent-diff/prototype/bin/agent-diff hook claude UserPromptSubmit" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "/Users/danschultz/Development/demos/agent-diff/prototype/bin/agent-diff hook claude Stop" }] }
    ]
  },
  "permissions": {
    "allow": [
      "Bash(/Users/danschultz/Development/demos/agent-diff/prototype/bin/agent-diff feedback:*)",
      "Bash(/Users/danschultz/Development/demos/agent-diff/prototype/bin/agent-diff start:*)"
    ]
  }
}
```

What each hook does:

- `SessionStart` registers the agent session and adds a short paragraph to
  Claude's context about how to fetch feedback and how to ask for a review.
- `UserPromptSubmit` marks the start of a turn and records a turn snapshot.
  If feedback is already waiting, it adds the notification to the prompt's
  context.
- `Stop` marks the end of a turn. If feedback is waiting, it blocks the stop
  with the notification as the reason, so Claude continues and fetches it.
  It doesn't block again while `stop_hook_active` is set.

To test terminal delivery instead of the Stop hook, add `--no-wake` to the
`Stop` and `UserPromptSubmit` commands. Held notifications are then typed
into the terminal after the turn ends.

## Cursor

Add `.cursor/hooks.json` to the repo you're reviewing, or
`~/.cursor/hooks.json` for every repo:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "command": "/Users/danschultz/Development/demos/agent-diff/prototype/bin/agent-diff hook cursor sessionStart" }],
    "beforeSubmitPrompt": [{ "command": "/Users/danschultz/Development/demos/agent-diff/prototype/bin/agent-diff hook cursor beforeSubmitPrompt" }],
    "stop": [{ "command": "/Users/danschultz/Development/demos/agent-diff/prototype/bin/agent-diff hook cursor stop", "loop_limit": 3 }]
  }
}
```

- `sessionStart` registers the agent session and adds the same paragraph to
  its context.
- `beforeSubmitPrompt` marks the start of a turn and records a turn
  snapshot. Cursor doesn't let this hook add context, so it always allows
  the prompt.
- `stop` sends the notification as a follow-up message when the agent
  finished normally and feedback is waiting.

The limitation: an idle agent in the Cursor IDE can't be woken. A review
submitted while it's idle shows the `pull` status, and the review's card
shows the message to paste into the chat. The agent's next turn end also
picks it up.

If you've turned on Cursor's support for Claude Code hooks, Cursor may also
run the Claude Code hooks above. Configure one or the other for a repo, not
both.

## cmux

Run the agent in a cmux terminal surface. cmux sets `CMUX_SURFACE_ID` there,
and the hooks register the agent with `cmux:$CMUX_SURFACE_ID` as its notify
method. Check that it's set with `echo $CMUX_SURFACE_ID` in the surface.

The review server delivers with:

```sh
cmux paste --surface <surface> --submit -- "<notification>"
```

cmux refuses to paste when the agent's prompt holds text someone is typing,
or a question or permission dialog is open. The notification then shows as
`failed` with cmux's error, and the review UI has a Resend button.

Things to check or change:

- Try delivery by hand first, from another surface:
  `cmux paste --surface <surface> --submit -- "say hi"`.
- Start the review server from inside cmux. By default cmux's socket only
  accepts processes started inside cmux, so a review server started
  elsewhere (from Cursor, say) gets "Access denied" for every delivery.
  Running `$AD start` or `npm run serve` in a cmux surface is enough, since
  the server stays a descendant of cmux. Alternatively, set a socket password
  in cmux's settings and `CMUX_SOCKET_PASSWORD` where the server starts.
- `cmux` isn't on your shell's `PATH` outside cmux, so the server falls back
  to `/Applications/cmux.app/Contents/Resources/bin/cmux`. Set
  `AGENT_DIFF_CMUX` to use a different binary.
- To open the review UI next to the agent:
  `cmux browser open "http://127.0.0.1:4317/?rs=<review-session>"`.
- Without hooks, register the agent session by hand from its surface:
  `$AD register --agent-id my-agent --workspace .`. The server then doesn't
  know when a turn ends, so it pastes the notification as soon as you submit.

cmux also has a built-in diff viewer with review comments (`cmux diff`,
`cmux comments list`) that's worth comparing against the review UI.

## tmux

Run the agent in a tmux pane. tmux sets `TMUX_PANE`, and the hooks register
the agent with `tmux:$TMUX_PANE`. The server types the notification with
`tmux send-keys -l`, waits `enterDelayMs` (300 ms), and presses Enter. tmux
can't tell whether someone is typing in the pane, so a notification can
land in the middle of a draft.

On this machine, Homebrew's tmux 3.3a currently fails to start because
`libutf8proc.2.dylib` is missing. `brew reinstall utf8proc tmux` (or
`brew upgrade tmux`) should fix it.

## herdr, otty, and other harnesses

Use a `command:` notify method that runs whatever command your harness
provides for sending text to an agent session. The message is in
`$AGENT_DIFF_MESSAGE`:

```sh
$AD register --agent-id <id> --workspace <path> \
  --notify 'command:<harness-cli> send <agent-session> "$AGENT_DIFF_MESSAGE"'
```

A harness can also register agents and report turns directly over HTTP.
Requests that change state need the `x-agent-diff: 1` header:

```sh
curl -X POST -H 'x-agent-diff: 1' -H 'content-type: application/json' \
  http://127.0.0.1:4317/api/agents \
  -d '{"id":"agent-1","label":"herdr agent 1","parentId":null,"notify":"command:...","workspace":"/path/to/worktree"}'

curl -X POST -H 'x-agent-diff: 1' -H 'content-type: application/json' \
  http://127.0.0.1:4317/api/agents/agent-1/turn \
  -d '{"event":"start","cwd":"/path/to/worktree"}'      # and "end" when the turn ends
```

A turn end reported with `"canWake": true` means the harness itself
delivers waiting feedback, so the server marks it sent instead of typing it.

## Sub-agents in other worktrees

Each worktree is its own [workspace](../../docs/glossary.md#workspace). Add
it to the review session with `$AD add <review-session> <worktree>`. A
sub-agent that runs as its own agent session with these hooks registers
itself. Set `AGENT_DIFF_PARENT_ID` in its environment, or pass `--parent` to
`register`, to record its parent.

## No harness

Register with `--notify none`, or don't register at all. The review's card
shows the notification with a Copy button to paste into any agent. An agent
can also check for itself with `$AD pending --workspace .`.

## What to try

1. Ask the agent for a change, run `$AD start` in the repo (or ask the agent
   to), comment in the review UI while the agent is idle, and submit. The
   agent should receive the notification, run `feedback`, and address the
   comments, which turn outdated in the review UI as it edits.
2. Submit a review while the agent is mid-turn. The notification should stay
   `held` until the turn ends, then reach the agent through its Stop hook
   (status `sent`) without anything being typed into the terminal.
3. In cmux, type a draft in the agent's prompt, then submit a review. The
   notification should fail with cmux's error instead of clobbering the
   draft.
4. Switch to "Last turn" and check that it shows only the agent's most recent
   turn.
