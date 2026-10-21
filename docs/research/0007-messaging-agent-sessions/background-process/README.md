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
  and latency. Set `BGPROC_LOG` to also write the log to a file, and
  `BGPROC_TOKEN` to require a bearer token.
- `client.mjs`: `listen` (the background process), `reply` (the agent's answer)
  and `send` (stands in for the review UI).
- `plugin/`: a Claude Code plugin whose monitor starts `client.mjs listen` with
  the agent session, for `--plugin-dir`.

## Run it with Claude Code

1. Start the server: `node server.mjs`.
2. In another terminal, in this folder, start `claude`.
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

The plugin monitor wasn't tried: research stopped at a usage limit. To start the
listener with the agent session instead, start `claude --plugin-dir ./plugin`
with `BGPROC_SESSION` set to the agent-session ID the server should use. Without
it, `client.mjs` falls back to `CLAUDE_CODE_SESSION_ID`, if the agent sets it
for the process.

## Run it with the Cursor CLI

Not tried: research stopped at a usage limit. Start `cursor-agent` in this
folder and ask it to run `node client.mjs listen --session K --once` as a
background shell, then send a message to `K` as in step 4.
