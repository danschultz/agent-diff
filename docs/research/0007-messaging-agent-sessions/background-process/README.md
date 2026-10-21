# Prototype: a background process the agent starts

The agent session starts `client.mjs listen` in the background. It connects to
the prototype review server and prints one line per message, with the message's
ID and the command to answer it. The agent answers with `client.mjs reply`,
which goes through the listener's Unix socket when one is running, or straight
to the review server.

There are no npm dependencies. It needs Node 24 or later.

## Files

- `server.mjs`: the prototype review server, on `127.0.0.1:47105` by default. It
  queues messages per agent-session ID and logs each reply with its message ID
  and latency. Set `BGPROC_PORT` to use another port, `BGPROC_LOG` to also write
  the log to a file, and `BGPROC_TOKEN` to require a bearer token. `client.mjs`
  reads `BGPROC_URL` for the review server's address, and `BGPROC_SOCK_DIR` for
  where its Unix socket goes.
- `client.mjs`: `listen` (the background process), `reply` (the agent's answer)
  and `send` (stands in for the review UI).
- `plugin/`: a Claude Code plugin whose monitor starts `client.mjs listen` with
  the agent session, for `--plugin-dir`.
- `busy.sh`: keeps a tool call busy for 30 seconds, for sending a message
  mid-turn. Claude Code blocks a bare `sleep`.
- `.claude/settings.json`: allows `node client.mjs *`, `./busy.sh` and the
  Monitor tool for Claude Code in this folder, so in the default permission mode
  only the command you're testing asks for permission. When the agent runs
  `client.mjs` from this folder, it prints the reply command with the short path
  so this rule matches.

## Run it with Claude Code

1. Start the server: `node server.mjs`.
2. In another terminal, in this folder, start
   `claude --model haiku --permission-mode default`.
3. Type one of these prompts:
   - Exits on a message: "Start `node client.mjs listen --session A --once` with
     the Bash tool and run_in_background true, then stop and wait. When it exits
     it prints a review message: answer it by running the reply command it
     shows."
   - Keeps printing: "Use the Monitor tool to run
     `node client.mjs listen --session C` with timeout_ms 1800000, and stop.
     Each event is a review message: answer it with the reply command it shows."
4. Send a message:
   `node client.mjs send C "What is 6+1? Reply with just the number."`
5. Expect the agent to start a turn, run the reply command, and the server to
   log a `reply` line with the same message ID.

To try a busy agent session, type "Run ./busy.sh in the foreground with the Bash
tool" and send the message while it runs. To try a permission prompt, type "Run
`touch /tmp/agent-diff-x` with the Bash tool" and send the message while the
prompt shows. Expect the message to be handled after the tool call ends or the
prompt is answered.

To start the listener with the agent session instead, start
`claude --plugin-dir ./plugin`. The listener uses `BGPROC_SESSION` as the
agent-session ID if it's set, and otherwise `CLAUDE_CODE_SESSION_ID`. Send
messages to the ID the server logs in its `listener-open` line.

## Run it with the Cursor CLI

The Cursor CLI only reads project config, such as `.cursor/cli.json`, at the git
root, so copy `client.mjs` and `busy.sh` to a folder outside git. Add a
`.cursor/cli.json` there with:

```json
{ "permissions": { "allow": ["Shell(node)", "Shell(./busy.sh)"], "deny": [] } }
```

1. Start the server in this folder: `node server.mjs`.
2. In the copy, start `cursor-agent` and trust the folder. Don't pass `--model`,
   and don't choose "Add to allowlist" in a permission prompt: both change the
   user's `~/.cursor/cli-config.json`.
3. Type one of these prompts:
   - Exits on a message: "Run `node client.mjs listen --session K --once` as a
     background shell command, then end your turn. When it exits it prints a
     review message: answer it by running the reply command it shows."
   - Keeps printing: "Run `node client.mjs listen --session K` as a background
     shell command that keeps running, and ask to be notified whenever its
     output matches `agent-diff review message`. Each such line is a review
     message: answer it by running the reply command it shows. Then end your
     turn."
4. Send a message:
   `node client.mjs send K "What is 2+3? Reply with just the number."`
5. Expect "Finished" and the background command's description, or the reason the
   agent gave for the watch, then a new turn and a `reply` line in the server's
   log. With `--once`, the agent has to start the listener again for the next
   message.

To try a busy agent session, type "Run `./busy.sh` in the foreground and tell me
what it printed" and send the message while it runs. To try a permission prompt,
type "Run `touch /tmp/agent-diff-x` in the foreground" and send the message
while the prompt shows, then choose "Run (once)". Expect the message to be
handled after the tool call ends or the prompt is answered. To try an exited
agent session, press Ctrl+D: the listener stops, and later messages stay queued
on the server.
